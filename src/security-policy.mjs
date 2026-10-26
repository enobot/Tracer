// Pure security rules shared by the Electron main process, preload, renderer,
// and tests. This module must not import Node or Electron built-ins.

export const LIMITS = {
  screenshotChars: 20_000_000,
  promptChars: 2000,
  acceleratorChars: 64,
};

export const CAPTURE_SHORTCUT = 'Ctrl+Shift+Space';
export const CAPTURE_TIMEOUT_MS = 5000;

export const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
};

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

const NAMED_KEYS = new Set([
  'Plus',
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
  'VolumeUp',
  'VolumeDown',
  'VolumeMute',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'MediaPlayPause',
  'PrintScreen',
]);

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isScreenshotDataUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > LIMITS.screenshotChars) return false;
  if (!IMAGE_DATA_URL.test(value)) return false;
  const encoded = value.slice(value.indexOf(',') + 1);
  return encoded.length % 4 === 0;
}

export const packageIgnorePatterns = [
  /^\/backend($|\/)/,
  /^\/test($|\/)/,
  /^\/\.env($|\.)/,
  /\.map$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
];

export function shouldIgnorePackagePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replaceAll('\\', '/');
  // Match Electron Forge's Vite plugin: ship the Vite build, not the source tree.
  if (!normalized.startsWith('/.vite')) return true;
  return packageIgnorePatterns.some((pattern) => pattern.test(normalized));
}

export function isValidAccelerator(accelerator) {
  if (typeof accelerator !== 'string') return false;
  if (!accelerator || accelerator.length > LIMITS.acceleratorChars)
    return false;
  const parts = accelerator.split('+');
  if (parts.length < 2 || parts.length > 5) return false;
  if (parts.some((part) => part.length === 0)) return false;

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (new Set(modifiers).size !== modifiers.length) return false;
  if (!modifiers.every((modifier) => MODIFIERS.has(modifier))) return false;

  if (/^[A-Za-z0-9]$/.test(key) || NAMED_KEYS.has(key)) return true;
  return /^F(?:[1-9]|1\d|2[0-4])$/.test(key);
}

export function readStoredAccelerator(parsed, fallback) {
  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.accelerator === 'string' &&
    isValidAccelerator(parsed.accelerator)
  ) {
    return parsed.accelerator;
  }
  return fallback;
}

export function nextShortcutRegistration(accelerator, alreadyRegistered) {
  if (!isValidAccelerator(accelerator)) {
    return { register: false, unregisterFirst: false, reason: 'invalid' };
  }
  return {
    register: true,
    unregisterFirst: Boolean(alreadyRegistered),
    reason: 'ok',
  };
}

export function canDeliverHotkey(target) {
  if (!target || typeof target.isDestroyed !== 'function') return false;
  if (target.isDestroyed()) return false;
  const contents = target.webContents;
  if (!contents || typeof contents.isDestroyed !== 'function') return false;
  return !contents.isDestroyed();
}

export function shouldQuitOnLastWindow(platform) {
  return platform !== 'darwin';
}

export function isTrustedSender(event, webContents) {
  if (!event || !webContents) return false;
  if (
    typeof webContents.isDestroyed === 'function' &&
    webContents.isDestroyed()
  ) {
    return false;
  }
  if (!webContents.mainFrame) return false;
  return (
    event.sender === webContents && event.senderFrame === webContents.mainFrame
  );
}

export function isMainFrame(frame, webContents) {
  if (!frame || !webContents?.mainFrame) return false;
  const mainFrame = webContents.mainFrame;
  if (frame === mainFrame) return true;
  return (
    frame.processId != null &&
    frame.processId === mainFrame.processId &&
    frame.routingId != null &&
    frame.routingId === mainFrame.routingId
  );
}

export function evaluateDisplayCapture(request, frameTrusted) {
  if (!request || frameTrusted !== true) return { allow: false };
  if (request.videoRequested !== true || request.audioRequested === true) {
    return { allow: false };
  }
  return { allow: true };
}

export function allowsDisplayCapturePermission(permission, isAppContents) {
  return permission === 'display-capture' && isAppContents === true;
}

export function allowsRendererPermission(permission, isAppContents) {
  return (
    isAppContents === true &&
    (permission === 'display-capture' ||
      permission === 'clipboard-sanitized-write')
  );
}

export function fittedSize(width, height, maxEdge = 1600) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (
    !Number.isFinite(safeWidth) ||
    !Number.isFinite(safeHeight) ||
    safeWidth <= 0 ||
    safeHeight <= 0
  ) {
    return null;
  }
  const longest = Math.max(safeWidth, safeHeight);
  if (longest <= maxEdge) {
    return { width: Math.round(safeWidth), height: Math.round(safeHeight) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

export function validateInspectPayload(payload) {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return { ok: false, error: 'Invalid request' };
  }

  const screenshot = payload.screenshot;
  const prompt = payload.prompt;

  if (!isScreenshotDataUrl(screenshot)) {
    return { ok: false, error: 'Invalid screenshot' };
  }

  if (
    typeof prompt !== 'string' ||
    prompt.length > LIMITS.promptChars ||
    !prompt.trim()
  ) {
    return { ok: false, error: 'Invalid prompt' };
  }

  return {
    ok: true,
    value: {
      screenshotSize: screenshot.length,
      prompt,
    },
  };
}

export function buildInspectResult(validation) {
  if (!validation?.ok) {
    return { ok: false, error: validation?.error || 'Invalid request' };
  }
  return {
    ok: true,
    body: {
      success: true,
      message: 'Screenshot received by main process',
      screenshotSize: validation.value.screenshotSize,
      prompt: validation.value.prompt,
    },
  };
}

export function isAllowedNavigation(
  targetUrl,
  { devServerUrl = '', appRootFileUrl = '' } = {},
) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (devServerUrl) {
    let devServer;
    try {
      devServer = new URL(devServerUrl);
    } catch {
      return false;
    }
    return (
      target.origin === devServer.origin &&
      target.protocol === devServer.protocol
    );
  }

  if (target.protocol !== 'file:') return false;
  if (!appRootFileUrl) return false;

  let root;
  try {
    root = new URL(appRootFileUrl);
  } catch {
    return false;
  }
  if (root.protocol !== 'file:') return false;

  const rootPath = decodeURIComponent(root.pathname);
  const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
  return decodeURIComponent(target.pathname).startsWith(prefix);
}

function devServerOrigins(devServerUrl) {
  const devServer = new URL(devServerUrl);
  const port = devServer.port ? `:${devServer.port}` : '';
  const hosts = new Set([devServer.origin]);
  if (devServer.hostname === 'localhost') {
    hosts.add(`${devServer.protocol}//127.0.0.1${port}`);
  } else if (devServer.hostname === '127.0.0.1') {
    hosts.add(`${devServer.protocol}//localhost${port}`);
  }
  return [...hosts];
}

export function buildContentSecurityPolicy({ devServerUrl = '' } = {}) {
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
  ];

  if (!devServerUrl) {
    directives.push(
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "worker-src 'none'",
    );
    return directives.join('; ');
  }

  const origins = devServerOrigins(devServerUrl);
  const sockets = origins.map((origin) => origin.replace(/^http/, 'ws'));
  directives.push(
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${origins.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${origins.join(' ')}`,
    `connect-src 'self' ${origins.join(' ')} ${sockets.join(' ')}`,
  );
  return directives.join('; ');
}

export function contentSecurityPolicyDirective(policy, name) {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

export function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), milliseconds);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createCaptureGate() {
  let busy = false;
  return {
    tryEnter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave() {
      busy = false;
    },
  };
}

export function releaseMediaStream(stream) {
  if (!stream || typeof stream.getTracks !== 'function') return;
  for (const track of stream.getTracks()) {
    if (track && typeof track.stop === 'function') track.stop();
  }
}

export function createListenerHub() {
  const callbacks = new Set();
  return {
    add(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('Callback must be a function');
      }
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    emit() {
      for (const callback of callbacks) callback();
    },
    deliver(value) {
      for (const callback of callbacks) callback(value);
    },
    get size() {
      return callbacks.size;
    },
  };
}
