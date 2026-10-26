const express = require('express');

const SCREENSHOT_CHARS = 20_000_000;
const PROMPT_CHARS = 2000;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

function isLoopbackAddress(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function validateAnalyzeBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid request' };
  }

  const { screenshot, prompt } = body;
  if (typeof screenshot !== 'string') {
    return { ok: false, status: 400, error: 'Invalid screenshot' };
  }
  if (
    screenshot.length === 0 ||
    screenshot.length > SCREENSHOT_CHARS ||
    !PNG_DATA_URL.test(screenshot)
  ) {
    return { ok: false, status: 400, error: 'Invalid screenshot' };
  }
  const encoded = screenshot.slice(screenshot.indexOf(',') + 1);
  if (encoded.length % 4 !== 0) {
    return { ok: false, status: 400, error: 'Invalid screenshot' };
  }

  if (
    typeof prompt !== 'string' ||
    prompt.length > PROMPT_CHARS ||
    !prompt.trim()
  ) {
    return { ok: false, status: 400, error: 'Invalid prompt' };
  }

  return { ok: true, screenshotSize: screenshot.length };
}

function createApp({ maxPostsPerMinute = 30 } = {}) {
  const app = express();
  const posts = new Map();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '21mb' }));

  app.use((req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Tracer backend',
    });
  });

  app.post('/analyze', (req, res) => {
    const address = req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (posts.get(address) || []).filter(
      (time) => now - time < 60_000,
    );
    if (recent.length >= maxPostsPerMinute) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    recent.push(now);
    posts.set(address, recent);

    const result = validateAnalyzeBody(req.body);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({
      success: true,
      message: 'Backend received screenshot and prompt',
      screenshotSize: result.screenshotSize,
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error?.status || error?.statusCode;
    if (status === 413 || error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request is too large' });
    }
    return res.status(400).json({ error: 'Invalid request' });
  });

  return app;
}

if (require.main === module) {
  const server = createApp().listen(3001, '127.0.0.1', () => {
    console.log('Tracer backend running on http://127.0.0.1:3001');
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
}

module.exports = {
  SCREENSHOT_CHARS,
  PROMPT_CHARS,
  createApp,
  isLoopbackAddress,
  validateAnalyzeBody,
};
