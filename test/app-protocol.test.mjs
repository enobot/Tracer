import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { APP_ORIGIN, resolveAppFile } from '../src/app-protocol.mjs';

const ROOT = path.resolve('G:/Tracer/.vite/renderer/main_window');

describe('tracer:// app protocol', () => {
  it('serves files inside the renderer folder', () => {
    assert.equal(APP_ORIGIN, 'tracer://app');
    assert.equal(
      resolveAppFile('tracer://app/index.html?overlay=1&display=2', ROOT),
      path.join(ROOT, 'index.html'),
    );
    assert.equal(
      resolveAppFile('tracer://app/assets/index-abc.js', ROOT),
      path.join(ROOT, 'assets', 'index-abc.js'),
    );
  });

  it('refuses other hosts, schemes, and anything outside the folder', () => {
    // URL parsing stops ".." (also written %2e%2e) at the root, so these
    // stay inside the folder.
    for (const url of [
      'tracer://app/../../build/main.cjs',
      'tracer://app/%2e%2e/%2e%2e/build/main.cjs',
    ]) {
      assert.equal(
        resolveAppFile(url, ROOT),
        path.join(ROOT, 'build', 'main.cjs'),
      );
    }
    // Encoded separators only become ".." after decoding; those are refused.
    for (const url of [
      'tracer://app/',
      'tracer://app/..%5c..%5cbuild%5cmain.cjs',
      'tracer://app/x%2f..%2f..%2f..%2fbuild%2fmain.cjs',
      'tracer://app/assets/%00.js',
      'tracer://app/%E0%A4%A',
      'tracer://other/index.html',
      'file:///G:/Tracer/.vite/renderer/main_window/index.html',
      'https://app/index.html',
      'not a url',
    ]) {
      assert.equal(resolveAppFile(url, ROOT), null, url);
    }
  });
});
