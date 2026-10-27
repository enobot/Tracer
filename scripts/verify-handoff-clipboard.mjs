// Checks the Electron clipboard contract that the Gemini and Claude handoff
// depends on. Run with: npx electron scripts/verify-handoff-clipboard.mjs
// It uses a synthetic image and restores the clipboard it found.
import path from 'node:path';
import { app, clipboard, ClipboardItem, nativeImage } from 'electron';

app.setPath('userData', path.join(app.getPath('temp'), 'tracer-verify'));

async function snapshot() {
  const copies = [];
  for (const item of await clipboard.read()) {
    const entry = {};
    for (const type of item.types) {
      try {
        entry[type] = await item.getType(type);
      } catch {
        // Some platform formats cannot be read back.
      }
    }
    if (Object.keys(entry).length) copies.push(entry);
  }
  return copies;
}

async function restore(copies) {
  if (copies.length) {
    await clipboard.write(copies.map((entry) => new ClipboardItem(entry)));
  } else {
    await clipboard.clear();
  }
}

function syntheticImage() {
  const width = 32;
  const height = 24;
  const bgra = Buffer.alloc(width * height * 4, 0x80);
  const source = nativeImage.createFromBitmap(bgra, { width, height });
  // Tracer captures are JPEG data URLs, so decode the same way main.js does.
  return nativeImage.createFromDataURL(
    `data:image/jpeg;base64,${source.toJPEG(85).toString('base64')}`,
  );
}

app.whenReady().then(async () => {
  const saved = await snapshot();
  const checks = {};
  try {
    const image = syntheticImage();
    checks.jpegDecodes = !image.isEmpty();

    let legacy = 'resolved';
    try {
      await clipboard.write({ text: 'legacy', image });
    } catch {
      legacy = 'rejected';
    }
    checks.legacyObjectFormRejects = legacy === 'rejected';

    await clipboard.write([
      new ClipboardItem({
        'text/plain': 'Tracer prompt',
        'image/png': new Blob([image.toPNG()], { type: 'image/png' }),
      }),
    ]);
    const types = (await clipboard.read()).flatMap((item) => item.types);
    checks.imageCopied = types.includes('image/png');
    checks.promptCopied = (await clipboard.readText()) === 'Tracer prompt';
  } finally {
    await restore(saved);
  }
  const ok = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ ok, checks }));
  app.exit(ok ? 0 : 1);
});
