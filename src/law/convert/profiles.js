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
 * `reset` closes every open level, `skipText`/`skipClass` drop page chrome
 * and `stopAt` marks a table of contents to skip.
 */

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

/** Official Journal of the EU (Cellar/EUR-Lex XHTML), any language. */
const euOfficialJournal = {
  rules: [
    {
      kind: 'annex',
      reset: true,
      className: /(?:^|\s)oj-doc-ti(?:\s|$)/u,
      pattern:
        /^(?<label>ANNEX|ANHANG|ANNEXE|ALLEGATO|BIJLAGE|ANEXO|ZAŁĄCZNIK)\s*(?<num>[IVXLC\d]*)$/u,
    },
    {
      kind: 'heading',
      className: /(?:^|\s)oj-ti-section-1(?:\s|$)/u,
      kindFromLabel: true,
      pattern: /^(?<label>\S+)\s+(?<num>\S+)$/u,
      headingNext: /(?:^|\s)oj-ti-section-2(?:\s|$)/u,
    },
    {
      kind: 'article',
      leaf: true,
      className: /(?:^|\s)oj-ti-art(?:\s|$)/u,
      pattern: /^(?<label>\S+)\s+(?<num>\d+[a-z]*)$/u,
      headingNext: /(?:^|\s)oj-sti-art(?:\s|$)/u,
    },
  ],
  skipClass: /(?:^|\s)oj-(?:hd-|note|separator|doc-end)/u,
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
