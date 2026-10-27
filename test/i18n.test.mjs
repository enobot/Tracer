import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
// Vite's own parser; used to read the renderer's string literals exactly.
import { parseAst } from 'rolldown/parseAst';
import {
  CATALOGS,
  DEFAULT_PROMPT,
  hasInterface,
  isDefaultPrompt,
  translator,
} from '../src/i18n.mjs';
import { MESSAGES } from '../src/i18n-messages.mjs';
import { UI_LANGUAGES } from '../src/languages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Strings in renderer.js that are not shown to people.
const NOT_TEXT = new Set([
  'ChatGPT',
  'Gemini',
  'Claude',
  'Ctrl+Shift+Space',
  'Unauthorized IPC sender',
  'Invalid prompt',
  'Invalid screenshot',
  'Escape',
  'Enter',
  'Tab',
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'Ctrl',
  'Super',
  'Space',
  'Key',
  'Digit',
  'btn btn-quiet',
  // Main-process errors the window matches and replaces with its own text.
  'The request was cancelled.',
  'Sign-in was cancelled.',
]);

function rendererText() {
  const found = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'Literal' && typeof node.value === 'string') {
      found.add(node.value);
    }
    for (const key of Object.keys(node)) walk(node[key]);
  })(parseAst(read('src/renderer.js')));
  return [...found].filter(
    (text) =>
      (/\s/.test(text) || /^[A-Z][a-z]/.test(text)) && !NOT_TEXT.has(text),
  );
}

describe('interface translations', () => {
  it('lists each message once', () => {
    assert.equal(new Set(MESSAGES).size, MESSAGES.length);
  });

  it('translates every message in every catalog, keeping placeholders', () => {
    for (const [code, catalog] of Object.entries(CATALOGS)) {
      assert.deepEqual(
        Object.keys(catalog).sort(),
        [...MESSAGES].sort(),
        `${code} has missing or extra messages`,
      );
      for (const message of MESSAGES) {
        const translated = catalog[message];
        assert.equal(typeof translated, 'string', `${code}: ${message}`);
        assert.ok(translated.trim(), `${code} is empty for: ${message}`);
        assert.deepEqual(
          placeholders(translated),
          placeholders(message),
          `${code} changed the placeholders in: ${message}`,
        );
      }
    }
  });

  it('matches the languages marked as fully translated', () => {
    assert.deepEqual(
      [...UI_LANGUAGES].sort(),
      ['en', ...Object.keys(CATALOGS)].sort(),
    );
  });

  it('covers every visible string in the renderer and the page', () => {
    const known = new Set(MESSAGES);
    const missing = rendererText().filter((text) => !known.has(text));
    assert.deepEqual(missing, [], 'renderer text without a translation entry');
    const html = read('index.html');
    const attributes = [
      ...html.matchAll(/data-i18n(?:-label|-placeholder|-alt)?="([^"]+)"/g),
    ].map((match) => match[1].replace(/&amp;/g, '&'));
    assert.ok(attributes.length > 20);
    assert.deepEqual(
      attributes.filter((text) => !known.has(text)),
      [],
      'page text without a translation entry',
    );
  });

  it('has no message that the app never shows', () => {
    const sources = [
      'src/renderer.js',
      'index.html',
      'src/main.js',
      'src/chatgpt-plan.mjs',
      'src/chatgpt-runtime.mjs',
      'src/i18n.mjs',
    ]
      .map(read)
      .join('\n')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
    const unused = MESSAGES.filter(
      (message) => !sources.includes(message.replace(/\s+/g, ' ')),
    );
    assert.deepEqual(unused, []);
  });

  it('fills placeholders and falls back to English', () => {
    const t = translator('vi');
    assert.equal(
      t('Hotkey set to {hotkey}.', { hotkey: 'Ctrl+Alt+K' }),
      'Đã đặt phím tắt là Ctrl+Alt+K.',
    );
    assert.equal(t('Not a known message'), 'Not a known message');
    assert.equal(t('constructor'), 'constructor');
    assert.equal(translator('xx')('Send'), 'Send');
    assert.equal(hasInterface('vi'), true);
    assert.equal(hasInterface('en'), true);
    assert.equal(hasInterface('sw'), false);
  });

  it('recognizes the untouched default prompt in any language', () => {
    assert.equal(isDefaultPrompt(DEFAULT_PROMPT), true);
    assert.equal(isDefaultPrompt(CATALOGS.vi[DEFAULT_PROMPT]), true);
    assert.equal(isDefaultPrompt('Translate this into French'), false);
  });
});
