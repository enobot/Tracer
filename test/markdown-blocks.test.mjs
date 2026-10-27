import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inlineSegments, parseMarkdown } from '../src/markdown-blocks.mjs';

const textOf = (segments) => segments.map((segment) => segment.text).join('');

describe('answer formatting', () => {
  it('keeps numbered steps written on separate lines apart', () => {
    // The shape of a real GPT-6.1-Sol answer that rendered as one paragraph.
    const [intro, steps] = parseMarkdown(
      'Still to do:\n1. Ask a follow-up.\n2. Click **Disconnect**.\n3. Run the paste test.',
    );
    assert.equal(intro.type, 'paragraph');
    assert.equal(steps.type, 'list');
    assert.equal(steps.ordered, true);
    assert.equal(steps.start, 1);
    assert.deepEqual(steps.items.map(textOf), [
      'Ask a follow-up.',
      'Click Disconnect.',
      'Run the paste test.',
    ]);
    assert.equal(steps.items[1][1].type, 'strong');
  });

  it('keeps a numbered list that restarts after a blank line in order', () => {
    const blocks = parseMarkdown('1. One\n\n2. Two');
    assert.deepEqual(
      blocks.map((block) => [block.type, block.start]),
      [
        ['list', 1],
        ['list', 2],
      ],
    );
  });

  it('keeps single line breaks inside a paragraph', () => {
    const [paragraph] = parseMarkdown('First line\nSecond line');
    assert.equal(paragraph.type, 'paragraph');
    assert.deepEqual(paragraph.lines.map(textOf), [
      'First line',
      'Second line',
    ]);
  });

  it('turns quotes, dividers, headings, and italics into blocks', () => {
    const blocks = parseMarkdown(
      '## Result\n\n> Translate all the text.\n\n---\n\n*Too small to read.*',
    );
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['heading', 'quote', 'rule', 'paragraph'],
    );
    assert.equal(blocks[0].level, 2);
    assert.equal(textOf(blocks[1].lines[0]), 'Translate all the text.');
    assert.deepEqual(blocks[3].lines[0], [
      { type: 'em', text: 'Too small to read.' },
    ]);
  });

  it('builds a table from pipe rows with a divider', () => {
    const [table] = parseMarkdown(
      '| English | Vietnamese |\n| --- | --- |\n| Hello | Xin chào |\n| Thanks | Cảm ơn |',
    );
    assert.equal(table.type, 'table');
    assert.deepEqual(table.header.map(textOf), ['English', 'Vietnamese']);
    assert.deepEqual(
      table.rows.map((row) => row.map(textOf)),
      [
        ['Hello', 'Xin chào'],
        ['Thanks', 'Cảm ơn'],
      ],
    );
  });

  it('leaves snake_case, arithmetic, and unmatched markers as plain text', () => {
    for (const text of [
      'Set max_output_tokens in config_file.json',
      'Compute 2*3*4 first',
      'A lone * star',
    ]) {
      assert.deepEqual(inlineSegments(text), [{ type: 'text', text }]);
    }
  });

  it('shows links as text and never as a clickable target', () => {
    assert.deepEqual(inlineSegments('[docs](https://example.com/a)'), [
      { type: 'text', text: 'docs (https://example.com/a)' },
    ]);
    assert.deepEqual(inlineSegments('[click](javascript:alert(1))'), [
      { type: 'text', text: 'click (javascript:alert(1)' },
      { type: 'text', text: ')' },
    ]);
  });

  it('keeps code fences verbatim, including markup', () => {
    const [code] = parseMarkdown(
      '```html\n<script>alert(1)</script>\n  **not bold**\n```',
    );
    assert.deepEqual(code, {
      type: 'code',
      text: '<script>alert(1)</script>\n  **not bold**',
    });
  });

  it('only ever produces the known block and segment types', () => {
    const blocks = parseMarkdown(
      '<img src=x onerror=alert(1)>\n# <b>title</b>\n- <i>item</i>\n> <svg onload=alert(1)>',
    );
    const blockTypes = new Set([
      'paragraph',
      'heading',
      'list',
      'quote',
      'rule',
      'table',
      'code',
    ]);
    const segmentTypes = new Set(['text', 'code', 'strong', 'em']);
    for (const block of blocks) {
      assert.equal(blockTypes.has(block.type), true, block.type);
      const groups = [
        ...(block.lines ?? []),
        ...(block.items ?? []),
        ...(block.segments ? [block.segments] : []),
      ];
      for (const segment of groups.flat()) {
        assert.equal(segmentTypes.has(segment.type), true, segment.type);
      }
    }
    assert.match(JSON.stringify(blocks), /<img src=x onerror=alert\(1\)>/);
  });
});
