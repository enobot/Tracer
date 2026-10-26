function inlineSegments(text) {
  const segments = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, match.index) });
    }
    if (match[1]) {
      segments.push({ type: 'code', text: match[1].slice(1, -1) });
    } else {
      segments.push({ type: 'strong', text: match[2].slice(2, -2) });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', text: text.slice(cursor) });
  }
  return segments;
}

export function parseMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  const blocks = [];
  const parts = text.split('```');

  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 1) {
      const code = parts[index].replace(/^[^\n]*\n/, '').replace(/\n$/, '');
      blocks.push({ type: 'code', text: code });
      continue;
    }

    for (const chunk of parts[index].split(/\n{2,}/)) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const lines = trimmed.split('\n');
      if (lines.every((line) => /^[-*] /.test(line))) {
        blocks.push({
          type: 'list',
          items: lines.map((line) => inlineSegments(line.slice(2))),
        });
      } else {
        blocks.push({
          type: 'paragraph',
          text: trimmed,
          segments: inlineSegments(trimmed),
        });
      }
    }
  }

  return blocks;
}
