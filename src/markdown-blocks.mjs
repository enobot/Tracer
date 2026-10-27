// Turns model text into a few block types that the window builds with
// textContent. Nothing here produces HTML, so an answer cannot inject markup.

const INLINE =
  /`(?<code>[^`\n]+)`|\*\*(?<strong>[^*\n]+)\*\*|(?<![\w*])\*(?<em>[^*\s](?:[^*\n]*[^*\s])?)\*(?![\w*])|(?<!\w)_(?<under>[^_\s](?:[^_\n]*[^_\s])?)_(?!\w)|\[(?<label>[^\]\n]+)\]\((?<href>[^)\s]+)\)/g;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function inlineSegments(text) {
  const segments = [];
  let cursor = 0;
  for (const match of String(text).matchAll(INLINE)) {
    if (match.index > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, match.index) });
    }
    const found = match.groups;
    if (found.code !== undefined) {
      segments.push({ type: 'code', text: found.code });
    } else if (found.strong !== undefined) {
      segments.push({ type: 'strong', text: found.strong });
    } else if (found.em !== undefined || found.under !== undefined) {
      segments.push({ type: 'em', text: found.em ?? found.under });
    } else {
      // Links stay as text: Tracer never navigates from an answer.
      segments.push({
        type: 'text',
        text:
          found.label === found.href
            ? found.href
            : `${found.label} (${found.href})`,
      });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', text: text.slice(cursor) });
  }
  return segments;
}

function listItem(line) {
  const numbered = NUMBERED.exec(line);
  if (numbered) {
    return { ordered: true, number: Number(numbered[1]), text: numbered[2] };
  }
  const bullet = BULLET.exec(line);
  if (bullet) return { ordered: false, number: 1, text: bullet[1] };
  return null;
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => inlineSegments(cell.trim()));
}

function startsTable(lines, index) {
  return (
    lines[index].includes('|') &&
    index + 1 < lines.length &&
    TABLE_DIVIDER.test(lines[index + 1])
  );
}

function startsBlock(lines, index) {
  const line = lines[index];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    startsTable(lines, index) ||
    listItem(line) !== null
  );
}

export function parseMarkdown(source) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const code = [];
      index += 1;
      while (
        index < lines.length &&
        !lines[index].trimStart().startsWith(fence[1])
      ) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        segments: inlineSegments(heading[2]),
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        const text = lines[index].replace(QUOTE, '');
        if (text.trim()) quoted.push(inlineSegments(text.trim()));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    if (startsTable(lines, index)) {
      const header = tableCells(line);
      const rows = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes('|')
      ) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const first = listItem(line);
    if (first) {
      const items = [];
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (item && item.ordered === first.ordered) {
          items.push(inlineSegments(item.text));
          index += 1;
        } else if (
          !item &&
          items.length &&
          /^\s{2,}\S/.test(lines[index]) &&
          !startsBlock(lines, index)
        ) {
          // An indented line continues the item above it.
          items[items.length - 1].push(
            { type: 'text', text: ' ' },
            ...inlineSegments(lines[index].trim()),
          );
          index += 1;
        } else {
          break;
        }
      }
      blocks.push({
        type: 'list',
        ordered: first.ordered,
        start: first.number,
        items,
      });
      continue;
    }

    // A paragraph keeps its line breaks, so steps written on separate lines
    // do not run together.
    const paragraph = [inlineSegments(line.trim())];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines, index)
    ) {
      paragraph.push(inlineSegments(lines[index].trim()));
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }
  return blocks;
}
