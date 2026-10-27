import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, desktopCapturer, screen } from 'electron';
import {
  selectionForRequest,
  selectionToCrop,
  pairDisplaySources,
} from '../src/region-select.mjs';

const COLORS = [
  [255, 0, 0],
  [0, 180, 0],
  [0, 0, 255],
  [255, 220, 0],
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function centerPixel(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const offset = (y * width + x) * 4;
  return {
    r: bitmap[offset + 2],
    g: bitmap[offset + 1],
    b: bitmap[offset],
    width,
    height,
  };
}

function near(pixel, rgb, tolerance = 36) {
  return (
    Math.abs(pixel.r - rgb[0]) <= tolerance &&
    Math.abs(pixel.g - rgb[1]) <= tolerance &&
    Math.abs(pixel.b - rgb[2]) <= tolerance
  );
}

async function showColor(display, rect, rgb) {
  const color = `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  const win = new BrowserWindow({
    x: Math.round(display.bounds.x + rect.x),
    y: Math.round(display.bounds.y + rect.y),
    width: rect.width,
    height: rect.height,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: color,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadURL(
    `data:text/html,${encodeURIComponent(`<body style="margin:0;background:${color}"></body>`)}`,
  );
  win.showInactive();
  await delay(350);
  return win;
}

async function captureDisplays() {
  const displays = screen.getAllDisplays();
  const report = [];
  const windows = [];
  const layouts = displays.map((display, index) => {
    const margin = 48;
    const width = Math.min(300, Math.max(0, display.size.width - margin * 2));
    const height = Math.min(180, Math.max(0, display.size.height - margin * 2));
    return {
      display,
      rgb: COLORS[index % COLORS.length],
      rect: { x: margin, y: margin, width, height },
    };
  });
  for (const layout of layouts) {
    if (layout.rect.width < 80 || layout.rect.height < 80) continue;
    windows.push({
      layout,
      win: await showColor(layout.display, layout.rect, layout.rgb),
    });
  }
  const max = displays.reduce(
    (size, display) => {
      const scale = Number(display.scaleFactor) > 0 ? display.scaleFactor : 1;
      return {
        width: Math.max(size.width, Math.round(display.size.width * scale)),
        height: Math.max(size.height, Math.round(display.size.height * scale)),
      };
    },
    { width: 1, height: 1 },
  );
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.min(max.width, 8192),
      height: Math.min(max.height, 8192),
    },
    fetchWindowIcons: false,
  });
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
  for (const layout of layouts) {
    const pair = pairs.find(
      (item) => item.displayId === String(layout.display.id),
    );
    const source = pair ? sources[pair.sourceId] : null;
    const entry = {
      displayId: layout.display.id,
      scaleFactor: layout.display.scaleFactor,
      bounds: layout.display.bounds,
      dip: layout.display.size,
      paired: Boolean(source),
      thumbnail: source ? source.thumbnail.getSize() : null,
      colorMatched: false,
      storedPixel: null,
      unchangedAfterOverlay: false,
      freshCaptureSawOverlay: false,
    };
    if (!source || layout.rect.width < 80) {
      report.push(entry);
      continue;
    }
    const crop = selectionToCrop(
      selectionForRequest(
        { mode: 'region', ...layout.rect },
        layout.display.size,
      ),
      layout.display.size,
      source.thumbnail.getSize(),
    );
    const cropped = crop ? source.thumbnail.crop(crop) : null;
    if (!cropped) {
      report.push(entry);
      continue;
    }
    entry.storedPixel = centerPixel(cropped);
    entry.colorMatched = near(entry.storedPixel, layout.rgb);
    const overlay = await showColor(layout.display, layout.rect, [0, 255, 255]);
    const storedAgain = centerPixel(cropped);
    entry.unchangedAfterOverlay =
      storedAgain.r === entry.storedPixel.r &&
      storedAgain.g === entry.storedPixel.g &&
      storedAgain.b === entry.storedPixel.b;
    const freshSources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.min(max.width, 8192),
        height: Math.min(max.height, 8192),
      },
      fetchWindowIcons: false,
    });
    const freshDescribed = freshSources.map((item, index) => {
      const empty = !item.thumbnail || item.thumbnail.isEmpty();
      const size = empty ? { width: 0, height: 0 } : item.thumbnail.getSize();
      return {
        id: index,
        displayId: item.display_id,
        width: size.width,
        height: size.height,
        empty,
      };
    });
    const freshPairs = pairDisplaySources(
      displays.map((display) => ({
        id: display.id,
        size: display.size,
        scaleFactor: display.scaleFactor,
      })),
      freshDescribed,
    );
    const freshPair = freshPairs.find(
      (item) => item.displayId === String(layout.display.id),
    );
    const fresh = freshPair ? freshSources[freshPair.sourceId] : null;
    if (fresh && crop) {
      const freshCrop = fresh.thumbnail.crop(crop);
      entry.freshCaptureSawOverlay = near(
        centerPixel(freshCrop),
        [0, 255, 255],
        48,
      );
    }
    overlay.destroy();
    report.push(entry);
  }
  for (const item of windows) item.win.destroy();
  return { displays: displays.length, report };
}

async function mouseCheck() {
  const source = readFileSync(
    new URL('../src/overlay-gestures.mjs', import.meta.url),
    'utf8',
  );
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  const hostPath = new URL('../out/gesture-host.html', import.meta.url);
  const page = source.replace('export function', 'function');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"></body>`;
  const install = `
${page}
const results = [];
let gesture = createSelectionGesture();
const record = (decision) => {
  if (!decision || decision.type === 'ignore' || decision.type === 'move') return;
  results.push({ type: decision.type });
};
window.__reset = () => { gesture = createSelectionGesture(); results.length = 0; };
window.__results = results;
window.addEventListener('pointerdown', (event) => {
  if (event.button === 2) event.preventDefault();
  record(gesture.pointerDown({ button: event.button, x: event.clientX, y: event.clientY }));
});
window.addEventListener('mousedown', (event) => {
  if (event.button === 2) event.preventDefault();
  record(gesture.pointerDown({ button: event.button, x: event.clientX, y: event.clientY }));
});
window.addEventListener('pointerup', (event) => {
  record(gesture.pointerUp({ button: event.button, x: event.clientX, y: event.clientY }));
});
window.addEventListener('mouseup', (event) => {
  record(gesture.pointerUp({ button: event.button, x: event.clientX, y: event.clientY }));
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') record(gesture.cancel());
});
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  results.push({ type: 'context-blocked' });
});
window.__ready = true;
`;
  writeFileSync(hostPath, html);
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadURL(
    'data:text/html,<title>gesture</title><body style="margin:0"></body>',
  );
  await win.webContents.executeJavaScript(install);
  win.show();
  win.focus();
  await delay(200);
  const ready = await win.webContents.executeJavaScript(
    'window.__ready === true',
  );
  const send = (input) => win.webContents.sendInputEvent(input);
  await win.webContents.executeJavaScript('window.__reset()');
  send({ type: 'mouseDown', x: 40, y: 50, button: 'left', clickCount: 1 });
  send({ type: 'mouseMove', x: 260, y: 210, button: 'left' });
  send({ type: 'mouseUp', x: 260, y: 210, button: 'left', clickCount: 1 });
  await delay(100);
  const drag = await win.webContents.executeJavaScript(
    'window.__results.map((item) => item.type)',
  );
  await win.webContents.executeJavaScript('window.__reset()');
  send({ type: 'mouseDown', x: 80, y: 80, button: 'right', clickCount: 1 });
  send({ type: 'mouseUp', x: 80, y: 80, button: 'right', clickCount: 1 });
  await delay(100);
  const right = await win.webContents.executeJavaScript(
    'window.__results.map((item) => item.type)',
  );
  await win.webContents.executeJavaScript('window.__reset()');
  send({ type: 'keyDown', keyCode: 'Escape' });
  await delay(100);
  const escape = await win.webContents.executeJavaScript(
    'window.__results.map((item) => item.type)',
  );
  win.destroy();
  return { ready, drag, right, escape };
}

app.on('window-all-closed', () => {
  // Capture windows close before the mouse check. Quitting here would hide the result.
});

app
  .whenReady()
  .then(async () => {
    const capture = await captureDisplays();
    const mouse = await mouseCheck();
    const captureOk =
      capture.report.length > 0 &&
      capture.report.every(
        (entry) => entry.colorMatched && entry.unchangedAfterOverlay,
      );
    const mouseOk =
      mouse.ready === true &&
      mouse.drag.includes('region') &&
      mouse.right.includes('full') &&
      mouse.right.includes('context-blocked') &&
      mouse.escape.includes('cancel');
    const summary = { capture, mouse, captureOk, mouseOk };
    writeFileSync(
      fileURLToPath(new URL('../out/region-verify.json', import.meta.url)),
      JSON.stringify(summary, null, 2),
    );
    console.log(
      JSON.stringify({
        captureOk,
        mouseOk,
        displays: capture.displays,
        scales: capture.report.map((entry) => entry.scaleFactor),
        matched: capture.report.map((entry) => entry.colorMatched),
        overlayStable: capture.report.map(
          (entry) => entry.unchangedAfterOverlay,
        ),
        freshSawOverlay: capture.report.map(
          (entry) => entry.freshCaptureSawOverlay,
        ),
        drag: mouse.drag,
        right: mouse.right,
        escape: mouse.escape,
      }),
    );
    app.exit(captureOk && mouseOk ? 0 : 1);
  })
  .catch((error) => {
    const message =
      error instanceof Error ? error.stack || error.message : 'verify failed';
    try {
      writeFileSync(
        fileURLToPath(new URL('../out/region-verify.json', import.meta.url)),
        JSON.stringify({ error: message }),
      );
    } catch {
      // The console line below is the fallback.
    }
    console.error(message.split('\n')[0]);
    app.exit(1);
  });
