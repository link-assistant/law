/**
 * Download → convert pipeline shared by the CLI, CI and the browser viewer.
 * Everything here is isomorphic: network access goes through a
 * `PoliteFetcher`, storage is left to the caller.
 */
import { convert } from './convert/index.js';
import { sha256Hex } from './hash.js';
import { lawDocument } from './model.js';
import { zipEntry, zipEntryNames } from './zip.js';

const metaCharset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/iu;

/** Charset from the Content-Type header, else from `<meta>`, else UTF-8. */
export function detectCharset(bytes, contentType = '') {
  const header = /charset\s*=\s*"?([\w-]+)/iu.exec(contentType)?.[1];
  if (header) {
    return header.toLowerCase();
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  return (metaCharset.exec(head)?.[1] ?? 'utf-8').toLowerCase();
}

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function fetchPage(fetcher, url, headers) {
  const response = await fetcher.ok(url, { headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const charset = detectCharset(bytes, response.headers.get('content-type'));
  return { bytes, text: new TextDecoder(charset).decode(bytes) };
}

/** Highest page number linked from the first page (`pageLinks` regex). */
export function lastPage(html, pageLinks) {
  const pattern = new RegExp(pageLinks, 'gu');
  let last = 1;
  for (const match of html.matchAll(pattern)) {
    last = Math.max(last, Number(match[1]));
  }
  return last;
}

/** Fetch every page of a registry target; returns texts and their hash. */
export async function fetchTarget(fetcher, target) {
  const first = await fetchPage(fetcher, target.pages[0], target.headers);
  const pages = [first];
  for (const url of target.pages.slice(1)) {
    pages.push(await fetchPage(fetcher, url, target.headers));
  }
  if (target.pageLinks) {
    const last = lastPage(first.text, target.pageLinks);
    for (let page = 2; page <= last; page += 1) {
      const url = target.pageTemplate.replace('{n}', String(page));
      pages.push(await fetchPage(fetcher, url, target.headers));
    }
  }
  return {
    pages: pages.map((page) => page.text),
    sha256: await sha256Hex(concatBytes(pages.map((page) => page.bytes))),
  };
}

export function legalOf(source) {
  const { status, mirror, basis, basisUrl, attribution } = source.legal ?? {};
  return { status, mirror, basis, basisUrl, attribution };
}

/**
 * Turn fetched source pages into a unified law document.
 * @param {object} target  registry target (see registry.js)
 * @param {{ pages: string[], sha256?: string, version?: string }} fetched
 * @param {{ source?: object, retrievedAt?: string }} [context]
 */
export function toDocument(target, fetched, context = {}) {
  const body = convert({
    format: target.format,
    pages: fetched.pages,
    selector: target.selector,
    profile: target.profile,
  });
  return lawDocument({
    id: target.key,
    jurisdiction: target.jurisdiction,
    source: target.source,
    language: target.language,
    title: target.title ?? body.title,
    sourceUrl: target.sourceUrl,
    downloadUrl: target.downloadUrl ?? target.pages?.[0],
    version: fetched.version ?? body.version ?? null,
    retrievedAt: context.retrievedAt ?? new Date().toISOString(),
    sha256: fetched.sha256,
    legal: context.source ? legalOf(context.source) : null,
    units: body.units,
  });
}

async function firstText(fetcher, urls, headers) {
  let lastError = null;
  for (const url of urls.filter(Boolean)) {
    try {
      return { url, text: await fetcher.text(url, { headers }) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('No index URL');
}

const uscEntry = /^usc(\d+[a-z]?)\.xml$/iu;

/** United States Code: one release-point zip with a USLM file per title. */
async function* uscode(collection, { fetcher }) {
  const index = await firstText(fetcher, [
    collection.index,
    collection.indexFallback,
  ]);
  const link = /href="([^"]*xml_uscAll@([^"]+)\.zip)"/u.exec(index.text);
  if (!link) {
    throw new Error(`No xml_uscAll zip linked from ${index.url}`);
  }
  const zipUrl = new URL(link[1], index.url).href;
  const archive = await fetcher.bytes(zipUrl);
  const names = zipEntryNames(archive, (name) => uscEntry.test(name));
  for (const name of names) {
    const title = uscEntry.exec(name)[1].replace(/^0+/u, '').toLowerCase();
    const bytes = zipEntry(archive, name);
    yield {
      local: `t${title}`,
      format: 'uslm',
      downloadUrl: zipUrl,
      sourceUrl: `https://uscode.house.gov/browse/prelim@title${title}&edition=prelim`,
      load: async () => ({
        pages: [new TextDecoder().decode(bytes)],
        sha256: await sha256Hex(bytes),
        version: link[2],
      }),
    };
  }
}

const jsonHeaders = { accept: 'application/json' };

/** Code of Federal Regulations: govinfo eCFR bulk data, one XML per title. */
async function* govinfoEcfr(collection, { fetcher }) {
  const listing = await fetcher.json(collection.index, {
    headers: jsonHeaders,
  });
  const titles = listing.files
    .filter((item) => item.folder && Number.isFinite(item.cfrTitle))
    .sort((a, b) => a.cfrTitle - b.cfrTitle);
  for (const folder of titles) {
    const title = String(folder.cfrTitle);
    yield {
      local: `t${title}`,
      format: 'ecfr',
      sourceUrl: `https://www.ecfr.gov/current/title-${title}`,
      live: `https://www.ecfr.gov/api/versioner/v1/full/{date}/title-${title}.xml`,
      load: async () => {
        const files = await fetcher.json(folder.link, { headers: jsonHeaders });
        const file = files.files.find((item) => item.fileExtension === 'xml');
        if (!file) {
          throw new Error(`No XML file in ${folder.link}`);
        }
        const bytes = await fetcher.bytes(file.link);
        return {
          pages: [new TextDecoder().decode(bytes)],
          sha256: await sha256Hex(bytes),
          downloadUrl: file.link,
          version: file.formattedLastModifiedTime ?? null,
        };
      },
    };
  }
}

export const adapters = { uscode, 'govinfo-ecfr': govinfoEcfr };

/**
 * Expand a collection into targets with a lazy `load()`. Network access
 * happens while iterating, so huge collections stay memory-bounded.
 */
export async function* collectionTargets(id, collection, context) {
  const adapter = adapters[collection.adapter];
  if (!adapter) {
    throw new Error(`Unknown collection adapter ${collection.adapter}`);
  }
  const source = context.registry.sources[collection.source];
  const language = collection.language ?? 'en';
  for await (const item of adapter(collection, context)) {
    yield {
      ...item,
      key: `${id}/${item.local}/${language}`,
      id: `${id}/${item.local}`,
      collection: id,
      language,
      jurisdiction: source.jurisdiction,
      source: collection.source,
      priority: Number(collection.priority ?? 9),
      mode: source.legal?.mirror === 'allowed' ? 'mirror' : 'dynamic',
      cors: source.cors === true,
      blocked: null,
    };
  }
}

/**
 * Fetch and convert one target. Never throws: failures are returned as
 * `{ target, error }` so a run continues and records them.
 */
export async function buildTarget(target, { fetcher, registry, retrievedAt }) {
  if (target.mode === 'blocked') {
    return { target, error: target.blocked ?? 'blocked', blocked: true };
  }
  try {
    const fetched = target.load
      ? await target.load()
      : await fetchTarget(fetcher, target);
    const document = toDocument(
      { ...target, downloadUrl: fetched.downloadUrl ?? target.downloadUrl },
      fetched,
      { source: registry.sources[target.source], retrievedAt }
    );
    return { target, document };
  } catch (error) {
    return { target, error: error.message, code: error.code ?? null };
  }
}
