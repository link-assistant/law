import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import { fromLino, quote, toLino } from '../src/law/lino.js';
import {
  JURISDICTIONS,
  expandRegistry,
  fillTemplate,
  hostIntervals,
  parseRegistry,
  validateRegistry,
} from '../src/law/registry.js';

const registryText = readFileSync('data/registry.lino', 'utf8');
const registry = parseRegistry(registryText);
const targets = expandRegistry(registry);

describe('Links Notation helpers', () => {
  it('round-trips nested records, lists and quoted values', () => {
    const value = {
      a: {
        title: 'Quote \' and " and (parens)',
        languages: ['en'],
        pages: ['https://example.org/1', 'https://example.org/2'],
        nested: { flag: true, count: 3 },
      },
    };
    const text = toLino(value);
    expect(text).toContain('languages en');
    const back = fromLino(text, { listKeys: ['languages', 'pages'] });
    expect(back.a.title).toBe(value.a.title);
    expect(back.a.languages).toEqual(['en']);
    expect(back.a.pages).toEqual(value.a.pages);
    expect(String(back.a.nested.count)).toBe('3');
  });

  it('quotes only when needed and refuses multiline references', () => {
    expect(quote('plain')).toBe('plain');
    expect(quote('two words')).toBe("'two words'");
    expect(quote("it's")).toBe('"it\'s"');
    expect(() => quote('a\nb')).toThrow(/Multiline/);
  });
});

describe('law registry (data/registry.lino)', () => {
  it('is valid', () => {
    expect(validateRegistry(registry)).toEqual([]);
  });

  it('covers every requested jurisdiction', () => {
    const covered = new Set(targets.map((target) => target.jurisdiction));
    for (const code of JURISDICTIONS) {
      expect(covered.has(code)).toBe(true);
    }
    expect(Object.keys(registry.collections).sort()).toEqual([
      'us/cfr',
      'us/usc',
    ]);
  });

  it('records a legal basis for every source', () => {
    for (const [id, source] of Object.entries(registry.sources)) {
      expect([id, Boolean(source.legal?.basis)]).toEqual([id, true]);
      expect(['allowed', 'not-allowed']).toContain(source.legal.mirror);
      expect(source.legal.basisUrl).toMatch(/^https?:\/\//u);
    }
  });

  it('mirrors only sources whose legal basis allows it', () => {
    for (const target of targets) {
      const source = registry.sources[target.source];
      if (target.mode === 'mirror') {
        expect(source.legal.mirror).toBe('allowed');
      }
    }
    const modes = Object.fromEntries(
      targets.map((target) => [target.key, target.mode])
    );
    expect(modes['us/constitution/en']).toBe('mirror');
    expect(modes['cn/civil-code/zh']).toBe('blocked');
    expect(modes['in/constitution/en']).toBe('blocked');
  });

  it('expands shortcuts into concrete download targets', () => {
    const byKey = Object.fromEntries(
      targets.map((target) => [target.key, target])
    );
    const gdpr = byKey['eu/gdpr/de'];
    expect(gdpr.pages).toEqual([
      'http://publications.europa.eu/resource/celex/32016R0679',
    ]);
    expect(gdpr.headers['accept-language']).toBe('deu');
    expect(gdpr.sourceUrl).toContain('/DE/');
    const civil = byKey['ru/civil-code-1/ru'];
    expect(civil.pages).toEqual(['http://www.kremlin.ru/acts/bank/7279']);
    expect(civil.pageTemplate).toBe(
      'http://www.kremlin.ru/acts/bank/7279/page/{n}'
    );
    expect(byKey['ge/constitution/ka'].pages[0]).toBe(
      'https://matsne.gov.ge/ka/document/view/30346'
    );
    expect(targets[0].priority).toBe(1);
  });

  it('fills language templates', () => {
    expect(fillTemplate('{lang}-{LANG}-{lang3}-{LANG3}', 'fr')).toBe(
      'fr-FR-fra-FRA'
    );
  });

  it('reports structural problems', () => {
    const broken = parseRegistry(`sources:
  s:
    jurisdiction XX
documents:
  a:
    source missing
    languages en
    format html
    url 'https://example.org'
`);
    const problems = validateRegistry(broken).join('\n');
    expect(problems).toMatch(/XX/u);
    expect(problems).toMatch(/missing/u);
  });

  it('slows down sources that declare a crawl delay', () => {
    expect(hostIntervals(registry)).toEqual({ 'http://www.kremlin.ru': 6000 });
    const broken = parseRegistry(`sources:
  s:
    jurisdiction RU
    name S
    homepage 'https://s.test/'
    crawlDelay fast
`);
    expect(validateRegistry(broken).join('\n')).toMatch(/crawlDelay/u);
  });
});
