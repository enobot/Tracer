// Every language a person can pick. Answers can be written in any of them.
// Names come from the platform's language data (Intl), so they are spelled
// the way each language writes itself.

// ISO 639-1 (with zh split by script and Norwegian as Bokmål and Nynorsk),
// plus widely used languages that only have a three-letter code.
export const LANGUAGE_CODES = [
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh-Hans',
  'zh-Hant',
  'zu',
  'ast',
  'bho',
  'brx',
  'ceb',
  'chr',
  'ckb',
  'doi',
  'fil',
  'fur',
  'gsw',
  'hak',
  'haw',
  'hil',
  'hmn',
  'ilo',
  'kab',
  'kok',
  'kri',
  'lus',
  'mai',
  'mni',
  'nan',
  'nds',
  'nso',
  'pcm',
  'sah',
  'sat',
  'scn',
  'syr',
  'tet',
  'tzm',
  'war',
  'wuu',
  'yue',
];

// Languages whose buttons and labels are translated. Others keep English
// labels, but ChatGPT still answers in the chosen language.
export const UI_LANGUAGES = [
  'en',
  'vi',
  'es',
  'zh-Hans',
  'zh-Hant',
  'hi',
  'ar',
  'pt',
  'fr',
  'ru',
  'ja',
  'ko',
  'de',
  'id',
  'tr',
  'it',
  'fil',
  'th',
  'uk',
  'fa',
  'bn',
];

const CODES = new Set(LANGUAGE_CODES);
const RIGHT_TO_LEFT = new Set([
  'ar',
  'ckb',
  'dv',
  'fa',
  'he',
  'ks',
  'ps',
  'sd',
  'syr',
  'ug',
  'ur',
  'yi',
]);
const englishNames = new Intl.DisplayNames(['en'], { type: 'language' });
const nativeCache = new Map();

export function isLanguageCode(value) {
  return typeof value === 'string' && CODES.has(value);
}

export function englishName(code) {
  try {
    return englishNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function nativeName(code) {
  if (!nativeCache.has(code)) {
    let name = englishName(code);
    try {
      name =
        new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? name;
    } catch {
      // Intl has no data in that language; the English name is shown.
    }
    nativeCache.set(
      code,
      name.charAt(0).toLocaleUpperCase(code) + name.slice(1),
    );
  }
  return nativeCache.get(code);
}

export function isRightToLeft(code) {
  return RIGHT_TO_LEFT.has(code);
}

// Maps a system tag such as "vi-VN", "zh-TW", or "pt-BR" to a listed code.
export function matchLanguage(tag) {
  if (typeof tag !== 'string' || !tag) return 'en';
  const parts = tag.replace(/_/g, '-').split('-');
  const base = parts[0].toLowerCase();
  if (base === 'zh') {
    const rest = parts.slice(1).map((part) => part.toLowerCase());
    const traditional = rest.some((part) =>
      ['hant', 'tw', 'hk', 'mo'].includes(part),
    );
    return traditional ? 'zh-Hant' : 'zh-Hans';
  }
  if (base === 'no') return 'nb';
  return CODES.has(base) ? base : 'en';
}
