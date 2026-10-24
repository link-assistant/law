/**
 * Law registry: sources (publishers with their legal basis and access
 * rules), documents and collections, kept in `data/registry.lino`.
 * `expandRegistry()` turns entries into concrete per-language targets that
 * the pipeline (Node.js, CI) and the viewer (browser) both consume.
 */
import { fromLino } from './lino.js';

export const LIST_KEYS = ['languages', 'pages'];
export const FORMATS = ['html', 'uslm', 'ecfr', 'pdf'];
export const CONVERTIBLE = new Set(['html', 'uslm', 'ecfr']);
export const JURISDICTIONS = ['US', 'EU', 'CN', 'IN', 'RU', 'GE'];

/** ISO 639-1 → three-letter codes of the EU Publications Office language authority (ISO 639-2/T). */
const ISO3 = {
  bg: 'bul',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  et: 'est',
  fi: 'fin',
  fr: 'fra',
  ga: 'gle',
  hr: 'hrv',
  hu: 'hun',
  it: 'ita',
  lt: 'lit',
  lv: 'lav',
  mt: 'mlt',
  nl: 'nld',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  sk: 'slk',
  sl: 'slv',
  sv: 'swe',
};

export function parseRegistry(text) {
  const registry = fromLino(text, { listKeys: LIST_KEYS });
  return {
    sources: registry.sources ?? {},
    documents: registry.documents ?? {},
    collections: registry.collections ?? {},
  };
}

export function fillTemplate(template, lang) {
  if (!template) {
    return template;
  }
  const lang3 = ISO3[lang] ?? lang;
  return template
    .replaceAll('{lang}', lang)
    .replaceAll('{LANG}', lang.toUpperCase())
    .replaceAll('{lang3}', lang3)
    .replaceAll('{LANG3}', lang3.toUpperCase());
}

/** Publisher-specific shortcuts (`celex`, `bank`, `matsne`). */
function shortcut(entry) {
  if (entry.celex) {
    return {
      format: 'html',
      profile: 'eu-oj',
      selector: 'body',
      url: `http://publications.europa.eu/resource/celex/${entry.celex}`,
      accept: 'application/xhtml+xml',
      acceptLanguage: '{lang3}',
      sourceUrl: `https://eur-lex.europa.eu/legal-content/{LANG}/TXT/?uri=CELEX:${entry.celex}`,
    };
  }
  if (entry.bank) {
    const url = `http://www.kremlin.ru/acts/bank/${entry.bank}`;
    return {
      languages: ['ru'],
      format: 'html',
      profile: 'ru',
      selector: '.reader_act_body',
      url,
      pageLinks: `/acts/bank/${entry.bank}/page/(\\d+)`,
      pageTemplate: `${url}/page/{n}`,
    };
  }
  if (entry.matsne) {
    return {
      format: 'html',
      profile: 'ge',
      selector: '#maindoc',
      url: `https://matsne.gov.ge/{lang}/document/view/${entry.matsne}`,
    };
  }
  return {};
}

function modeOf(source, entry) {
  if (source.blocked || entry.blocked || !CONVERTIBLE.has(entry.format)) {
    return 'blocked';
  }
  return source.legal?.mirror === 'allowed' ? 'mirror' : 'dynamic';
}

function headersFor(entry, lang) {
  const headers = {};
  if (entry.accept) {
    headers.accept = entry.accept;
  }
  if (entry.acceptLanguage) {
    headers['accept-language'] = fillTemplate(entry.acceptLanguage, lang);
  }
  return headers;
}

/** One concrete target per document language. */
export function documentTargets(id, raw, sources) {
  const entry = { ...shortcut(raw), ...raw };
  const source = sources[entry.source];
  if (!source) {
    throw new Error(`Document ${id} references unknown source ${entry.source}`);
  }
  const languages = entry.languages ?? shortcut(raw).languages ?? ['en'];
  return languages.map((lang) => {
    const pages = entry.pages ?? [entry.url];
    const url = fillTemplate(pages[0], lang);
    return {
      key: `${id}/${lang}`,
      id,
      language: lang,
      jurisdiction: source.jurisdiction,
      source: entry.source,
      title: entry.title,
      format: entry.format,
      profile: entry.profile,
      selector: entry.selector,
      pages: pages.map((page) => fillTemplate(page, lang)),
      pageLinks: entry.pageLinks,
      pageTemplate: entry.pageTemplate,
      headers: headersFor(entry, lang),
      sourceUrl: fillTemplate(entry.sourceUrl, lang) ?? url,
      priority: Number(entry.priority ?? 9),
      minUnits: Number(entry.minUnits ?? 2),
      mode: modeOf(source, entry),
      blocked: source.blocked ?? entry.blocked ?? null,
      cors: source.cors === true,
    };
  });
}

export function expandRegistry(registry) {
  return Object.entries(registry.documents)
    .flatMap(([id, raw]) => documentTargets(id, raw, registry.sources))
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

function sourceProblems(id, source) {
  const problems = [];
  if (!JURISDICTIONS.includes(source.jurisdiction)) {
    problems.push(`source ${id}: unknown jurisdiction ${source.jurisdiction}`);
  }
  for (const key of ['name', 'homepage']) {
    if (!source[key]) {
      problems.push(`source ${id}: missing ${key}`);
    }
  }
  if (source.crawlDelay !== undefined && !(Number(source.crawlDelay) > 0)) {
    problems.push(`source ${id}: crawlDelay must be a positive number`);
  }
  if (!source.legal?.status || !source.legal?.basis || !source.legal?.mirror) {
    problems.push(`source ${id}: legal status, basis and mirror are required`);
  }
  return problems;
}

function targetProblems(target) {
  const problems = [];
  if (!FORMATS.includes(target.format)) {
    problems.push(`${target.key}: unknown format ${target.format}`);
  }
  if (!target.title) {
    problems.push(`${target.key}: missing title`);
  }
  if (!target.pages.every((page) => /^https?:\/\//u.test(page ?? ''))) {
    problems.push(`${target.key}: pages must be absolute URLs`);
  }
  if (target.format === 'html' && !target.profile) {
    problems.push(`${target.key}: html documents need a profile`);
  }
  return problems;
}

/**
 * Per-host request intervals in ms, from the `crawlDelay` (seconds) a source
 * declares for its homepage origin.
 */
export function hostIntervals(registry) {
  return Object.fromEntries(
    Object.values(registry.sources)
      .filter((source) => Number(source.crawlDelay) > 0 && source.homepage)
      .map((source) => [
        new URL(source.homepage).origin,
        Number(source.crawlDelay) * 1000,
      ])
  );
}

/** Validate a parsed registry; returns a list of problems. */
export function validateRegistry(registry) {
  const problems = Object.entries(registry.sources).flatMap(([id, source]) =>
    sourceProblems(id, source)
  );
  for (const [id, collection] of Object.entries(registry.collections)) {
    if (!registry.sources[collection.source]) {
      problems.push(`collection ${id}: unknown source ${collection.source}`);
    }
  }
  try {
    for (const target of expandRegistry(registry)) {
      problems.push(...targetProblems(target));
    }
  } catch (error) {
    problems.push(error.message);
  }
  return problems;
}
