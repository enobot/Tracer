import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import rendererConfig from '../vite.renderer.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Electron source boundaries', () => {
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  const renderer = read('src/renderer.js');
  const policy = read('src/security-policy.mjs');
  const html = read('index.html');
  const forge = read('forge.config.mjs');
  const backend = read('backend/server.js');
  const gitignore = read('.gitignore');
  const manifest = read('package.json');

  it('locks the window down and opens DevTools only for the dev server', () => {
    assert.match(main, /secureWebPreferences/);
    assert.match(policy, /contextIsolation:\s*true/);
    assert.match(policy, /nodeIntegration:\s*false/);
    assert.match(policy, /sandbox:\s*true/);
    assert.match(policy, /webSecurity:\s*true/);
    assert.doesNotMatch(main, /nodeIntegration:\s*true/);
    assert.doesNotMatch(main, /contextIsolation:\s*false/);
    assert.doesNotMatch(main, /sandbox:\s*false/);
    assert.doesNotMatch(main, /webSecurity:\s*false/);
    assert.equal((main.match(/openDevTools\(/g) || []).length, 1);
    assert.match(main, /if \(devServerUrl\) \{[^}]*openDevTools\(\)/s);
    assert.match(main, /unregisterAll\(\)/);
    assert.match(
      main,
      /setWindowOpenHandler\(\(\) => \(\{ action: ["']deny["'] \}\)\)/,
    );
    assert.match(main, /setDevicePermissionHandler\(\(\) => false\)/);
    assert.doesNotMatch(main, /child_process|exec\(|execFile\(/);
    assert.match(main, /shell\.openExternal\(assertOpenable\(/);
    assert.doesNotMatch(main, /accessToken|refreshToken|id_token|sk-/);
    assert.equal((main.match(/console\.log/g) || []).length, 1);
  });

  it('keeps one app instance and never grants a page a screen stream', () => {
    assert.match(main, /app\.requestSingleInstanceLock\(\)/);
    assert.match(main, /app\.on\(['"]second-instance['"]/);
    assert.match(
      main,
      /setDisplayMediaRequestHandler\(\(_request, callback\) => \{\s*callback\(null\);\s*\}\)/,
    );
  });

  it('keeps running in the tray until the user quits, without blocking sign-out', () => {
    assert.match(main, /new Tray\(appIcon\(\)\)/);
    // Closing hides the window, unless Tracer is quitting or has no tray icon.
    assert.match(
      main,
      /on\('close', \(event\) => \{\s*if \(quitting \|\| !tray\) return;\s*event\.preventDefault\(\);\s*mainWindow\.hide\(\);/,
    );
    assert.match(main, /app\.on\('before-quit', \(\) => \{\s*quitting = true;/);
    for (const event of ['query-session-end', 'session-end']) {
      assert.match(
        main,
        new RegExp(`on\\('${event}', \\(\\) => \\{\\s*quitting = true;`),
      );
    }
    assert.match(
      main,
      /label: t\('Quit Tracer'\), click: \(\) => app\.quit\(\)/,
    );
    assert.match(main, /will-quit[^]*tray\?\.destroy\(\)/);
    // A capture started from the tray and cancelled leaves Tracer in the tray.
    assert.match(
      main,
      /returnToTray = Boolean\(tray\) && !mainWindow\.isVisible\(\);/,
    );
    assert.match(
      main,
      /if \(outcome !== 'cancel' \|\| !returnToTray\) restoreMain\(\);/,
    );
    assert.match(
      main,
      /'tracer:set-language', \(event, code\) => \{\s*requireSender\(event\);\s*if \(!isLanguageCode\(code\)\) return/,
    );
    assert.match(forge, /icon: 'assets\/icon'/);
    assert.match(forge, /setupIcon: 'assets\/icon\.ico'/);
  });

  it('awaits the Electron 44 clipboard API for Gemini and Claude handoffs', () => {
    // clipboard.write({ text, image }) is the pre-44 form. On 44 it returns a
    // rejected promise, so nothing is copied while Tracer reports success.
    assert.doesNotMatch(main, /clipboard\.write\(\s*\{/);
    assert.match(main, /await clipboard\.write\(\[\s*new ClipboardItem\(\{/);
    assert.match(main, /'image\/png': new Blob\(/);
    assert.match(main, /'text\/plain': prompt/);
  });

  it('exposes a narrow preload bridge and one hotkey listener', () => {
    assert.match(
      preload,
      /contextBridge\.exposeInMainWorld\(\s*["']tracer["']/,
    );
    assert.match(preload, /hotkeys\.emit\(\)/);
    assert.doesNotMatch(preload, /exposeInMainWorld\(\s*["']ipcRenderer["']/);
    assert.doesNotMatch(preload, /nodeIntegration|child_process|shell/);
    assert.equal((preload.match(/ipcRenderer\.on\(/g) || []).length, 1);
    assert.equal(policy.includes('from '), false);
  });

  it('renders user content as text and does not call a remote AI service', () => {
    assert.match(renderer, /textContent/);
    assert.match(renderer, /contextmenu/);
    assert.match(renderer, /preventDefault\(\)/);
    assert.doesNotMatch(renderer, /getDisplayMedia|getUserMedia/);
    assert.match(main, /desktopCapturer\.getSources/);
    assert.match(main, /selectionToCrop/);
    assert.match(main, /captureGate\.leave\(\)/);
    assert.match(html, /Save Prompt/);
    assert.match(html, /Set Hotkey/);
    assert.match(html, /Past Prompts/);
    assert.match(html, /Favorites/);
    assert.match(html, /Saved Prompts/);
    assert.doesNotMatch(
      renderer,
      /innerHTML|outerHTML|document\.write|eval\(|new Function|openai|fetch\(|XMLHttpRequest/,
    );
    assert.doesNotMatch(main, /net\.fetch|https\.request|3001/);
    assert.doesNotMatch(main, /chat\/completions|backend-api|document\.cookie/);
    const plan = read('src/chatgpt-plan.mjs');
    const runtime = read('src/chatgpt-runtime.mjs');
    assert.match(plan, /https:\/\/api\.openai\.com\/v1\/responses/);
    assert.match(plan, /input_image/);
    assert.match(plan, /store: false/);
    assert.match(plan, /stream: true/);
    assert.doesNotMatch(`${plan}\n${runtime}`, /chat\/completions|backend-api/);
    assert.doesNotMatch(`${plan}\n${runtime}`, /sk-[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(runtime, /console\.(log|debug|info|error|warn)/);
    assert.doesNotMatch(preload, /accessToken|refreshToken|id_token/);
    assert.doesNotMatch(renderer, /127\.0\.0\.1:3001|localhost:3001/);
    assert.doesNotMatch(backend, /openai|dotenv/);
    assert.doesNotMatch(
      backend,
      /console\.(log|info|debug|error|warn)\([^;\n]*req/,
    );
    assert.match(html, /maxlength="2000"/);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
  });

  it('keeps the local backend on loopback and out of the desktop package', () => {
    assert.match(backend, /listen\(\s*3001,\s*["']127\.0\.0\.1["']/);
    assert.match(backend, /require\.main === module/);
    assert.match(forge, /shouldIgnorePackagePath/);
    assert.match(forge, /GrantFileProtocolExtraPrivileges\]:\s*false/);
    const plugin = rendererConfig.plugins.find(
      (entry) => entry.name === 'tracer-content-security-policy',
    );
    const htmlWithPolicy = plugin.transformIndexHtml('<head></head>');
    assert.match(htmlWithPolicy, /script-src 'self'/);
    assert.equal(htmlWithPolicy.includes('unsafe-eval'), false);
    assert.equal(rendererConfig.build.sourcemap, false);
    assert.match(gitignore, /^\.env$/m);
    assert.match(gitignore, /\*\.pem/);
    assert.equal(JSON.parse(manifest).devDependencies.electron, '44.9.3');
  });
});
