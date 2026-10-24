/**
 * eCFR XML reader (Code of Federal Regulations, https://www.ecfr.gov/).
 * The same `DIVn TYPE=… N=…` structure is served by the eCFR versioner API
 * and the govinfo bulk data repository.
 */
import { attr, blocks, children, lineText, nameOf } from '../dom.js';
import { unit } from '../model.js';
import { cleanLine, slug } from '../text.js';

const divType = /^DIV\d$/u;
const kinds = {
  TITLE: 'title',
  SUBTITLE: 'subtitle',
  CHAPTER: 'chapter',
  SUBCHAP: 'subchapter',
  PART: 'part',
  SUBPART: 'subpart',
  SUBJGRP: 'subject-group',
  SECTION: 'section',
  APPENDIX: 'appendix',
};
const prefixes = {
  chapter: 'chapter',
  subchapter: 'subchapter',
  part: 'part',
  subpart: 'subpart',
  'subject-group': 'group',
  appendix: 'appendix',
};

/** "PART 1—DEFINITIONS" → ["PART 1", "DEFINITIONS"]; "§ 1.1 Definitions." too. */
function splitHead(kind, num, heading) {
  const text = cleanLine(heading);
  if (kind === 'section') {
    const match = text.match(/^(§+\s*[^\s]+)\s+(.*)$/u);
    return match ? [match[1], match[2]] : [`§ ${num}`, text];
  }
  const dash = text.search(/[—–]/u);
  if (dash > 0 && dash < 40) {
    return [cleanLine(text.slice(0, dash)), cleanLine(text.slice(dash + 1))];
  }
  return [num, text];
}

function sectionLines(node) {
  return children(node)
    .filter((item) => nameOf(item) !== 'HEAD')
    .flatMap((item) => blocks({ children: [item] }).map((entry) => entry.text))
    .filter(Boolean);
}

/**
 * Convert a parsed eCFR document into units. Section ids follow the eCFR
 * convention (`1.1`, `part-1`, `subpart-A`), so links match
 * https://www.ecfr.gov/current/title-N/section-1.1 anchors.
 * @param {import('domhandler').Document} root  parsed with `{ xml: true }`
 */
export function convertEcfr(root) {
  const units = [];
  let title = '';
  const visit = (node, parent, level, path) => {
    for (const item of children(node)) {
      if (!divType.test(nameOf(item))) {
        visit(item, parent, level, path);
        continue;
      }
      const type = attr(item, 'TYPE') ?? '';
      const kind = kinds[type] ?? slug(type);
      const num = attr(item, 'N') ?? '';
      const heading = lineText(
        children(item).find((entry) => nameOf(entry) === 'HEAD')
      );
      if (kind === 'title') {
        title = heading;
        visit(item, null, 0, '');
        continue;
      }
      let id;
      if (kind === 'section') {
        id = slug(num);
      } else {
        const local = `${prefixes[kind] ?? kind}-${slug(num)}`;
        id =
          path && !['part', 'appendix'].includes(kind)
            ? `${path}-${local}`
            : local;
      }
      const [label, text] = splitHead(kind, num, heading);
      const value = unit({
        id,
        kind,
        num: label,
        heading: text,
        parent,
        level,
      });
      units.push(value);
      if (kind === 'section' || kind === 'appendix') {
        const text = sectionLines(item).join('\n');
        if (text) {
          value.text = text;
        }
      } else {
        // Authority and source notes of a part or subpart.
        const text = children(item)
          .filter((entry) => !divType.test(nameOf(entry)))
          .map((entry) => children(entry).map(lineText).join(' '))
          .filter(Boolean)
          .join('\n');
        if (text) {
          value.text = text;
        }
        visit(item, value.id, level + 1, id);
      }
    }
  };
  visit(root, null, 0, '');
  return { title, units };
}
