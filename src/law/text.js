/**
 * Text normalization shared by every converter.
 */

const spaces = /[\t\f\v \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+/gu;

/** Collapse whitespace inside one line and apply Unicode NFC. */
export function cleanLine(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\u200b\u00ad]/gu, '')
    .replace(spaces, ' ')
    .trim();
}

/** Normalize multi-line text: clean each line and drop blank runs. */
export function cleanText(text) {
  return String(text ?? '')
    .split(/\r\n|\r|\n/u)
    .map(cleanLine)
    .filter(Boolean)
    .join('\n');
}

/** URL- and anchor-safe identifier fragment. */
export function slug(text) {
  return (
    cleanLine(text)
      .toLowerCase()
      .replace(/[§¶]/gu, '')
      .replace(/[^\p{L}\p{N}.]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'x'
  );
}

const romanValues = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Convert a Roman numeral to an integer, or return null. */
export function fromRoman(text) {
  const value = String(text).toLowerCase();
  if (!/^[ivxlcdm]+$/u.test(value)) {
    return null;
  }
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const current = romanValues[value[index]];
    const next = romanValues[value[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

const chineseDigits = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const chineseUnits = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** Convert a Chinese numeral (e.g. 一百二十三) to an integer, or null. */
export function fromChinese(text) {
  const value = String(text);
  if (/^\d+$/u.test(value)) {
    return Number(value);
  }
  if (!/^[零〇一二两三四五六七八九十百千万]+$/u.test(value)) {
    return null;
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of value) {
    if (char in chineseDigits) {
      digit = chineseDigits[char];
      continue;
    }
    const unit = chineseUnits[char];
    if (unit === 10000) {
      total += (section + digit) * unit;
      section = 0;
    } else {
      section += (digit || 1) * unit;
    }
    digit = 0;
  }
  return total + section + digit;
}

const ordinalStems = [
  ['перв', 1],
  ['втор', 2],
  ['трет', 3],
  ['четверт', 4],
  ['пят', 5],
  ['шест', 6],
  ['седьм', 7],
  ['восьм', 8],
  ['девят', 9],
  ['десят', 10],
];
const englishOrdinals = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

// French numbers a first article "Article premier".
const firstWords = new Set(['premier', 'première']);

/** Convert an ordinal word (первая, второй, One, premier) to an integer. */
export function fromOrdinalWord(text) {
  const value = String(text).toLowerCase();
  const english = englishOrdinals.indexOf(value);
  if (english >= 0) {
    return english + 1;
  }
  if (firstWords.has(value)) {
    return 1;
  }
  if (!/^[а-яё]+$/u.test(value)) {
    return null;
  }
  const found = ordinalStems.find(([stem]) => value.startsWith(stem));
  return found ? found[1] : null;
}

/** Normalize a unit number for use in ids: Roman/Chinese/words → Arabic. */
export function normalizeNumber(text) {
  const value = cleanLine(text).replace(/[.:]+$/u, '');
  const word = fromOrdinalWord(value);
  if (word !== null) {
    return String(word);
  }
  const chinese = fromChinese(value);
  if (chinese !== null && !/^\d+$/u.test(value)) {
    return String(chinese);
  }
  // Greek texts write Roman numerals with Greek capitals (Ι, Χ).
  const roman = fromRoman(value.replace(/Ι/gu, 'I').replace(/Χ/gu, 'X'));
  if (roman !== null && value.length > 0 && !/^[a-z]$/u.test(value)) {
    return String(roman);
  }
  return value;
}
