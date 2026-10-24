import { describe, it, expect } from 'test-anywhere';
import { zipSync, strToU8 } from 'fflate';

import { PoliteFetcher, USER_AGENT, applyProxy } from '../src/law/fetcher.js';
import { parseRobots } from '../src/law/robots.js';
import {
  buildTarget,
  collectionTargets,
  detectCharset,
  fetchTarget,
  lastPage,
} from '../src/law/pipeline.js';
import { parseRegistry } from '../src/law/registry.js';
import { zipEntry, zipEntryNames } from '../src/law/zip.js';
import { fastFetcher as fast, mockFetch } from './helpers/mock-fetch.js';

describe('robots.txt', () => {
  it('prefers the own group, longest match and allow on ties', () => {
    const rules = parseRobots(
      `User-agent: *
Disallow: /

User-agent: link-assistant-law
Disallow: /private
Allow: /private/public
Crawl-delay: 5`,
      'link-assistant-law'
    );
    expect(rules.allows('/law')).toBe(true);
    expect(rules.allows('/private/x')).toBe(false);
    expect(rules.allows('/private/public/x')).toBe(true);
    expect(rules.crawlDelay).toBe(5);
  });

  it('supports wildcards and end anchors from the * group', () => {
    const rules = parseRobots(
      'User-agent: *\nDisallow: /*.pdf$\nDisallow: /api/versioner/v1/full',
      'link-assistant-law'
    );
    expect(rules.allows('/a.pdf')).toBe(false);
    expect(rules.allows('/a.pdf?x=1')).toBe(true);
    expect(rules.allows('/api/versioner/v1/full/current/title-1.xml')).toBe(
      false
    );
    expect(rules.allows('/api/versioner/v1/titles.json')).toBe(true);
  });
});

describe('PoliteFetcher', () => {
  it('identifies itself, honours robots.txt and raises the interval', async () => {
    const calls = [];
    const fetcher = fast(
      {
        'https://a.test/robots.txt':
          'User-agent: *\nDisallow: /no\nCrawl-delay: 0.01',
        'https://a.test/yes': 'ok',
      },
      calls
    );
    expect(await fetcher.text('https://a.test/yes')).toBe('ok');
    expect(calls[1].headers.get('user-agent')).toBe(USER_AGENT);
    expect(fetcher.hosts.get('https://a.test').intervalMs).toBe(10);
    let error;
    try {
      await fetcher.text('https://a.test/no');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('ROBOTS_DISALLOWED');
  });

  it('treats a 5xx robots.txt as full disallow', async () => {
    const fetcher = fast({
      'https://b.test/robots.txt': new Response('', { status: 503 }),
      'https://b.test/x': 'ok',
    });
    fetcher.retries = 0;
    let error;
    try {
      await fetcher.text('https://b.test/x');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('ROBOTS_DISALLOWED');
  });

  it('retries 5xx answers and network errors', async () => {
    let attempts = 0;
    const fetcher = fast({
      'https://c.test/robots.txt': '',
      'https://c.test/flaky': () => {
        attempts += 1;
        return attempts < 3
          ? new Response('busy', {
              status: 503,
              headers: { 'retry-after': '0' },
            })
          : new Response('done');
      },
    });
    expect(await fetcher.text('https://c.test/flaky')).toBe('done');
    expect(attempts).toBe(3);
    const failing = fast({ 'https://d.test/x': new Error('reset') });
    failing.robots = false;
    let error;
    try {
      await failing.text('https://d.test/x');
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toBe('reset');
  });

  it('leaves a host alone after it refuses a request', async () => {
    const calls = [];
    const fetcher = fast(
      {
        'https://r.test/robots.txt': '',
        'https://r.test/a': new Response('no', { status: 403 }),
        'https://r.test/b': 'ok',
        'https://s.test/robots.txt': '',
        'https://s.test/c': 'ok',
      },
      calls
    );
    const failure = async (url) => {
      try {
        await fetcher.text(url);
      } catch (caught) {
        return caught;
      }
      return null;
    };
    expect((await failure('https://r.test/a')).status).toBe(403);
    const skipped = await failure('https://r.test/b');
    expect(skipped.code).toBe('HOST_REFUSED');
    expect(calls.some((call) => call.url === 'https://r.test/b')).toBe(false);
    expect(await fetcher.text('https://s.test/c')).toBe('ok');
  });

  it('applies registry host intervals', () => {
    const fetcher = new PoliteFetcher({
      fetch: mockFetch({}),
      hostIntervals: { 'https://k.test': 6000 },
    });
    expect(fetcher.host('https://k.test').intervalMs).toBe(6000);
    expect(fetcher.host('https://o.test').intervalMs).toBe(1500);
  });

  it('throws on HTTP errors with the status', async () => {
    const fetcher = fast({ 'https://e.test/robots.txt': '' });
    let error;
    try {
      await fetcher.text('https://e.test/missing');
    } catch (caught) {
      error = caught;
    }
    expect(error.status).toBe(404);
  });

  it('routes requests through a proxy template', () => {
    expect(applyProxy('https://x.test/a?b=1', 'https://p.test/?u={url}')).toBe(
      'https://p.test/?u=https%3A%2F%2Fx.test%2Fa%3Fb%3D1'
    );
    expect(applyProxy('https://x.test/', 'https://p.test/')).toBe(
      'https://p.test/https://x.test/'
    );
    expect(applyProxy('https://x.test/', '')).toBe('https://x.test/');
  });
});

describe('download pipeline', () => {
  it('detects the charset from headers or <meta>', () => {
    const bytes = strToU8('<meta charset="windows-1251">');
    expect(detectCharset(bytes, 'text/html; charset=UTF-8')).toBe('utf-8');
    expect(detectCharset(bytes, 'text/html')).toBe('windows-1251');
    expect(detectCharset(strToU8('<p>'), '')).toBe('utf-8');
  });

  it('discovers paginated documents', async () => {
    expect(
      lastPage(
        '<a href="/acts/bank/1/page/2">2</a><a href="/acts/bank/1/page/3">3</a>',
        '/acts/bank/1/page/(\\d+)'
      )
    ).toBe(3);
    const fetcher = fast({
      'https://r.test/robots.txt': '',
      'https://r.test/acts/bank/1':
        '<div class="body"><p>Статья 1. Первая</p><p>Текст</p></div><a href="/acts/bank/1/page/2">2</a>',
      'https://r.test/acts/bank/1/page/2':
        '<div class="body"><p>Статья 2. Вторая</p><p>Текст</p></div>',
    });
    const target = {
      pages: ['https://r.test/acts/bank/1'],
      pageLinks: '/acts/bank/1/page/(\\d+)',
      pageTemplate: 'https://r.test/acts/bank/1/page/{n}',
      headers: {},
    };
    const fetched = await fetchTarget(fetcher, target);
    expect(fetched.pages.length).toBe(2);
    expect(fetched.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});

const registry = parseRegistry(`sources:
  s:
    jurisdiction RU
    legal:
      status not-copyrightable
      mirror allowed
      basis 'Official documents are not objects of copyright.'
      basisUrl 'https://example.org/basis'
  usc:
    jurisdiction US
    legal:
      status public-domain
      mirror allowed
      basis 'Public domain.'
      basisUrl 'https://example.org/basis'
`);

const ruTarget = (url) => ({
  key: 'ru/x/ru',
  id: 'ru/x',
  jurisdiction: 'RU',
  source: 's',
  language: 'ru',
  title: 'X',
  format: 'html',
  profile: 'ru',
  selector: '.body',
  pages: [url],
  headers: {},
  sourceUrl: url,
  mode: 'mirror',
});

describe('target builds and collection adapters', () => {
  it('builds a document with legal metadata and fails on near-empty conversions', async () => {
    const fetcher = fast({
      'https://r.test/robots.txt': '',
      'https://r.test/good':
        '<div class="body"><p>Статья 1. А</p><p>Текст</p><p>Статья 2. Б</p></div>',
      'https://r.test/changed': '<div class="body"><p>Новый макет</p></div>',
    });
    const options = { fetcher, registry, retrievedAt: '2026-01-01T00:00:00Z' };
    const good = await buildTarget(ruTarget('https://r.test/good'), options);
    expect(good.document.units.length).toBe(2);
    expect(good.document.legal.basisUrl).toBe('https://example.org/basis');
    expect(good.document.retrievedAt).toBe('2026-01-01T00:00:00Z');
    const changed = await buildTarget(
      ruTarget('https://r.test/changed'),
      options
    );
    expect(changed.error).toMatch(/layout may have changed/u);
    const missing = await buildTarget(ruTarget('https://r.test/404'), options);
    expect(missing.error).toMatch(/HTTP 404/u);
    const blocked = await buildTarget(
      { ...ruTarget(''), mode: 'blocked', blocked: 'robots' },
      options
    );
    expect(blocked).toEqual({
      target: blocked.target,
      error: 'robots',
      blocked: true,
    });
  });

  it('expands the US Code release zip into one target per title', async () => {
    const title = (n) =>
      strToU8(
        `<uscDoc><main><title identifier="/us/usc/t${n}"><num>Title ${n}</num><heading>T</heading><section identifier="/us/usc/t${n}/s1"><num>§ 1.</num><content>a</content></section><section identifier="/us/usc/t${n}/s2"><num>§ 2.</num><content>b</content></section></title></main></uscDoc>`
      );
    const archive = zipSync({
      'usc01.xml': title(1),
      'usc05a.xml': title('5a'),
      'readme.txt': strToU8('x'),
    });
    expect(zipEntryNames(archive, (name) => name.endsWith('.xml'))).toEqual([
      'usc01.xml',
      'usc05a.xml',
    ]);
    expect(new TextDecoder().decode(zipEntry(archive, 'readme.txt'))).toBe('x');
    const fetcher = fast({
      'https://u.test/robots.txt': '',
      'https://u.test/download.html':
        '<a href="download/releasepoints/us/pl/119/1/xml_uscAll@119-1.zip">all</a>',
      'https://u.test/download/releasepoints/us/pl/119/1/xml_uscAll@119-1.zip':
        () => new Response(archive),
    });
    const context = { fetcher, registry };
    const items = [];
    for await (const target of collectionTargets(
      'us/usc',
      {
        source: 'usc',
        adapter: 'uscode',
        index: 'https://u.test/download.html',
      },
      context
    )) {
      items.push(target);
    }
    expect(items.map((item) => item.key)).toEqual([
      'us/usc/t1/en',
      'us/usc/t5a/en',
    ]);
    expect(items[0].mode).toBe('mirror');
    const built = await buildTarget(items[1], context);
    expect(built.document.version).toBe('119-1');
    expect(built.document.units.map((item) => item.id)).toEqual([
      'top',
      's1',
      's2',
    ]);
  });

  it('expands the govinfo eCFR listing with a live eCFR template', async () => {
    const xml =
      '<ECFR><DIV1 N="2" TYPE="TITLE"><HEAD>Title 2</HEAD><DIV5 N="1" TYPE="PART"><HEAD>PART 1—A</HEAD><DIV8 N="1.1" TYPE="SECTION"><HEAD>§ 1.1 A.</HEAD><P>x</P></DIV8></DIV5></DIV1></ECFR>';
    const fetcher = fast({
      'https://g.test/robots.txt': '',
      'https://g.test/json/ECFR': JSON.stringify({
        files: [
          { folder: true, cfrTitle: 2, link: 'https://g.test/json/ECFR/2' },
          { folder: true, cfrTitle: 0, link: 'https://g.test/json/resources' },
          { folder: false, name: 'readme' },
        ],
      }),
      'https://g.test/json/ECFR/2': JSON.stringify({
        files: [
          {
            fileExtension: 'xml',
            link: 'https://g.test/ECFR-title2.xml',
            formattedLastModifiedTime: 'build-2',
          },
        ],
      }),
      'https://g.test/ECFR-title2.xml': xml,
    });
    const context = { fetcher, registry };
    const items = [];
    for await (const target of collectionTargets(
      'us/cfr',
      {
        source: 'usc',
        adapter: 'govinfo-ecfr',
        index: 'https://g.test/json/ECFR',
      },
      context
    )) {
      items.push(target);
    }
    expect(items.map((item) => item.key)).toEqual(['us/cfr/t2/en']);
    expect(items[0].live).toContain('/full/{date}/title-2.xml');
    const built = await buildTarget(items[0], context);
    expect(built.document.downloadUrl).toBe('https://g.test/ECFR-title2.xml');
    expect(built.document.title).toBe('Title 2');
  });
});
