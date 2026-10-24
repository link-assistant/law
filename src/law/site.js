/**
 * Static site build (Node.js): fetch, convert and publish every law in the
 * registry under a size budget, plus the catalog in JSON and Links Notation.
 *
 * Layout of `outDir`:
 *   index.html, view.html, registry.lino, catalog.json, catalog.lino
 *   laws/<key>.json.gz      unified document (mirror mode)
 *   laws/<key>/index.html   static HTML (while the HTML budget lasts)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fromLino, toLino } from './lino.js';
import { buildTarget, collectionTargets } from './pipeline.js';
import { expandRegistry, parseRegistry, validateRegistry } from './registry.js';
import { escapeHtml, pageShell, renderDocumentPages } from './render.js';

export const DEFAULT_HTML_BUDGET = 600 * 1024 * 1024;

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Registry documents and collections ordered by priority. */
export function plan(registry, { only = [] } = {}) {
  const wanted = (key) =>
    !only.length || only.some((prefix) => key.startsWith(prefix));
  const documents = expandRegistry(registry)
    .filter((target) => wanted(target.key))
    .map((target) => ({ priority: target.priority, target }));
  const collections = Object.entries(registry.collections)
    .filter(
      ([id]) =>
        only.some((prefix) => id.startsWith(prefix) || prefix.startsWith(id)) ||
        !only.length
    )
    .map(([id, collection]) => ({
      priority: Number(collection.priority ?? 9),
      collection: { id, ...collection },
      wanted,
    }));
  return [...documents, ...collections].sort((a, b) => a.priority - b.priority);
}

async function previousDocument(fetcher, previous, key) {
  if (!previous) {
    return null;
  }
  try {
    const bytes = await fetcher.bytes(`${previous}/laws/${key}.json.gz`);
    return JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function entryFor(target) {
  return {
    key: target.key,
    id: target.id,
    collection: target.collection ?? null,
    title: target.title ?? null,
    jurisdiction: target.jurisdiction,
    language: target.language,
    source: target.source,
    mode: target.mode,
    priority: target.priority,
    sourceUrl: target.sourceUrl,
    live: target.live ?? null,
    cors: target.cors,
  };
}

function describe(document) {
  return {
    title: document.title,
    units: document.units.length,
    sha256: document.sha256,
    version: document.version,
    retrievedAt: document.retrievedAt,
    downloadUrl: document.downloadUrl,
  };
}

class SiteBuilder {
  constructor(options) {
    this.options = options;
    this.out = options.outDir;
    this.htmlBudget = options.htmlBudget ?? DEFAULT_HTML_BUDGET;
    this.htmlUsed = 0;
    this.entries = [];
    this.log = options.log ?? (() => {});
  }

  async publish(document) {
    const key = document.id;
    const json = gzipSync(JSON.stringify(document), { level: 9 });
    await put(join(this.out, 'laws', `${key}.json.gz`), json);
    const root = '../'.repeat(key.split('/').length + 1);
    const pages = renderDocumentPages(document, {
      root,
      json: `../${key.split('/').pop()}.json.gz`,
      shardBytes: this.options.shardBytes,
    });
    const size = pages.reduce(
      (sum, page) => sum + Buffer.byteLength(page.content),
      0
    );
    if (this.htmlUsed + size > this.htmlBudget) {
      return { json: `laws/${key}.json.gz`, html: null, bytes: json.length };
    }
    this.htmlUsed += size;
    for (const page of pages) {
      await put(join(this.out, 'laws', key, page.path), page.content);
    }
    return {
      json: `laws/${key}.json.gz`,
      html: `laws/${key}/`,
      bytes: json.length,
    };
  }

  async recover(entry, result) {
    const { fetcher, previous } = this.options;
    const document = await previousDocument(fetcher, previous, entry.key);
    if (!document) {
      return { ...entry, status: 'error', error: result.error };
    }
    const files = await this.publish(document);
    return {
      ...entry,
      ...describe(document),
      ...files,
      status: 'reused',
      error: result.error,
    };
  }

  async target(target) {
    const entry = entryFor(target);
    if (target.mode !== 'mirror') {
      const status = target.mode === 'blocked' ? 'blocked' : 'dynamic';
      return { ...entry, status, error: target.blocked ?? null };
    }
    const result = await buildTarget(target, this.options);
    if (!result.document) {
      this.log(`✗ ${target.key}: ${result.error}`);
      return this.recover(entry, result);
    }
    const files = await this.publish(result.document);
    this.log(`✓ ${target.key}: ${result.document.units.length} units`);
    return {
      ...entry,
      ...describe(result.document),
      ...files,
      status: 'ok',
      error: null,
    };
  }

  async collection(job) {
    const { id } = job.collection;
    let count = 0;
    try {
      for await (const target of collectionTargets(
        id,
        job.collection,
        this.options
      )) {
        if (!job.wanted(target.key)) {
          continue;
        }
        if (this.options.limit && count >= this.options.limit) {
          break;
        }
        count += 1;
        this.entries.push(await this.target({ ...target, title: null }));
      }
    } catch (error) {
      this.log(`✗ ${id}: ${error.message}`);
      this.entries.push({
        key: id,
        id,
        collection: id,
        title: job.collection.title,
        mode: 'mirror',
        status: 'error',
        error: error.message,
        priority: job.priority,
      });
    }
  }

  async run(jobs) {
    for (const job of jobs) {
      if (job.target) {
        this.entries.push(await this.target(job.target));
      } else {
        await this.collection(job);
      }
    }
    return this.entries;
  }
}

export function summarize(entries) {
  const summary = {};
  for (const entry of entries) {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
  }
  return summary;
}

/** Catalog as Links Notation, keyed by document key (stable fields only). */
export function catalogLino(entries, previous = {}) {
  const records = {};
  for (const entry of entries) {
    const before = previous[entry.key] ?? {};
    const changed = !before.sha256 || before.sha256 !== entry.sha256;
    records[entry.key] = {
      title: entry.title,
      jurisdiction: entry.jurisdiction,
      language: entry.language,
      source: entry.source,
      mode: entry.mode,
      status: entry.status,
      units: entry.units,
      version: entry.version,
      sha256: entry.sha256,
      updated: changed && entry.sha256 ? entry.retrievedAt : before.updated,
      sourceUrl: entry.sourceUrl,
      // Links Notation references are single-line.
      error: entry.error
        ? entry.error.replace(/\s+/gu, ' ').trim()
        : entry.error,
    };
  }
  return `${toLino({ documents: records })}\n`;
}

export async function readCatalogLino(path) {
  try {
    return fromLino(await readFile(path, 'utf8')).documents ?? {};
  } catch {
    return {};
  }
}

const statusText = {
  ok: 'mirrored',
  reused: 'mirrored (previous copy; refresh failed)',
  dynamic: 'loaded live in your browser',
  blocked: 'blocked',
  error: 'failed',
};

function catalogRow(entry) {
  const links = [];
  if (entry.html) {
    links.push(`<a href="${entry.html}">read</a>`);
  }
  if (entry.status !== 'blocked') {
    links.push(
      `<a href="view.html?doc=${encodeURIComponent(entry.key)}">viewer</a>`
    );
  }
  if (entry.json) {
    links.push(`<a href="${entry.json}">json</a>`);
  }
  if (entry.sourceUrl) {
    links.push(`<a href="${escapeHtml(entry.sourceUrl)}">original</a>`);
  }
  const note = entry.error
    ? `<br><small>${escapeHtml(entry.error)}</small>`
    : '';
  return `<tr data-search="${escapeHtml(`${entry.key} ${entry.title ?? ''}`.toLowerCase())}"><td>${escapeHtml(entry.title ?? entry.key)}<br><small><code>${escapeHtml(entry.key)}</code></small></td><td>${escapeHtml(entry.language ?? '')}</td><td class="status-${entry.status}">${statusText[entry.status]}${note}</td><td>${links.join(' · ')}</td></tr>`;
}

export function renderCatalogPage(entries, { generatedAt }) {
  const groups = new Map();
  for (const entry of entries) {
    const group = entry.jurisdiction ?? 'US';
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  const sections = [...groups]
    .map(
      ([name, items]) =>
        `<section id="${name}"><h2>${name}</h2><table class="catalog"><thead><tr><th>Law</th><th>Lang</th><th>Status</th><th>Links</th></tr></thead><tbody>${items.map(catalogRow).join('')}</tbody></table></section>`
    )
    .join('\n');
  const summary = Object.entries(summarize(entries))
    .map(([status, count]) => `${count} ${statusText[status]}`)
    .join(', ');
  const body = `<header><h1>Laws</h1><p>Static copies of laws converted to one unified format, with links to the originals. Built ${escapeHtml(generatedAt)}: ${escapeHtml(summary)}. Metadata: <a href="catalog.lino">catalog.lino</a>, <a href="registry.lino">registry.lino</a>, <a href="catalog.json">catalog.json</a>.</p><p><input id="filter" type="search" placeholder="Filter laws…" aria-label="Filter laws"></p></header><main>${sections}</main>`;
  return pageShell({
    title: 'Laws',
    body,
    script: '<script type="module" src="assets/viewer.js"></script>',
  });
}

export function renderViewerPage() {
  const body = `<header><p><a href="index.html">All laws</a></p><details id="settings"><summary>Settings</summary><label>CORS proxy for live mode (<code>{url}</code> is replaced by the encoded URL, otherwise the URL is appended): <input id="proxy" type="text" size="50"></label></details></header><div id="status" role="status"></div><article id="document"></article>`;
  return pageShell({
    title: 'Law viewer',
    body,
    script: '<script type="module" src="assets/viewer.js"></script>',
  });
}

/**
 * Build the site.
 * @param {object} options
 * @param {string} options.registryText
 * @param {string} options.outDir
 * @param {import('./fetcher.js').PoliteFetcher} options.fetcher
 * @param {string[]} [options.only]    key prefixes to build
 * @param {number} [options.limit]     max documents per collection
 * @param {number} [options.htmlBudget] bytes of static HTML
 * @param {string} [options.previous]  base URL of the previous site
 * @param {string} [options.catalog]   path of the Links Notation catalog
 */
export async function buildSite(options) {
  const registry = parseRegistry(options.registryText);
  const problems = validateRegistry(registry);
  if (problems.length) {
    throw new Error(`Invalid registry:\n${problems.join('\n')}`);
  }
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const builder = new SiteBuilder({ ...options, registry, retrievedAt });
  const entries = await builder.run(plan(registry, options));
  const previous = options.catalog
    ? await readCatalogLino(options.catalog)
    : {};
  const lino = catalogLino(entries, previous);
  const out = options.outDir;
  await put(
    join(out, 'catalog.json'),
    JSON.stringify(
      { generatedAt: retrievedAt, summary: summarize(entries), entries },
      null,
      1
    )
  );
  await put(join(out, 'catalog.lino'), lino);
  await put(join(out, 'registry.lino'), options.registryText);
  await put(
    join(out, 'index.html'),
    renderCatalogPage(entries, { generatedAt: retrievedAt })
  );
  await put(join(out, 'view.html'), renderViewerPage());
  await put(join(out, '.nojekyll'), '');
  if (options.catalog) {
    await put(options.catalog, lino);
  }
  return { entries, summary: summarize(entries), htmlBytes: builder.htmlUsed };
}
