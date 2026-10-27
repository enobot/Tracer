import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ICON_PNGS } from '../src/app-icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngSize(data) {
  assert.ok(data.subarray(0, 8).equals(PNG_SIGNATURE), 'not a PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe('app icon', () => {
  it('gives the tray and window a sharp image for each display scaling', () => {
    assert.deepEqual(
      ICON_PNGS.map((entry) => entry.size),
      [16, 20, 24, 32, 40, 48, 64],
    );
    for (const { size, scaleFactor, base64 } of ICON_PNGS) {
      assert.equal(scaleFactor, size / 16);
      assert.deepEqual(pngSize(Buffer.from(base64, 'base64')), {
        width: size,
        height: size,
      });
    }
  });

  it('packages an .ico with every Windows size and a 256 px PNG', () => {
    const ico = readFileSync(path.join(root, 'assets', 'icon.ico'));
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    const count = ico.readUInt16LE(4);
    const sizes = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + 16 * index;
      const size = ico.readUInt8(entry) || 256;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      assert.deepEqual(pngSize(ico.subarray(offset, offset + length)), {
        width: size,
        height: size,
      });
      sizes.push(size);
    }
    assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
    assert.deepEqual(
      pngSize(readFileSync(path.join(root, 'assets', 'icon.png'))),
      { width: 256, height: 256 },
    );
  });
});
