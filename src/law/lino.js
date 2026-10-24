/**
 * Links Notation (https://github.com/link-foundation/links-notation) helpers
 * for the law registry and catalog.
 *
 * Records are written as indented links:
 *
 *   us-code:
 *     jurisdiction US
 *     languages en
 *     legal:
 *       status public-domain
 *
 * `name:` opens a nested record, `key value` is a scalar, and
 * `key a b c` is a list. Keys listed in `listKeys` are always read as lists
 * so single-element lists survive a round trip.
 */
import { Parser } from 'links-notation';
import { encode, decode } from 'lino-objects-codec';

const bare = /^[^\s()'":`]+$/u;

export function quote(value) {
  const text = String(value);
  if (text !== '' && bare.test(text)) {
    return text;
  }
  if (/[\r\n]/u.test(text)) {
    throw new Error('Multiline values must use encodeValue()');
  }
  if (!text.includes("'")) {
    return `'${text}'`;
  }
  if (!text.includes('"')) {
    return `"${text}"`;
  }
  if (!text.includes('`')) {
    return `\`${text}\``;
  }
  // A doubled quote is closed only by a doubled quote.
  return `''${text}''`;
}

function scalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return quote(value);
}

/**
 * Serialize a plain object tree into indented Links Notation.
 * @param {Record<string, unknown>} object
 * @param {number} [depth]
 * @returns {string}
 */
export function toLino(object, depth = 0) {
  const pad = '  '.repeat(depth);
  const lines = [];
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      if (value.every((item) => typeof item !== 'object' || item === null)) {
        lines.push(`${pad}${quote(key)} ${value.map(scalar).join(' ')}`);
        continue;
      }
      lines.push(`${pad}${quote(key)}:`);
      value.forEach((item, index) => {
        lines.push(`${pad}  ${index}:`);
        lines.push(toLino(item, depth + 2));
      });
      continue;
    }
    if (typeof value === 'object') {
      lines.push(`${pad}${quote(key)}:`);
      const body = toLino(value, depth + 1);
      if (body) {
        lines.push(body);
      }
      continue;
    }
    lines.push(`${pad}${quote(key)} ${scalar(value)}`);
  }
  return lines.filter(Boolean).join('\n');
}

function atom(link) {
  return link.id ?? '';
}

function coerce(text) {
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  return text;
}

function fromValues(values, listKeys) {
  const object = {};
  for (const item of values) {
    if (item.id !== null && item.id !== undefined && item.values?.length) {
      object[item.id] = fromValues(item.values, listKeys);
      continue;
    }
    if (!item.values?.length) {
      object[atom(item)] = true;
      continue;
    }
    const [head, ...rest] = item.values;
    const key = atom(head);
    const items = rest.map((value) => coerce(atom(value)));
    object[key] = items.length === 1 && !listKeys.has(key) ? items[0] : items;
  }
  return arrayLike(object);
}

function arrayLike(object) {
  const keys = Object.keys(object);
  if (keys.length && keys.every((key, index) => key === String(index))) {
    return keys.map((key) => object[key]);
  }
  return object;
}

/**
 * Parse indented Links Notation into a plain object tree.
 * @param {string} text
 * @param {{ listKeys?: Iterable<string> }} [options]
 * @returns {Record<string, any>}
 */
export function fromLino(text, { listKeys = [] } = {}) {
  const keys = new Set(listKeys);
  const links = new Parser().parse(text);
  const object = {};
  for (const link of links) {
    if (link.id !== null && link.id !== undefined) {
      object[link.id] = link.values?.length
        ? fromValues(link.values, keys)
        : true;
    } else if (link.values?.length) {
      Object.assign(object, fromValues([link], keys));
    }
  }
  return object;
}

/**
 * Encode an arbitrary value (including multiline law text) with
 * lino-objects-codec so it round-trips exactly.
 */
export function encodeValue(value) {
  return encode({ obj: value });
}

export function decodeValue(notation) {
  return decode({ notation });
}
