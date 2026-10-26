import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { LIMITS } from '../src/security-policy.mjs';

const require = createRequire(import.meta.url);
const {
  PROMPT_CHARS,
  SCREENSHOT_CHARS,
  createApp,
  isLoopbackAddress,
  validateAnalyzeBody,
} = require('../backend/server.js');

const PNG = 'data:image/png;base64,aaaa';

async function withServer(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('local analyze API', () => {
  it('uses the same size limits as the desktop IPC check', () => {
    assert.equal(SCREENSHOT_CHARS, LIMITS.screenshotChars);
    assert.equal(PROMPT_CHARS, LIMITS.promptChars);
  });

  it('recognizes loopback clients only', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('::1'), true);
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddress('192.168.0.10'), false);
    assert.equal(isLoopbackAddress(undefined), false);
  });

  it('accepts a prompt without returning the image or the prompt', () => {
    const result = validateAnalyzeBody({
      screenshot: PNG,
      prompt: 'rm -rf /; <script>alert(1)</script>',
    });
    assert.equal(result.ok, true);
    assert.equal(result.screenshotSize, PNG.length);
    assert.equal('screenshot' in result, false);
    assert.equal('prompt' in result, false);
    assert.equal(
      validateAnalyzeBody({ screenshot: PNG, prompt: '   ' }).error,
      'Invalid prompt',
    );
    assert.equal(
      validateAnalyzeBody({
        screenshot: 'https://evil.example/a.png',
        prompt: 'Explain',
      }).error,
      'Invalid screenshot',
    );
  });

  it('answers health checks and hides the server banner', async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.deepEqual(await response.json(), {
        status: 'ok',
        service: 'Tracer backend',
      });
    });
  });

  it('returns a size-only success response for a valid analyze request', async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          screenshot: PNG,
          prompt: 'Explain this screen.',
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.screenshotSize, PNG.length);
      assert.equal('screenshot' in body, false);
      assert.equal('prompt' in body, false);
      assert.doesNotMatch(JSON.stringify(body), /Explain this screen/);
    });
  });

  it('rejects invalid JSON without echoing the body', async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"screenshot":',
      });
      assert.equal(response.status, 400);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { error: 'Invalid request' });
      assert.doesNotMatch(text, /SyntaxError|screenshot|at\s/);
    });
  });

  it('rate-limits repeated analyze posts', async () => {
    await withServer({ maxPostsPerMinute: 2 }, async (baseUrl) => {
      const send = () =>
        fetch(`${baseUrl}/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ screenshot: PNG, prompt: 'Explain' }),
        });

      assert.equal((await send()).status, 200);
      assert.equal((await send()).status, 200);
      assert.equal((await send()).status, 429);
    });
  });
});
