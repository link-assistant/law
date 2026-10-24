import { describe, it, expect } from 'test-anywhere';

import { convert } from '../src/law/convert/index.js';
import { blocks, parseMarkup, selectAll } from '../src/law/dom.js';
import { lawDocument, validateDocument } from '../src/law/model.js';
import { fromChinese, fromRoman, normalizeNumber } from '../src/law/text.js';

const html = (body) => convert({ format: 'html', pages: [body] }).units;
const withProfile = (profile, body, selector) =>
  convert({ format: 'html', pages: [body], profile, selector }).units;
const ids = (units) => units.map((item) => item.id);
const ideographic = '\u3000';

describe('law text helpers', () => {
  it('normalizes Roman, Chinese and ordinal numbers', () => {
    expect(fromRoman('XIV')).toBe(14);
    expect(fromChinese('一百二十三')).toBe(123);
    expect(fromChinese('十')).toBe(10);
    expect(normalizeNumber('IV')).toBe('4');
    expect(normalizeNumber('二十')).toBe('20');
  });
});

describe('isomorphic DOM helpers', () => {
  it('selects by id, class and descendant chains', () => {
    const root = parseMarkup(
      '<div id="a"><p class="x y">one</p><section><p class="x">two</p></section></div><p class="x">three</p>'
    );
    expect(selectAll(root, '#a .x').length).toBe(2);
    expect(selectAll(root, 'p.x.y').length).toBe(1);
    expect(selectAll(root, 'section p, #missing').length).toBe(1);
  });

  it('flattens markup into ordered blocks and skips chrome', () => {
    const root = parseMarkup(
      '<div><h2>Title</h2><script>x()</script><p>First <b>bold</b> line</p><table><tr><td>(a)</td><td>Item</td></tr></table></div>'
    );
    expect(blocks(root).map((entry) => entry.text)).toEqual([
      'Title',
      'First bold line',
      '(a) Item',
    ]);
  });
});

describe('structure profiles', () => {
  it('converts the U.S. Constitution with scoped section ids', () => {
    const units = withProfile(
      'us-constitution',
      `<div id="main"><p>We the People</p><h3>Article. I.</h3><h4>Section. 1.</h4><p>All legislative Powers…</p><h4>Section. 2.</h4><p>The House…</p><h3>Article. II.</h3><h4>Section. 1.</h4><p>The executive Power…</p><h3>Amendment I</h3><p>Congress shall make no law…</p></div>`,
      '#main'
    );
    expect(ids(units)).toEqual([
      'front',
      'article-1',
      'article-1-section-1',
      'article-1-section-2',
      'article-2',
      'article-2-section-1',
      'amendment-1',
    ]);
    expect(units[2].parent).toBe('article-1');
    expect(units[6].text).toBe('Congress shall make no law…');
  });

  it('converts Chinese laws and skips the table of contents', () => {
    const units = withProfile(
      'zh',
      `<div><p>目${ideographic}录</p><p>序言</p><p>第一章${ideographic}总纲</p><p>序言</p><p>中国是世界上历史最悠久的国家之一。</p><p>第一章${ideographic}总纲</p><p>第一条${ideographic}中华人民共和国是……</p><p>第二条${ideographic}中华人民共和国的一切权力属于人民。</p><p>第二章${ideographic}公民</p><p>第三十三条${ideographic}凡具有中华人民共和国国籍的人……</p></div>`
    );
    expect(ids(units)).toEqual([
      'preamble',
      'chapter-1',
      'article-1',
      'article-2',
      'chapter-2',
      'article-33',
    ]);
    expect(units[2].num).toBe('第一条');
    expect(units[2].text).toBe('中华人民共和国是……');
  });

  it('converts Russian codes with nested chapters and articles', () => {
    const units = withProfile(
      'ru',
      `<div><p>РАЗДЕЛ I. ОБЩИЕ ПОЛОЖЕНИЯ</p><p>Глава 1. Гражданское законодательство</p><p>Статья 1. Основные начала</p><p>1. Гражданское законодательство основывается…</p><p>2. Граждане приобретают…</p><p>Статья 1.1. Новая статья</p><p>Текст.</p></div>`
    );
    expect(units.map((item) => [item.id, item.kind])).toEqual([
      ['division-1', 'division'],
      ['division-1-chapter-1', 'chapter'],
      ['article-1', 'article'],
      ['article-1.1', 'article'],
    ]);
    expect(units[2].text).toBe(
      '1. Гражданское законодательство основывается…\n2. Граждане приобретают…'
    );
  });

  it('converts Georgian laws in English and Georgian', () => {
    const english = withProfile(
      'ge',
      '<div><p>Chapter One – General Provisions</p><p>Article 1 – State</p><p>Georgia is …</p><p>Article 4¹ – Text</p><p>…</p></div>'
    );
    expect(ids(english)).toEqual(['chapter-1', 'article-1', 'article-4¹']);
    expect(english[1].parent).toBe('chapter-1');
    const georgian = withProfile(
      'ge',
      '<div><p>მუხლი 1. სახელმწიფო</p><p>საქართველო …</p></div>'
    );
    expect(georgian[0].kind).toBe('article');
    expect(georgian[0].heading).toBe('სახელმწიფო');
  });
});

describe('Official Journal and Indian profiles', () => {
  it('converts Official Journal articles in any language', () => {
    const units = withProfile(
      'eu-oj',
      `<body><p class="oj-hd-oj">Official Journal</p><p class="oj-ti-section-1">CHAPTER I</p><p class="oj-ti-section-2">General provisions</p><p class="oj-ti-art">Article 1</p><p class="oj-sti-art">Subject-matter</p><p class="oj-normal">1. This Regulation…</p><p class="oj-ti-art">Artikel 2</p><p class="oj-normal">Text</p><p class="oj-doc-ti">ANNEX I</p><p>Annex text</p></body>`
    );
    expect(units.map((item) => [item.id, item.heading ?? null])).toEqual([
      ['chapter-1', 'General provisions'],
      ['article-1', 'Subject-matter'],
      ['article-2', null],
      ['annex-1', null],
    ]);
  });

  it('reads Official Journal numbering of all 24 languages', () => {
    const art = (text) => `<p class="oj-ti-art">${text}</p><p>…</p>`;
    const section = (text) => `<p class="oj-ti-section-1">${text}</p>`;
    const annex = (text) => `<p class="oj-doc-ti">${text}</p><p>…</p>`;
    const units = withProfile(
      'eu-oj',
      `<body>${[
        section('I. FEJEZET'),
        art('1 artikla'),
        art('2. cikk'),
        art('Članak 3.'),
        art('Artigo 4.o'),
        art('Article premier'),
        art('Άρθρο11'),
        section('ΤΙΤΛΟΣ ΙV'),
        art('9 a artikla'),
        art('Article 9 ter'),
        art('Artigo 9.o –C'),
        art('Член 9г'),
        art('9e. cikk'),
        art('Article 23f (1)'),
        art('Article 37 (ex Article 38)'),
        section('IV.A SADAĻA'),
        section('III ANTRAŠTINĖ DALIS'),
        annex('III PIELIKUMS'),
        annex('ΠΑΡΑΡΤΗΜΑ ΙΙ'),
        annex('PRILOG IV.'),
      ].join('')}</body>`
    );
    expect(units.map((item) => [item.id, item.kind])).toEqual([
      ['fejezet-1', 'fejezet'],
      ['article-1', 'article'],
      ['article-2', 'article'],
      ['article-3', 'article'],
      ['article-4', 'article'],
      ['article-1', 'article'],
      ['article-11', 'article'],
      ['fejezet-1-τιτλος-4', 'τιτλος'],
      ['article-9a', 'article'],
      ['article-9b', 'article'],
      ['article-9c', 'article'],
      ['article-9d', 'article'],
      ['article-9e', 'article'],
      ['article-23f', 'article'],
      ['article-37', 'article'],
      ['fejezet-1-τιτλος-4-sadaļa-4a', 'sadaļa'],
      ['fejezet-1-τιτλος-4-sadaļa-4a-antraštinė-dalis-3', 'antraštinė-dalis'],
      ['annex-3', 'annex'],
      ['annex-2', 'annex'],
      ['annex-4', 'annex'],
    ]);
  });

  it('tells the label of ordinal-word headings by how often it repeats', () => {
    const section = (text) => `<p class="oj-ti-section-1">${text}</p>`;
    const headings = (lines) =>
      ids(withProfile('eu-oj', `<body>${lines.map(section).join('')}</body>`));
    expect(headings(['ERSTER TEIL', 'ZWEITER TEIL'])).toEqual([
      'teil-erster',
      'teil-zweiter',
    ]);
    expect(headings(['PARTEA A DOUA', 'PARTEA A TREIA'])).toEqual([
      'partea-a-doua',
      'partea-a-treia',
    ]);
  });

  it('namespaces acts of a multi-act Official Journal issue', () => {
    const units = withProfile(
      'eu-oj-issue',
      `<body><p class="doc-ti">CONSOLIDATED VERSION</p><p class="doc-ti">OF THE TREATY ON EUROPEAN UNION</p><p class="ti-art">Article 1</p><p>…</p><p class="doc-ti">TREATY ON THE FUNCTIONING</p><p class="ti-art">Article 1</p><p>…</p></body>`
    );
    expect(ids(units)).toEqual([
      'document-1',
      'document-1-article-1',
      'document-2',
      'document-2-article-1',
    ]);
    expect(units[0].heading).toBe(
      'CONSOLIDATED VERSION OF THE TREATY ON EUROPEAN UNION'
    );
  });

  it('converts Indian acts with inline section headings', () => {
    const units = withProfile(
      'in',
      '<div><p>CHAPTER I PRELIMINARY</p><p>1. Short title and extent.—(1) This Act may be called…</p><p>(2) It extends to the whole of India.</p><p>FIRST SCHEDULE</p></div>'
    );
    expect(ids(units)).toEqual(['chapter-1', 'article-1', 'schedule-first']);
    expect(units[1].heading).toBe('Short title and extent');
    expect(units[1].text).toBe(
      '(1) This Act may be called…\n(2) It extends to the whole of India.'
    );
  });

  it('rejects unknown profiles, formats and empty selectors', () => {
    expect(() => withProfile('xx', '<p>a</p>')).toThrow(/Unknown structure/);
    expect(() => convert({ format: 'pdf', pages: [''] })).toThrow(
      /Unknown format/
    );
    expect(() => withProfile('ru', '<p>a</p>', '#missing')).toThrow(
      /matched nothing/
    );
    expect(() => html('<p>a</p>')).toThrow(/Unknown structure/);
  });
});

describe('XML readers', () => {
  it('converts USLM titles, chapters and sections', () => {
    const xml = `<?xml version="1.0"?><uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"><meta><title>Title 1</title></meta><main><title identifier="/us/usc/t1"><num value="1">Title 1—</num><heading>GENERAL PROVISIONS</heading><chapter identifier="/us/usc/t1/ch1"><num value="1">CHAPTER 1—</num><heading>RULES OF CONSTRUCTION</heading><section identifier="/us/usc/t1/s1"><num value="1">§ 1.</num><heading>Words denoting number</heading><content>In determining the meaning…</content><subsection><num>(a)</num><content>words importing the singular</content></subsection><sourceCredit>(July 30, 1947.)</sourceCredit><notes><note>Editorial</note></notes></section></chapter></title></main></uscDoc>`;
    const { units } = convert({ format: 'uslm', pages: [xml] });
    expect(units.map((item) => [item.id, item.kind, item.parent])).toEqual([
      ['top', 'title', null],
      ['ch1', 'chapter', 'top'],
      ['s1', 'section', 'ch1'],
    ]);
    expect(units[2].text).toBe(
      'In determining the meaning…\n(a) words importing the singular\n(July 30, 1947.)'
    );
    expect(() => convert({ format: 'uslm', pages: ['<x/>'] })).toThrow(/USLM/);
  });

  it('converts eCFR parts and sections with eCFR anchors', () => {
    const xml = `<ECFR><DIV1 N="1" TYPE="TITLE"><HEAD>Title 1—General Provisions</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>CHAPTER I—ADMINISTRATIVE COMMITTEE</HEAD><DIV5 N="1" TYPE="PART"><HEAD>PART 1—DEFINITIONS</HEAD><AUTH><HED>Authority:</HED><PSPACE>44 U.S.C. 1506</PSPACE></AUTH><DIV8 N="1.1" TYPE="SECTION"><HEAD>§ 1.1 Definitions.</HEAD><P>As used in this chapter…</P></DIV8></DIV5></DIV3></DIV1></ECFR>`;
    const body = convert({ format: 'ecfr', pages: [xml] });
    expect(body.title).toBe('Title 1—General Provisions');
    expect(body.units.map((item) => [item.id, item.num, item.heading])).toEqual(
      [
        ['chapter-i', 'CHAPTER I', 'ADMINISTRATIVE COMMITTEE'],
        ['part-1', 'PART 1', 'DEFINITIONS'],
        ['1.1', '§ 1.1', 'Definitions.'],
      ]
    );
    expect(body.units[1].text).toBe('Authority: 44 U.S.C. 1506');
    expect(body.units[2].text).toBe('As used in this chapter…');
  });
});

describe('unified law model', () => {
  it('drops contents duplicates and renames other collisions', () => {
    const document = lawDocument({
      id: 'x/y/en',
      jurisdiction: 'US',
      source: 's',
      language: 'en',
      title: ' T ',
      sourceUrl: 'https://example.org',
      units: [
        { id: 'a', kind: 'article', parent: null, level: 0 },
        { id: 'a', kind: 'article', text: 'full', parent: null, level: 0 },
        { id: 'p', kind: 'part', parent: null, level: 0 },
        { id: 'b', kind: 'article', text: '1', parent: 'p', level: 1 },
        { id: 'b', kind: 'article', text: '2', parent: 'p', level: 1 },
      ],
    });
    expect(document.title).toBe('T');
    expect(ids(document.units)).toEqual(['a', 'p', 'b', 'p-b']);
    expect(validateDocument(document)).toEqual([]);
    expect(validateDocument({ units: [] })).toContain('document has no units');
  });
});
