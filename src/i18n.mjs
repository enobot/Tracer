// Interface text in other languages. Each catalog maps the English text of
// a message to its translation; text without an entry stays in English.
import ar from './locales/ar.mjs';
import bn from './locales/bn.mjs';
import de from './locales/de.mjs';
import es from './locales/es.mjs';
import fa from './locales/fa.mjs';
import fil from './locales/fil.mjs';
import fr from './locales/fr.mjs';
import hi from './locales/hi.mjs';
import id from './locales/id.mjs';
import it from './locales/it.mjs';
import ja from './locales/ja.mjs';
import ko from './locales/ko.mjs';
import pt from './locales/pt.mjs';
import ru from './locales/ru.mjs';
import th from './locales/th.mjs';
import tr from './locales/tr.mjs';
import uk from './locales/uk.mjs';
import vi from './locales/vi.mjs';
import zhHans from './locales/zh-Hans.mjs';
import zhHant from './locales/zh-Hant.mjs';

export const CATALOGS = {
  ar,
  bn,
  de,
  es,
  fa,
  fil,
  fr,
  hi,
  id,
  it,
  ja,
  ko,
  pt,
  ru,
  th,
  tr,
  uk,
  vi,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};

export const DEFAULT_PROMPT = 'Explain what is visible in this screenshot.';

export function hasInterface(code) {
  return code === 'en' || Object.hasOwn(CATALOGS, code);
}

// Returns t(text, values): the translation of an English message with its
// {name} placeholders filled in.
export function translator(code) {
  const catalog = Object.hasOwn(CATALOGS, code) ? CATALOGS[code] : {};
  return (text, values = {}) => {
    const template = Object.hasOwn(catalog, text) ? catalog[text] : text;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  };
}

// The default prompt in every interface language, so a prompt nobody edited
// can follow a language change.
export function isDefaultPrompt(text) {
  const value = String(text ?? '').trim();
  return (
    value === DEFAULT_PROMPT ||
    Object.values(CATALOGS).some((catalog) => catalog[DEFAULT_PROMPT] === value)
  );
}
