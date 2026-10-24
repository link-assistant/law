import { describe, it, expect } from 'test-anywhere';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { probe, probeMarkdown, probeTargets } from '../src/law/probe.js';
import { parseRegistry } from '../src/law/registry.js';
import {
  escapeHtml,
  renderDocumentPages,
  renderUnit,
  shardUnits,
} from '../src/law/render.js';
import {
  buildMarkdown,
  buildSite,
  catalogLino,
  plan,
  readCatalogLino,
} from '../src/law/site.js';
import { fastFetcher } from './helpers/mock-fetch.js';

const unit = (id, level = 0, text = 'x') => ({
  id,
  kind: 'article',
  num: `Article ${id}`,
  text,
  parent: null,
  level,
});

describe('HTML renderer', () => {
  it('escapes markup and anchors every unit', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
    const html = renderUnit(
      { ...unit('article-1'), heading: '<Scope>', text: 'a\nb' },
      { href: '2.html' }
    );
    expect(html).toContain('id="article-1"');
    expect(html).toContain('href="2.html#article-1"');
    expect(html).toContain('&lt;Scope&gt;');
    expect(html).toContain('<p>a</p><p>b</p>');
  });

  it('shards large documents at top-level units', () => {
    const units = [
      unit('1', 0, 'a'.repeat(400)),
      unit('1-1', 2, 'b'.repeat(400)),
      unit('2', 0, 'c'.repeat(400)),
      unit('3', 1, 'd'.repeat(400)),
    ];
    const shards = shardUnits(units, 700);
    expect(shards.map((shard) => shard.map((item) => item.id))).toEqual([
      ['1', '1-1'],
      ['2', '3'],
    ]);
    expect(shardUnits(units).length).toBe(1);
  });

  it('renders one page for small documents and shards with anchors otherwise', () => {
    const document = {
      id: 'xx/law/en',
      jurisdiction: 'US',
      language: 'en',
      title: 'Law',
      sourceUrl: 'https://example.org/law',
      downloadUrl: 'https://example.org/law.xml',
      units: [unit('1', 0, 'a'.repeat(500)), unit('2', 0, 'b'.repeat(500))],
      legal: {
        status: 'public-domain',
        basis: '17 U.S.C. 105',
        basisUrl: 'https://example.org/105',
      },
    };
    const single = renderDocumentPages(document);
    expect(single.map((page) => page.path)).toEqual(['index.html']);
    expect(single[0].content).toContain('href="https://example.org/law"');
    expect(single[0].content).toContain('17 U.S.C. 105');
    const sharded = renderDocumentPages(document, { shardBytes: 300 });
    expect(sharded.map((page) => page.path)).toEqual([
      'index.html',
      'anchors.json',
      '1.html',
      '2.html',
    ]);
    expect(JSON.parse(sharded[1].content)).toEqual({ 1: '1', 2: '2' });
    expect(sharded[0].content).toContain('href="2.html#2"');
    expect(sharded[2].content).toContain('rel="next" href="2.html"');
  });
});

const registryText = `sources:
  open:
    name 'Open publisher'
    homepage 'https://r.test'
    jurisdiction RU
    legal:
      status not-copyrightable
      mirror allowed
      basis 'Official texts are not objects of copyright'
      basisUrl 'https://example.org/basis'
  closed:
    name 'Closed publisher'
    homepage 'https://c.test'
    jurisdiction CN
    cors true
    legal:
      status copyrighted
      mirror not-allowed
      basis 'No redistribution licence'
      basisUrl 'https://example.org/basis'
documents:
  ru/a:
    source open
    title 'Law A'
    languages ru
    format html
    profile ru
    selector .body
    url 'https://r.test/a'
  ru/b:
    source open
    title 'Law B'
    languages ru
    format html
    profile ru
    selector .body
    url 'https://r.test/b'
  cn/c:
    source closed
    title 'Law C'
    languages zh
    format html
    profile zh
    url 'https://c.test/c'
`;

const page = (title) =>
  `<div class="body"><p>Статья 1. ${title}</p><p>Текст</p><p>Статья 2. Ещё</p><p>Текст</p></div>`;

describe('static site build', () => {
  it('plans documents and collections by priority and prefix', () => {
    const registry = parseRegistry(registryText);
    expect(plan(registry).map((job) => job.target.key)).toEqual([
      'cn/c/zh',
      'ru/a/ru',
      'ru/b/ru',
    ]);
    expect(
      plan(registry, { only: ['ru/b'] }).map((job) => job.target.key)
    ).toEqual(['ru/b/ru']);
  });

  it('mirrors allowed laws, goes live for the rest and reuses previous copies', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'law-site-'));
    const catalog = join(outDir, 'data', 'catalog.lino');
    const previousCopy = {
      model: 1,
      id: 'ru/b/ru',
      jurisdiction: 'RU',
      source: 'open',
      language: 'ru',
      title: 'Law B',
      sourceUrl: 'https://r.test/b',
      sha256: 'old',
      units: [unit('article-1'), unit('article-2')],
    };
    try {
      const fetcher = fastFetcher({
        'https://r.test/robots.txt': '',
        'https://r.test/a': page('Первая'),
        'https://r.test/b': new Error('ECONNRESET'),
        'https://prev.test/laws/ru/b/ru.json.gz': () =>
          new Response(gzipSync(JSON.stringify(previousCopy))),
        'https://prev.test/robots.txt': '',
      });
      const result = await buildSite({
        registryText,
        outDir,
        fetcher,
        previous: 'https://prev.test',
        catalog,
        retrievedAt: '2026-01-01T00:00:00Z',
      });
      expect(result.summary).toEqual({ ok: 1, reused: 1, dynamic: 1 });
      const [c, a, b] = result.entries;
      expect([a.status, a.html, a.units]).toEqual(['ok', 'laws/ru/a/ru/', 2]);
      expect([b.status, b.error]).toEqual(['reused', 'ECONNRESET']);
      expect([c.status, c.html ?? null, c.cors]).toEqual([
        'dynamic',
        null,
        true,
      ]);
      const stored = JSON.parse(
        gunzipSync(await readFile(join(outDir, 'laws/ru/a/ru.json.gz')))
      );
      expect(stored.units.map((item) => item.id)).toEqual([
        'article-1',
        'article-2',
      ]);
      const html = await readFile(
        join(outDir, 'laws/ru/a/ru/index.html'),
        'utf8'
      );
      expect(html).toContain('href="../../../../assets/law.css"');
      const index = await readFile(join(outDir, 'index.html'), 'utf8');
      expect(index).toContain('view.html?doc=cn%2Fc%2Fzh');
      expect(index).toContain('loaded live in your browser');
      for (const name of ['view.html', 'registry.lino', '.nojekyll']) {
        expect(existsSync(join(outDir, name))).toBe(true);
      }
      const documents = await readCatalogLino(catalog);
      expect(documents['ru/a/ru'].status).toBe('ok');
      expect(documents['ru/a/ru'].updated).toBe('2026-01-01T00:00:00Z');
      expect(documents['cn/c/zh'].mode).toBe('dynamic');
      const report = buildMarkdown(result.entries);
      expect(report).toContain('### Law build (dynamic: 1, ok: 1, reused: 1)');
      expect(report).toContain('| ru/a/ru | ok | mirror | 2 |  |');
      expect(report).toContain('| ru/b/ru | reused | mirror |');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('keeps static HTML within the budget', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'law-site-'));
    try {
      const fetcher = fastFetcher({
        'https://r.test/robots.txt': '',
        'https://r.test/a': page('А'),
        'https://r.test/b': page('Б'),
      });
      const result = await buildSite({
        registryText,
        outDir,
        fetcher,
        only: ['ru/'],
        htmlBudget: 2000,
      });
      expect(result.entries.map((entry) => entry.html)).toEqual([
        'laws/ru/a/ru/',
        null,
      ]);
      expect(result.entries[1].json).toBe('laws/ru/b/ru.json.gz');
      expect(result.htmlBytes <= 2000).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('keeps the update time while the source hash is unchanged', async () => {
    const entry = {
      key: 'k',
      status: 'ok',
      sha256: 'same',
      retrievedAt: 'run-2',
      error: 'line one\n  line two',
    };
    const dir = await mkdtemp(join(tmpdir(), 'law-catalog-'));
    try {
      const path = join(dir, 'catalog.lino');
      await writeFile(path, catalogLino([{ ...entry, retrievedAt: 'run-1' }]));
      const previous = await readCatalogLino(path);
      const text = catalogLino([entry], previous);
      expect(text).toContain('updated run-1');
      expect(text).toContain("'line one line two'");
      expect(catalogLino([{ ...entry, sha256: 'new' }], previous)).toContain(
        'updated run-2'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('source probe', () => {
  it('reports status, CORS and robots.txt verdicts as Markdown', async () => {
    const registry = parseRegistry(registryText);
    expect(probeTargets(registry).map((target) => target.key)).toEqual([
      'cn/c/zh',
      'ru/a/ru',
      'ru/b/ru',
    ]);
    const fetcher = fastFetcher({
      'https://r.test/robots.txt': 'User-agent: *\nDisallow: /b',
      'https://r.test/a': () =>
        new Response('ok', {
          headers: {
            'access-control-allow-origin': '*',
            'content-type': 'text/html; charset=utf-8',
          },
        }),
      'https://c.test/robots.txt': '',
    });
    const rows = await probe(registry, { fetcher });
    expect(
      rows.map((row) => [row.key, row.status ?? null, row.robots])
    ).toEqual([
      ['cn/c/zh', 404, 'allowed'],
      ['ru/a/ru', 200, 'allowed'],
      ['ru/b/ru', null, 'disallowed'],
    ]);
    expect(rows[1].cors).toBe('*');
    expect(rows[1].type).toBe('text/html');
    const markdown = probeMarkdown(rows, { agent: 'link-assistant-law' });
    expect(markdown).toContain('| ru/a/ru | 200 | allowed | * | text/html |');
  });
});
