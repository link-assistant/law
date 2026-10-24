/**
 * Structural profiles for the block converter.
 *
 * A profile is an ordered rule list. Each rule recognises one kind of
 * structural line, by class name and/or a regular expression whose named
 * groups are `num`, `heading` and `text` (inline body after the label).
 * `leaf` rules (articles, sections) receive the following body blocks;
 * other rules open a hierarchy level. Hierarchy depth is inferred: a kind
 * already open closes back to its level, a new kind nests below the current
 * one, so the same rules work for any nesting a publisher uses.
 * `scoped` leaf ids are prefixed by their parent (`article-1-section-2`),
 * `namespace` units (numbered by occurrence) prefix every leaf below them,
 * `merge` joins consecutive matches of one rule into a single heading,
 * `reset` closes every open level, `skipText`/`skipClass` drop page chrome
 * and `stopAt` marks a table of contents to skip. A rule may `parse` the
 * line itself (returning the groups or null), given what the profile's
 * `prepare` collected from all blocks of the document.
 */
import { cleanLine, fromRoman } from '../text.js';

const dash = '\\s*(?:[–—-]|\\.)?\\s*';
const tail = `(?:${dash}(?<heading>.*))?`;

/** United States Constitution transcripts (National Archives). */
const usConstitution = {
  rules: [
    {
      kind: 'article',
      pattern: /^Article\.?\s+(?<num>[IVXLC]+)\.?$/iu,
    },
    {
      kind: 'amendment',
      reset: true,
      pattern: new RegExp(`^Amendment\\s+(?<num>[IVXLC]+)\\.?${tail}$`, 'iu'),
    },
    {
      kind: 'section',
      leaf: true,
      scoped: true,
      pattern: /^Section\.?\s+(?<num>\d+)\.?$/iu,
    },
  ],
  skipText: /^Print This Page$/u,
};

const ojClass = (name) => new RegExp(`(?:^|\\s)(?:oj-)?${name}(?:\\s|$)`, 'u');

/** "ANNEX" in the 24 official EU languages, as printed in OJ titles. */
const annexWords = [
  'ANNEX',
  'ANNEXE',
  'ANHANG',
  'ALLEGATO',
  'BIJLAGE',
  'ANEXO',
  'ANEXA',
  'ANEXĂ',
  'ANNESS',
  'ZAŁĄCZNIK',
  'ПРИЛОЖЕНИЕ',
  'PŘÍLOHA',
  'PRÍLOHA',
  'PRILOG',
  'PRILOGA',
  'BILAG',
  'BILAGA',
  'LIITE',
  'LISA',
  'PIELIKUMS',
  'PRIEDAS',
  'MELLÉKLET',
  'ΠΑΡΑΡΤΗΜΑ',
  'IARSCRÍBHINN',
].join('|');
// Greek texts write Roman numerals with Greek capitals (Ι, Χ) mixed with V.
const ojNumeral = '[IVXLCΙΧ]+|\\d+';
const toLatin = (text) => text.replace(/Ι/gu, 'I').replace(/Χ/gu, 'X');

// Inserted provisions: "62a", "62 a", "62.a", "62.o-A", "62 bis", "62 ter".
const latinOrdinals = [
  'bis',
  'ter',
  'quater',
  'quinquies',
  'sexies',
  'septies',
  'octies',
  'nonies',
  'decies',
];
// Bulgarian and Greek texts letter them in their own alphabet ("62б", "62β").
const alphabets = [
  'abcdefghijklmnopqrstuvwxyz',
  'абвгдежзийклмнопрстуфхцчшщъьюя',
  'αβγδεζηθικλμνξοπρστυφχψω',
];
const suffix = `(?:${latinOrdinals.join('|')}|\\p{L})(?!\\p{L})`;
const suffixLetter = (value) => {
  if (!value) {
    return '';
  }
  const letter = value.toLowerCase();
  const ordinal = latinOrdinals.indexOf(letter);
  const at =
    ordinal >= 0
      ? ordinal
      : alphabets.map((list) => list.indexOf(letter)).find((i) => i >= 0);
  return at >= 0 ? alphabets[0][at] : letter;
};
const separateOrdinal = new RegExp(
  `\\s+(${latinOrdinals.join('|')})(?=\\s|$)`,
  'gu'
);
const headingNumeral = new RegExp(
  `^(?<value>\\d+|(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))(?:[.-]?(?<suffix>${suffix}))?\\.?$`,
  'u'
);

/** "IV", "4.", "IV.a", "ΙV": the number as written in ids ("4a"), or null. */
function numeralOf(word) {
  const match = toLatin(word).match(headingNumeral);
  if (!match) {
    return null;
  }
  const { value } = match.groups;
  const number = /^\d+$/u.test(value) ? value : String(fromRoman(value));
  return `${number}${suffixLetter(match.groups.suffix)}`;
}

/** How often each word starts or ends an OJ section heading of a document. */
function headingWords(blocks) {
  const counts = new Map();
  for (const block of blocks) {
    if (ojClass('ti-section-1').test(block.className ?? '')) {
      for (const word of cleanLine(block.text).toUpperCase().split(' ')) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Split an OJ section heading into label and number in any language:
 * "CHAPTER I", "I. FEJEZET", "III ANTRAŠTINĖ DALIS", "GLAVA IV.a". Ordinal
 * words ("PART ONE", "ERSTER TEIL", "PARTEA A DOUA") carry no numeral; there
 * the label is the edge word repeated by more headings of the document.
 */
function ojHeading(text, counts) {
  const words = text.replace(separateOrdinal, '$1').split(' ');
  if (words.length < 2) {
    return null;
  }
  const last = words.length - 1;
  const at = [0, last].find((index) => numeralOf(words[index]) !== null);
  if (at !== undefined) {
    return {
      label: words.filter((_, index) => index !== at).join(' '),
      num: numeralOf(words[at]),
    };
  }
  // The label is the first or the last word, whichever more headings share.
  const count = (word) => counts?.get(word.toUpperCase()) ?? 0;
  return count(words[last]) > count(words[0])
    ? { label: words[last], num: words.slice(0, last).join(' ') }
    : { label: words[0], num: words.slice(1).join(' ') };
}

// The number may come first ("1 artikla", "1. cikk"), carry an ordinal mark
// ("Artigo 1.o"), a footnote reference ("Article 23a (1)") or the former
// number ("Article 37 (ex Article 38)").
const ojArticleTitle = new RegExp(
  `^(?:\\p{L}+\\s*)?(?<num>\\d+|premier)\\.?[oº°]?\\s*[-–]?\\s*(?<suffix>${suffix})?\\.?(?:\\s+\\p{L}+)?(?:\\s*\\([^)]*\\))?$`,
  'u'
);

function ojArticle(text) {
  const match = text.match(ojArticleTitle);
  return match
    ? { num: `${match.groups.num}${suffixLetter(match.groups.suffix)}` }
    : null;
}

const ojRules = [
  {
    kind: 'annex',
    reset: true,
    className: ojClass('doc-ti'),
    pattern: new RegExp(
      `^(?:${annexWords})(?:\\s+(?<num>${ojNumeral})\\.?)?$`,
      'u'
    ),
  },
  {
    kind: 'annex',
    reset: true,
    className: ojClass('doc-ti'),
    pattern: new RegExp(`^(?<num>${ojNumeral})\\.?\\s+(?:${annexWords})$`, 'u'),
  },
  {
    kind: 'heading',
    className: ojClass('ti-section-1'),
    kindFromLabel: true,
    parse: ojHeading,
    headingNext: ojClass('ti-section-2'),
  },
  {
    kind: 'article',
    leaf: true,
    className: ojClass('ti-art'),
    parse: ojArticle,
    headingNext: ojClass('sti-art'),
  },
];

const ojSkip = /(?:^|\s)(?:oj-)?(?:hd-|note|separator|doc-end)/u;

/** Official Journal of the EU (Cellar/EUR-Lex XHTML), any language. */
const euOfficialJournal = {
  rules: ojRules,
  skipClass: ojSkip,
  prepare: headingWords,
};

/**
 * A whole Official Journal issue holding several acts (e.g. OJ C 202/2016:
 * TEU, TFEU, protocols, declarations, the Charter). Every document title
 * opens a namespace so article ids stay unique (`document-2-article-1`).
 */
const euOfficialJournalIssue = {
  rules: [
    ...ojRules.slice(0, 2),
    {
      kind: 'document',
      reset: true,
      namespace: true,
      merge: true,
      className: ojClass('doc-ti'),
      pattern: /^(?<heading>.+)$/u,
    },
    ...ojRules.slice(2),
  ],
  skipClass: ojSkip,
  prepare: headingWords,
};

const chineseNumber = '[零〇一二两三四五六七八九十百千\\d]+';

/** Laws of the People's Republic of China. */
const chinese = {
  rules: [
    {
      kind: 'preamble',
      leaf: true,
      reset: true,
      pattern: /^(?<heading>序言)$/u,
    },
    {
      kind: 'part',
      pattern: new RegExp(
        `^第(?<num>${chineseNumber})编[\\s\u3000]*(?<heading>.*)$`,
        'u'
      ),
    },
    {
      kind: 'subpart',
      pattern: new RegExp(
        `^第(?<num>${chineseNumber})分编[\\s\u3000]*(?<heading>.*)$`,
        'u'
      ),
    },
    {
      kind: 'chapter',
      pattern: new RegExp(
        `^第(?<num>${chineseNumber})章[\\s\u3000]*(?<heading>.*)$`,
        'u'
      ),
    },
    {
      kind: 'section',
      pattern: new RegExp(
        `^第(?<num>${chineseNumber})节[\\s\u3000]*(?<heading>.*)$`,
        'u'
      ),
    },
    {
      kind: 'article',
      leaf: true,
      pattern: new RegExp(
        `^第(?<num>${chineseNumber})条[\\s\u3000]*(?<text>.*)$`,
        'u'
      ),
    },
  ],
  stopAt: /^目\s*录$/u,
};

const russianNumber = '[IVXLC\\d]+(?:\\.\\d+)*|[а-яё]+';

/** Russian federal codes and laws (Kremlin, Ministry of Justice). */
const russian = {
  rules: [
    {
      kind: 'part',
      pattern: /^ЧАСТЬ\s+(?<num>ПЕРВАЯ|ВТОРАЯ|ТРЕТЬЯ|ЧЕТВЕРТАЯ|\d+)$/u,
    },
    {
      kind: 'division',
      pattern: new RegExp(`^Раздел\\s+(?<num>${russianNumber})${tail}$`, 'iu'),
    },
    {
      kind: 'subdivision',
      pattern: new RegExp(
        `^Подраздел\\s+(?<num>${russianNumber})${tail}$`,
        'iu'
      ),
    },
    {
      kind: 'chapter',
      pattern: new RegExp(`^Глава\\s+(?<num>${russianNumber})${tail}$`, 'iu'),
    },
    {
      kind: 'paragraph',
      pattern: /^§\s*(?<num>\d+(?:\.\d+)*)\.?\s*(?<heading>.*)$/u,
    },
    {
      kind: 'article',
      leaf: true,
      maxLength: 400,
      pattern: /^Статья\s+(?<num>\d+(?:\.\d+)*)\.?\s*(?<heading>.*)$/u,
    },
  ],
};

/** Laws of Georgia published by Matsne (Georgian, English, Russian). */
const georgian = {
  rules: [
    {
      kind: 'chapter',
      pattern: new RegExp(
        `^(?:Chapter|თავი|Глава)\\s+(?<num>\\S+)${tail}$`,
        'iu'
      ),
      maxLength: 300,
    },
    {
      kind: 'article',
      leaf: true,
      maxLength: 400,
      pattern: new RegExp(
        `^(?:Article|მუხლი|Статья)\\s+(?<num>\\d+[\\d¹²³⁴⁵⁶⁷⁸⁹⁰]*)${tail}$`,
        'iu'
      ),
    },
  ],
};

/** Acts of Parliament of India (sections within parts/chapters). */
const indian = {
  rules: [
    {
      kind: 'part',
      pattern: new RegExp(`^PART\\s+(?<num>[IVXLC]+[A-Z]?)${tail}$`, 'u'),
    },
    {
      kind: 'chapter',
      pattern: new RegExp(`^CHAPTER\\s+(?<num>[IVXLC]+[A-Z]?)${tail}$`, 'u'),
    },
    {
      kind: 'schedule',
      reset: true,
      pattern:
        /^(?<num>FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)\s+SCHEDULE$/u,
    },
    {
      kind: 'article',
      leaf: true,
      maxLength: 600,
      pattern:
        /^(?<num>\d+[A-Z]*)\.\s+(?<heading>[^.—]{2,200})\.?\s*[—–-]\s*(?<text>.*)$/u,
    },
  ],
};

export const profiles = {
  'us-constitution': usConstitution,
  'eu-oj': euOfficialJournal,
  'eu-oj-issue': euOfficialJournalIssue,
  zh: chinese,
  ru: russian,
  ge: georgian,
  in: indian,
};

export function getProfile(name) {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown structure profile: ${name}`);
  }
  return profile;
}
