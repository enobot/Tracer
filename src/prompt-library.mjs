const TEXT_LIMIT = 2000;
const TITLE_LIMIT = 80;
const SAVED_LIMIT = 100;
const PAST_LIMIT = 50;

function cleanText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TEXT_LIMIT || trimmed.includes('\u0000')) {
    return '';
  }
  return trimmed;
}

function stripControls(value) {
  let result = '';
  for (const char of value) {
    result += char.charCodeAt(0) < 32 ? ' ' : char;
  }
  return result;
}

function cleanTitle(value, text) {
  const source =
    typeof value === 'string' && value.trim() ? value : text.split('\n')[0];
  const title = stripControls(source).trim();
  if (!title) return 'Prompt';
  return title.slice(0, TITLE_LIMIT);
}

function cleanItem(item, kind) {
  if (!item || typeof item !== 'object') return null;
  const text = cleanText(item.text);
  if (!text || typeof item.id !== 'string' || !item.id || item.id.length > 80) {
    return null;
  }
  const stamp = kind === 'past' ? item.usedAt : item.updatedAt;
  return {
    id: item.id,
    text,
    title: cleanTitle(item.title, text),
    favorite: item.favorite === true,
    ...(kind === 'past'
      ? { usedAt: typeof stamp === 'string' ? stamp : '' }
      : {
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
        }),
  };
}

export function emptyLibrary() {
  return { historyEnabled: true, saved: [], past: [] };
}

export function normalizeLibrary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const saved = [];
  const past = [];
  for (const item of Array.isArray(source.saved) ? source.saved : []) {
    const clean = cleanItem(item, 'saved');
    if (clean) saved.push(clean);
    if (saved.length >= SAVED_LIMIT) break;
  }
  for (const item of Array.isArray(source.past) ? source.past : []) {
    const clean = cleanItem(item, 'past');
    if (clean) past.push(clean);
    if (past.length >= PAST_LIMIT) break;
  }
  return {
    historyEnabled: source.historyEnabled !== false,
    saved,
    past,
  };
}

function clone(state) {
  return normalizeLibrary(state);
}

export function savePrompt(state, text, now, id) {
  const clean = cleanText(text);
  if (!clean) return { state, status: 'invalid' };
  const current = clone(state);
  if (current.saved.some((item) => item.text === clean)) {
    return { state: current, status: 'duplicate' };
  }
  current.saved.unshift({
    id,
    text: clean,
    title: cleanTitle('', clean),
    favorite: false,
    updatedAt: now,
  });
  current.saved = current.saved.slice(0, SAVED_LIMIT);
  return { state: current, status: 'saved' };
}

export function updatePrompt(state, id, { title, text }, now) {
  const current = clone(state);
  const item = current.saved.find((entry) => entry.id === id);
  if (!item) return { state: current, status: 'missing' };
  const clean = cleanText(text);
  if (!clean) return { state: current, status: 'invalid' };
  if (current.saved.some((entry) => entry.id !== id && entry.text === clean)) {
    return { state: current, status: 'duplicate' };
  }
  item.text = clean;
  item.title = cleanTitle(title, clean);
  item.updatedAt = now;
  return { state: current, status: 'saved' };
}

export function deletePrompt(state, id) {
  const current = clone(state);
  current.saved = current.saved.filter((item) => item.id !== id);
  current.past = current.past.filter((item) => item.id !== id);
  return current;
}

export function setFavorite(state, id, favorite) {
  const current = clone(state);
  let found = false;
  for (const item of [...current.saved, ...current.past]) {
    if (item.id === id) {
      item.favorite = favorite === true;
      found = true;
    }
  }
  return found ? current : state;
}

export function recordSubmission(state, text, now, id) {
  const current = clone(state);
  if (!current.historyEnabled) return current;
  const clean = cleanText(text);
  if (!clean) return current;
  const previous = current.past.find((item) => item.text === clean);
  current.past = [
    {
      id: previous?.id || id,
      text: clean,
      title: cleanTitle('', clean),
      favorite: previous?.favorite === true,
      usedAt: now,
    },
    ...current.past.filter((item) => item.text !== clean),
  ].slice(0, PAST_LIMIT);
  return current;
}

export function clearPast(state) {
  const current = clone(state);
  current.past = [];
  return current;
}

export function setHistoryEnabled(state, enabled) {
  const current = clone(state);
  current.historyEnabled = enabled === true;
  return current;
}

export function listFavorites(state) {
  const current = normalizeLibrary(state);
  const seen = new Set();
  const items = [];
  for (const item of [...current.saved, ...current.past]) {
    if (!item.favorite) continue;
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}
