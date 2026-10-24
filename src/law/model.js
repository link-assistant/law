/**
 * Unified law document model.
 *
 * A document is a flat, ordered list of units. Hierarchy is carried by
 * `parent` (unit id) and `level` (0 = top). Every unit id is unique inside
 * its document and doubles as the HTML anchor, so `<document url>#<unit id>`
 * is a stable reference.
 *
 * @typedef {object} LawUnit
 * @property {string} id         Stable anchor, e.g. `s101`, `article-5`.
 * @property {string} kind       title | part | chapter | section | article | …
 * @property {string} [num]      Number as printed (`5`, `IV`, `第五条`).
 * @property {string} [heading]  Heading text.
 * @property {string} [text]     Body text; provisions separated by `\n`.
 * @property {string|null} parent
 * @property {number} level
 *
 * @typedef {object} LawDocument
 * @property {string} id            Path id, e.g. `us/usc/t1`.
 * @property {string} jurisdiction  US | EU | CN | IN | RU | GE.
 * @property {string} source        Registry source id.
 * @property {string} language      BCP 47 language tag.
 * @property {string} title
 * @property {string} sourceUrl     Human-readable original.
 * @property {string} [version]     Publisher version / release point.
 * @property {string} [retrievedAt] ISO timestamp.
 * @property {string} [sha256]      Hash of the downloaded source bytes.
 * @property {LawUnit[]} units
 */
import { cleanLine, cleanText, slug } from './text.js';

export const MODEL_VERSION = 1;

/** Build a unit, dropping empty optional fields. */
export function unit({ id, kind, num, heading, text, parent = null, level }) {
  const value = { id, kind };
  if (num) {
    value.num = cleanLine(num);
  }
  if (heading) {
    value.heading = cleanLine(heading);
  }
  if (text) {
    value.text = cleanText(text);
  }
  value.parent = parent;
  value.level = level;
  return value;
}

/**
 * Make unit ids unique. A unit repeated with no content of its own and no
 * children (typically a table-of-contents line) is dropped in favour of the
 * later full unit; other collisions get the parent id as prefix.
 */
export function finalizeUnits(units) {
  const hasChildren = new Set(units.map((item) => item.parent));
  const lastIndex = new Map(units.map((item, index) => [item.id, index]));
  const kept = units.filter(
    (item, index) =>
      lastIndex.get(item.id) === index || item.text || hasChildren.has(item.id)
  );
  const seen = new Map();
  const renamed = new Map();
  return kept.map((item) => {
    const parent = renamed.get(item.parent) ?? item.parent;
    let id = item.id;
    if (seen.has(id)) {
      id = parent ? `${parent}-${item.id}` : item.id;
      let counter = 2;
      const base = id;
      while (seen.has(id)) {
        id = `${base}-${counter}`;
        counter += 1;
      }
      renamed.set(item.id, id);
    }
    seen.set(id, true);
    return { ...item, id, parent };
  });
}

/** Create a document record with stable key order. */
export function lawDocument(fields) {
  const {
    id,
    jurisdiction,
    source,
    language,
    title,
    sourceUrl,
    downloadUrl,
    version,
    retrievedAt,
    sha256,
    legal,
    units = [],
  } = fields;
  return {
    model: MODEL_VERSION,
    id,
    jurisdiction,
    source,
    language,
    title: cleanLine(title),
    sourceUrl,
    downloadUrl: downloadUrl ?? sourceUrl,
    version: version ?? null,
    retrievedAt: retrievedAt ?? null,
    sha256: sha256 ?? null,
    legal: legal ?? null,
    units: finalizeUnits(units),
  };
}

function unitProblems(units) {
  const problems = [];
  const ids = new Set();
  for (const item of units) {
    if (ids.has(item.id)) {
      problems.push(`duplicate unit id ${item.id}`);
    }
    if (item.parent && !ids.has(item.parent)) {
      problems.push(`unit ${item.id} has unknown parent ${item.parent}`);
    }
    ids.add(item.id);
  }
  if (!units.length) {
    problems.push('document has no units');
  }
  return problems;
}

/** Validate structural invariants; returns a list of problems. */
export function validateDocument(document) {
  const problems = ['id', 'jurisdiction', 'source', 'language', 'title']
    .filter((key) => !document?.[key])
    .map((key) => `missing ${key}`);
  if (!/^https?:\/\//u.test(document?.sourceUrl ?? '')) {
    problems.push('sourceUrl must be an absolute http(s) URL');
  }
  return [...problems, ...unitProblems(document?.units ?? [])];
}

/** Plain-text rendering of a whole document (for search and agents). */
export function documentText(document) {
  return document.units
    .map((item) =>
      [[item.num, item.heading].filter(Boolean).join(' '), item.text]
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n\n');
}

export function unitId(kind, num) {
  return `${slug(kind)}-${slug(num)}`;
}
