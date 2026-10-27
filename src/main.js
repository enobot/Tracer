import {
  app,
  BrowserWindow,
  ClipboardItem,
  Menu,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
} from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { ICON_PNGS } from './app-icon.mjs';
import { createChatGPTRuntime } from './chatgpt-runtime.mjs';
import {
  USAGE_URL,
  assertOpenable,
  buildConversation,
  handoffUrl,
} from './chatgpt-plan.mjs';
import { translator } from './i18n.mjs';
import { isLanguageCode, matchLanguage } from './languages.mjs';
import {
  pairDisplaySources,
  selectionForRequest,
  selectionToCrop,
} from './region-select.mjs';
import {
  CAPTURE_SHORTCUT,
  CAPTURE_TIMEOUT_MS,
  LIMITS,
  allowsRendererPermission,
  buildContentSecurityPolicy,
  canDeliverHotkey,
  createCaptureGate,
  fittedSize,
  isAllowedNavigation,
  isScreenshotDataUrl,
  isTrustedSender,
  isValidAccelerator,
  nextShortcutRegistration,
  readStoredAccelerator,
  secureWebPreferences,
  shouldQuitOnLastWindow,
  validateInspectPayload,
  withTimeout,
} from './security-policy.mjs';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// A second copy would fight over the shortcut and the rotating ChatGPT
// refresh token, so it hands focus to the first copy and exits.
const primaryInstance = !started && app.requestSingleInstanceLock();
if (!started && !primaryInstance) {
  app.quit();
}
app.on('second-instance', () => restoreMain());

let mainWindow;
let chatgpt;
let activeShortcut = CAPTURE_SHORTCUT;
let sessionCounter = 0;
let activeSession = 0;
let regionLocked = false;
let overlays = [];
let tray = null;
// Closing the window only hides it until the user quits from the tray, the
// File menu, or Windows ends the session.
let quitting = false;
let trayNoticeShown = false;
// A capture started from the tray goes back there if it is cancelled.
let returnToTray = false;
let interfaceLanguage = 'en';
const frozen = new Map();
const captureGate = createCaptureGate();
const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
    ? MAIN_WINDOW_VITE_DEV_SERVER_URL
    : '';

function devLog(message) {
  if (devServerUrl) console.log(message);
}

function rendererDirectoryUrl() {
  return pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/`),
  ).href;
}

function indexHtmlPath() {
  return path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
}

function navigationPolicy() {
  return {
    devServerUrl,
    appRootFileUrl: devServerUrl ? '' : rendererDirectoryUrl(),
  };
}

function activeWebContents() {
  if (!canDeliverHotkey(mainWindow)) return null;
  return mainWindow.webContents;
}

function hardenWindow(win) {
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, navigationPolicy())) {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, navigationPolicy())) {
      event.preventDefault();
    }
  });
}

function emitTracer(payload) {
  const contents = activeWebContents();
  if (!contents) return;
  contents.send('tracer-event', payload);
}

function restoreMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function destroyOverlays() {
  const windows = overlays;
  overlays = [];
  for (const entry of windows) {
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }
}

function overlayFrom(event) {
  if (!event?.sender || event.sender.isDestroyed?.()) return null;
  if (!event.sender.mainFrame || event.senderFrame !== event.sender.mainFrame) {
    return null;
  }
  return overlays.find((entry) => entry.contents === event.sender) || null;
}

function thumbnailSizeFor(displays) {
  let width = 1;
  let height = 1;
  for (const display of displays) {
    const scale =
      Number(display.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
    width = Math.max(width, Math.round(display.size.width * scale));
    height = Math.max(height, Math.round(display.size.height * scale));
  }
  return {
    width: Math.min(width, 8192),
    height: Math.min(height, 8192),
  };
}

function toJpegDataUrl(image, maxEdge, quality) {
  if (!image || image.isEmpty()) return null;
  const size = image.getSize();
  const fitted = fittedSize(size.width, size.height, maxEdge);
  if (!fitted) return null;
  const output =
    fitted.width === size.width && fitted.height === size.height
      ? image
      : image.resize({
          width: fitted.width,
          height: fitted.height,
          quality: 'good',
        });
  if (!output || output.isEmpty()) return null;
  const dataUrl = `data:image/jpeg;base64,${output.toJPEG(quality).toString('base64')}`;
  if (
    !isScreenshotDataUrl(dataUrl) ||
    dataUrl.length > LIMITS.screenshotChars
  ) {
    return null;
  }
  return dataUrl;
}

function finishActive(request) {
  if (!activeSession || regionLocked) return { ok: false };
  regionLocked = true;
  const mode = request?.type;
  let outcome = 'cancel';
  let dataUrl = null;
  try {
    if (mode === 'region' || mode === 'full') {
      const display = screen
        .getAllDisplays()
        .find((item) => String(item.id) === String(request.displayId));
      const image = frozen.get(String(request.displayId));
      const selection = selectionForRequest(
        mode === 'full'
          ? { mode: 'full' }
          : {
              mode: 'region',
              x: request.x,
              y: request.y,
              width: request.width,
              height: request.height,
            },
        display?.size,
      );
      const crop =
        image && display && selection
          ? selectionToCrop(selection, display.size, image.getSize())
          : null;
      if (crop) {
        const size = image.getSize();
        const cropped =
          crop.x === 0 &&
          crop.y === 0 &&
          crop.width === size.width &&
          crop.height === size.height
            ? image
            : image.crop(crop);
        dataUrl = toJpegDataUrl(cropped, 1600, 85);
        if (!dataUrl) throw new Error('encode');
        outcome = 'capture';
      }
    }
  } catch {
    outcome = 'failed';
  }
  activeSession = 0;
  frozen.clear();
  destroyOverlays();
  captureGate.leave();
  regionLocked = false;
  if (outcome !== 'cancel' || !returnToTray) restoreMain();
  returnToTray = false;
  if (outcome === 'capture') {
    emitTracer({
      type: 'capture',
      mode: mode === 'full' ? 'full' : 'region',
      image: dataUrl,
    });
  } else if (outcome === 'failed') {
    emitTracer({ type: 'capture-failed' });
  } else {
    emitTracer({ type: 'capture-cancelled' });
  }
  return { ok: outcome !== 'failed' };
}

function loadOverlay(win, display) {
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set('overlay', '1');
    return win.loadURL(url.href);
  }
  return win.loadFile(indexHtmlPath(), {
    query: { overlay: '1', display: String(display.id) },
  });
}

function openOverlays(displays) {
  const cursor = screen.getCursorScreenPoint();
  const nearest = screen.getDisplayNearestPoint(cursor);
  for (const display of displays) {
    if (!frozen.has(String(display.id))) continue;
    const bounds = display.bounds;
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: false,
      backgroundColor: '#111111',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreen: false,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      focusable: true,
      show: false,
      enableLargerThanScreen: true,
      thickFrame: false,
      title: 'Select an area',
      webPreferences: {
        ...secureWebPreferences,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });
    hardenWindow(win);
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setBounds(bounds);
    const contents = win.webContents;
    const displayId = String(display.id);
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        finishActive({ type: 'cancel', displayId });
      }
    });
    win.on('closed', () => {
      overlays = overlays.filter((entry) => entry.win !== win);
      if (activeSession && !regionLocked && overlays.length === 0) {
        finishActive({ type: 'cancel', displayId });
      }
    });
    overlays.push({ win, contents, displayId });
    win.once('ready-to-show', () => {
      if (!activeSession || win.isDestroyed()) return;
      win.showInactive();
    });
    void loadOverlay(win, display);
  }
  const focus =
    overlays.find((entry) => entry.displayId === String(nearest.id)) ||
    overlays[0];
  if (!focus || focus.win.isDestroyed()) return;
  focus.win.show();
  focus.win.focus();
}

async function beginRegionSelect() {
  const id = ++sessionCounter;
  activeSession = id;
  try {
    if (!activeWebContents()) throw new Error('missing');
    returnToTray = Boolean(tray) && !mainWindow.isVisible();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    await delay(150);
    if (activeSession !== id) {
      frozen.clear();
      return;
    }
    const displays = screen.getAllDisplays();
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: thumbnailSizeFor(displays),
        fetchWindowIcons: false,
      }),
      CAPTURE_TIMEOUT_MS,
    );
    if (activeSession !== id) {
      frozen.clear();
      return;
    }
    frozen.clear();
    const described = sources.map((source, index) => {
      const empty = !source.thumbnail || source.thumbnail.isEmpty();
      const size = empty ? { width: 0, height: 0 } : source.thumbnail.getSize();
      return {
        id: index,
        displayId: source.display_id,
        width: size.width,
        height: size.height,
        empty,
      };
    });
    const pairs = pairDisplaySources(
      displays.map((display) => ({
        id: display.id,
        size: display.size,
        scaleFactor: display.scaleFactor,
      })),
      described,
    );
    for (const pair of pairs) {
      const source = sources[pair.sourceId];
      if (source?.thumbnail && !source.thumbnail.isEmpty()) {
        frozen.set(pair.displayId, source.thumbnail);
      }
    }
    if (frozen.size === 0) throw new Error('empty');
    openOverlays(displays);
    if (overlays.length === 0) throw new Error('empty');
  } catch {
    if (activeSession !== id) return;
    activeSession = 0;
    frozen.clear();
    destroyOverlays();
    captureGate.leave();
    restoreMain();
    emitTracer({ type: 'capture-failed' });
  }
}

function onHotkey() {
  devLog('Hotkey Detected');
  if (!captureGate.tryEnter()) return;
  void beginRegionSelect();
}

function shortcutFile() {
  return path.join(app.getPath('userData'), 'shortcut.json');
}

async function loadShortcut() {
  try {
    const parsed = JSON.parse(await readFile(shortcutFile(), 'utf8'));
    return readStoredAccelerator(parsed, CAPTURE_SHORTCUT);
  } catch {
    return CAPTURE_SHORTCUT;
  }
}

function applyShortcut(next) {
  const plan = nextShortcutRegistration(
    next,
    globalShortcut.isRegistered(next),
  );
  if (!plan.register) {
    return {
      ok: false,
      accelerator: activeShortcut,
      error: 'Use a modifier and a key, such as Ctrl+Shift+Space.',
    };
  }
  const previous = activeShortcut;
  if (globalShortcut.isRegistered(previous)) {
    globalShortcut.unregister(previous);
  }
  if (plan.unregisterFirst && next !== previous) {
    globalShortcut.unregister(next);
  }
  let registered = false;
  try {
    registered = globalShortcut.register(next, onHotkey);
  } catch {
    registered = false;
  }
  if (!registered) {
    try {
      if (!globalShortcut.isRegistered(previous)) {
        globalShortcut.register(previous, onHotkey);
      }
    } catch {
      // The previous shortcut could not be restored.
    }
    return {
      ok: false,
      accelerator: previous,
      error: 'That shortcut is already in use. Choose another combination.',
    };
  }
  activeShortcut = next;
  return { ok: true, accelerator: next };
}

async function registerHotkey() {
  activeShortcut = await loadShortcut();
  const result = applyShortcut(activeShortcut);
  devLog(String(result.ok));
  if (!result.ok) {
    dialog.showErrorBox(
      'Tracer',
      'Tracer could not register the screenshot shortcut. Another application may already be using it.',
    );
  }
}

let iconImage = null;

// One image with every size, so Windows picks the sharp one for each scaling.
function appIcon() {
  if (iconImage) return iconImage;
  iconImage = nativeImage.createEmpty();
  for (const { scaleFactor, base64 } of ICON_PNGS) {
    iconImage.addRepresentation({
      scaleFactor,
      buffer: Buffer.from(base64, 'base64'),
    });
  }
  return iconImage;
}

function trayNoticeFile() {
  return path.join(app.getPath('userData'), 'tray-notice.json');
}

async function loadTrayNotice() {
  try {
    const parsed = JSON.parse(await readFile(trayNoticeFile(), 'utf8'));
    trayNoticeShown = parsed?.shown === true;
  } catch {
    trayNoticeShown = false;
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const t = translator(interfaceLanguage);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('Open Tracer'), click: () => restoreMain() },
      { type: 'separator' },
      { label: t('Quit Tracer'), click: () => app.quit() },
    ]),
  );
}

function installTray() {
  try {
    tray = new Tray(appIcon());
  } catch {
    // Without a tray icon, closing the window quits as before.
    tray = null;
    return;
  }
  tray.setToolTip('Tracer');
  tray.on('click', () => restoreMain());
  updateTrayMenu();
}

// The first time the window is closed, say where Tracer went and how to exit.
function noteRunningInTray() {
  if (trayNoticeShown || !tray || process.platform !== 'win32') return;
  trayNoticeShown = true;
  const t = translator(interfaceLanguage);
  tray.displayBalloon({
    title: t('Tracer is still running'),
    content: t(
      'Press {hotkey} to capture. To exit, right-click the Tracer icon near the clock (it may be under the ^ arrow) and choose Quit Tracer.',
      { hotkey: activeShortcut },
    ),
  });
  void writeFile(trayNoticeFile(), '{"shown":true}\n').catch(() => {});
}

function installMenu() {
  const viewMenu = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { role: 'togglefullscreen' },
  ];
  if (devServerUrl) viewMenu.push({ role: 'toggleDevTools' });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Analyze screenshot',
            accelerator: 'CommandOrControl+Enter',
            click: () => {
              if (activeSession) return;
              emitTracer({ type: 'analyze' });
            },
          },
          {
            label: 'Clear screenshot',
            click: () => {
              if (activeSession) return;
              emitTracer({ type: 'clear' });
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { label: 'View', submenu: viewMenu },
    ]),
  );
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    title: 'Tracer',
    icon: appIcon(),
    webPreferences: {
      ...secureWebPreferences,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  hardenWindow(mainWindow);
  mainWindow.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
    noteRunningInTray();
  });
  // Signing out or shutting down must not be blocked by the hide above.
  mainWindow.on('query-session-end', () => {
    quitting = true;
  });
  mainWindow.on('session-end', () => {
    quitting = true;
  });
  mainWindow.on('closed', () => {
    activeSession = 0;
    frozen.clear();
    destroyOverlays();
    captureGate.leave();
    mainWindow = null;
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    // DevTools stay available while developing. Packaged builds do not open them.
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(indexHtmlPath());
  }
};

function installSessionGuards() {
  const policy = buildContentSecurityPolicy({ devServerUrl });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || '';
    const attach =
      (devServerUrl && url.startsWith(new URL(devServerUrl).origin)) ||
      url.startsWith('file:');
    if (!attach) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['Content-Security-Policy'];
    delete responseHeaders['content-security-policy'];
    responseHeaders['Content-Security-Policy'] = [policy];
    callback({ responseHeaders });
  });

  const allowPermission = (webContents, permission) =>
    allowsRendererPermission(
      permission,
      Boolean(activeWebContents() && webContents === activeWebContents()),
    );

  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    allowPermission(webContents, permission),
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(allowPermission(webContents, permission));
    },
  );
  session.defaultSession.setDevicePermissionHandler(() => false);

  // Screen capture is taken in the main process before any selection overlay
  // exists, so no page needs a screen stream. Granting one here would let a
  // compromised window record the screen with no prompt.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback(null);
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});

// Sends streamed answer text to the window in batches, so a fast stream does
// not turn into hundreds of IPC messages a second.
function createDeltaRelay(requestId) {
  const started = Date.now();
  let firstText = 0;
  let pending = '';
  let timer = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    emitTracer({ type: 'answer-delta', requestId, text: pending });
    pending = '';
  };
  return {
    push(text) {
      if (!firstText) firstText = Date.now() - started;
      pending += text;
      if (!timer) timer = setTimeout(flush, 60);
    },
    finish() {
      if (timer) clearTimeout(timer);
      flush();
      devLog(
        `ChatGPT: first text after ${firstText || 'none'} ms, finished after ${Date.now() - started} ms`,
      );
    },
  };
}

function requireSender(event) {
  const contents = activeWebContents();
  if (!contents || !isTrustedSender(event, contents)) {
    throw new Error('Unauthorized IPC sender');
  }
}

function validationError(error) {
  if (error === 'Invalid prompt') {
    return 'Enter a prompt of 2000 characters or fewer.';
  }
  if (error === 'Invalid screenshot') {
    return 'The screenshot could not be used. Capture the screen again.';
  }
  return 'The request could not be processed.';
}

function validatedCapture(payload) {
  const validation = validateInspectPayload({
    screenshot: payload?.screenshot,
    prompt: payload?.prompt,
  });
  if (!validation.ok) throw new Error(validationError(validation.error));
  return validation.value.prompt;
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  installSessionGuards();
  installMenu();
  const userData = app.getPath('userData');
  chatgpt = createChatGPTRuntime({
    fetch: globalThis.fetch.bind(globalThis),
    encrypt: (plain) =>
      safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(plain)
        : null,
    decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed)),
    readFile,
    writeFile: (file, data) => writeFile(file, data, { mode: 0o600 }),
    openBrowser: async (url) => {
      await shell.openExternal(assertOpenable(url, { authorize: true }));
    },
    storageFile: path.join(userData, 'chatgpt-connection.bin'),
    hostIdFile: path.join(userData, 'chatgpt-host-id'),
  });

  ipcMain.handle('tracer:get-session', async (event) => {
    requireSender(event);
    return chatgpt.getSession();
  });

  ipcMain.handle('tracer:sign-in', async (event, payload) => {
    requireSender(event);
    return chatgpt.signIn({
      reconsent: payload?.reconsent === true,
      fresh: payload?.fresh === true,
    });
  });

  ipcMain.handle('tracer:cancel-sign-in', (event) => {
    requireSender(event);
    chatgpt.cancelSignIn();
    return { ok: true };
  });

  ipcMain.handle('tracer:disconnect', async (event) => {
    requireSender(event);
    return chatgpt.disconnect();
  });

  ipcMain.handle('tracer:ask', async (event, payload) => {
    requireSender(event);
    const prompt = validatedCapture(payload);
    const conversation = buildConversation({
      screenshot: payload.screenshot,
      prompt,
      history: payload?.history,
    });
    if (!conversation.ok) {
      throw new Error(
        'The conversation could not be sent. Clear it and try again.',
      );
    }
    const requestId = Number.isSafeInteger(payload?.requestId)
      ? payload.requestId
      : 0;
    const relay = createDeltaRelay(requestId);
    try {
      return await chatgpt.respond(conversation.messages, undefined, {
        language: isLanguageCode(payload?.language) ? payload.language : null,
        onDelta: relay.push,
      });
    } finally {
      relay.finish();
    }
  });

  ipcMain.handle('tracer:cancel-ask', (event) => {
    requireSender(event);
    chatgpt.cancelRespond();
    return { ok: true };
  });

  ipcMain.handle('tracer:handoff', async (event, payload) => {
    requireSender(event);
    const url = handoffUrl(payload?.provider);
    if (!url) throw new Error('Choose Gemini or Claude to open a browser.');
    const prompt = validatedCapture(payload);
    const image = nativeImage.createFromDataURL(payload.screenshot);
    if (image.isEmpty()) {
      throw new Error('The screenshot could not be copied.');
    }
    try {
      // Electron 44's clipboard is asynchronous and takes ClipboardItem
      // entries. One entry keeps the picture and the prompt together.
      await clipboard.write([
        new ClipboardItem({
          'text/plain': prompt,
          'image/png': new Blob([image.toPNG()], { type: 'image/png' }),
        }),
      ]);
    } catch {
      throw new Error('The screenshot could not be copied.');
    }
    try {
      await shell.openExternal(url);
    } catch {
      throw new Error(
        'The screenshot and prompt were copied, but the browser could not be opened.',
      );
    }
    return {
      opened: true,
      message:
        'Opened the official site and copied the screenshot and prompt. Paste them into the page. Tracer did not sign in or analyze the picture.',
    };
  });

  ipcMain.handle('tracer:open-usage', async (event) => {
    requireSender(event);
    await shell.openExternal(assertOpenable(USAGE_URL));
    return { opened: true };
  });

  ipcMain.handle('tracer:reveal', (event) => {
    requireSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return { ok: true };
  });

  ipcMain.handle('tracer:frozen-frame', (event) => {
    const overlay = overlayFrom(event);
    if (!overlay) throw new Error('Unauthorized IPC sender');
    const image = frozen.get(overlay.displayId);
    const preview = toJpegDataUrl(image, 1600, 60);
    if (!preview) return { ok: false };
    return { ok: true, image: preview };
  });

  ipcMain.handle('tracer:choose-region', (event, payload) => {
    const overlay = overlayFrom(event);
    if (!overlay) throw new Error('Unauthorized IPC sender');
    return finishActive({
      type: payload?.mode === 'full' ? 'full' : 'region',
      displayId: overlay.displayId,
      x: Number(payload?.x),
      y: Number(payload?.y),
      width: Number(payload?.width),
      height: Number(payload?.height),
    });
  });

  ipcMain.handle('tracer:cancel-region', (event) => {
    const overlay = overlayFrom(event);
    if (!overlay) throw new Error('Unauthorized IPC sender');
    return finishActive({ type: 'cancel', displayId: overlay.displayId });
  });

  ipcMain.handle('tracer:get-hotkey', (event) => {
    requireSender(event);
    return { accelerator: activeShortcut };
  });

  // The tray menu and notice follow the window's language.
  ipcMain.handle('tracer:set-language', (event, code) => {
    requireSender(event);
    if (!isLanguageCode(code)) return { ok: false };
    interfaceLanguage = code;
    updateTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('tracer:set-hotkey', async (event, accelerator) => {
    requireSender(event);
    if (typeof accelerator !== 'string' || !isValidAccelerator(accelerator)) {
      return {
        ok: false,
        accelerator: activeShortcut,
        error: 'Use a modifier and a key, such as Ctrl+Shift+Space.',
      };
    }
    const result = applyShortcut(accelerator);
    if (result.ok) {
      await writeFile(
        shortcutFile(),
        JSON.stringify({ accelerator: result.accelerator }),
        { mode: 0o600 },
      );
    }
    return result;
  });

  ipcMain.handle('tracer:suspend-hotkey', (event) => {
    requireSender(event);
    if (globalShortcut.isRegistered(activeShortcut)) {
      globalShortcut.unregister(activeShortcut);
    }
    return { ok: true };
  });

  ipcMain.handle('tracer:resume-hotkey', (event) => {
    requireSender(event);
    if (!globalShortcut.isRegistered(activeShortcut)) {
      applyShortcut(activeShortcut);
    }
    return { ok: true, accelerator: activeShortcut };
  });

  interfaceLanguage = matchLanguage(app.getLocale());
  await loadTrayNotice();
  installTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  await registerHotkey();
});

app.on('window-all-closed', () => {
  if (shouldQuitOnLastWindow(process.platform)) {
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  tray?.destroy();
  tray = null;
  activeSession = 0;
  frozen.clear();
  destroyOverlays();
  globalShortcut.unregisterAll();
  chatgpt?.cancelSignIn();
  chatgpt?.cancelRespond();
});
