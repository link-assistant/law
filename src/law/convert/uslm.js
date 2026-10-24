/**
 * USLM (United States Legislative Markup) reader for the United States Code
 * published by the Office of the Law Revision Counsel.
 * https://github.com/usgpo/uslm
 */
import { attr, blocks, children, lineText, nameOf } from '../dom.js';
import { unit } from '../model.js';
import { cleanLine, slug } from '../text.js';

const levels = new Set([
  'title',
  'subtitle',
  'chapter',
  'subchapter',
  'part',
  'subpart',
  'division',
  'subdivision',
  'article',
  'subarticle',
  'appendix',
  'compiledAct',
  'courtRules',
  'reorganizationPlans',
]);
// Units whose whole subtree is rendered as text.
const leaves = new Set(['section', 'courtRule', 'reorganizationPlan']);
const provisions = new Set([
  'subsection',
  'paragraph',
  'subparagraph',
  'clause',
  'subclause',
  'item',
  'subitem',
  'subsubitem',
]);
const textual = new Set(['chapeau', 'content', 'continuation', 'text', 'p']);

function textLines(node) {
  const lines = blocks(node).map((entry) => entry.text);
  return lines.length ? lines : [lineText(node)].filter(Boolean);
}

/** Lines of a section or provision: "(a) Heading. Text", nested in order. */
function provisionLines(node, { notes, top = false }) {
  const lines = [];
  let prefix = [];
  const flush = () => {
    if (prefix.length) {
      lines.push(cleanLine(prefix.join(' ')));
      prefix = [];
    }
  };
  for (const item of children(node)) {
    const name = nameOf(item);
    if (name === 'num' || name === 'heading') {
      if (top) {
        continue;
      }
      prefix.push(lineText(item));
    } else if (textual.has(name) || name === 'table') {
      const [first = '', ...rest] = textLines(item);
      prefix.push(first);
      flush();
      lines.push(...rest);
    } else if (provisions.has(name)) {
      flush();
      lines.push(...provisionLines(item, { notes }));
    } else if (name === 'sourceCredit') {
      flush();
      lines.push(lineText(item));
    } else if (notes && name === 'notes') {
      flush();
      lines.push(...textLines(item));
    }
  }
  flush();
  return lines.filter(Boolean);
}

function localId(identifier, base) {
  if (!identifier) {
    return null;
  }
  const relative = identifier.startsWith(`${base}/`)
    ? identifier.slice(base.length + 1)
    : identifier.replace(/^\/+/u, '');
  return relative.replace(/[^\p{L}\p{N}.]+/gu, '-');
}

/**
 * Convert a parsed USLM document into units.
 * @param {import('domhandler').Document} root  parsed with `{ xml: true }`
 * @param {{ notes?: boolean }} [options]  include editorial/statutory notes
 */
export function convertUslm(root, { notes = false } = {}) {
  const main = [...children(root)]
    .flatMap((item) => (nameOf(item) === 'uscDoc' ? children(item) : [item]))
    .find((item) => ['main', 'appendix'].includes(nameOf(item)));
  if (!main) {
    throw new Error('Not a USLM document: <main> is missing');
  }
  const top =
    nameOf(main) === 'appendix'
      ? main
      : children(main).find((item) => attr(item, 'identifier'));
  const base = attr(top, 'identifier') ?? '';
  const units = [];
  const visit = (node, parent, level) => {
    let found = 0;
    for (const item of children(node)) {
      const name = nameOf(item);
      if (leaves.has(name) || levels.has(name)) {
        found += 1;
        const num = children(item).find((entry) => nameOf(entry) === 'num');
        const heading = children(item).find(
          (entry) => nameOf(entry) === 'heading'
        );
        const numText = lineText(num).replace(/[—–-]+$/u, '');
        const id =
          localId(attr(item, 'identifier'), base) ??
          `${slug(name)}-${slug(attr(num, 'value') ?? numText)}`;
        const value = unit({
          id: item === top ? 'top' : id,
          kind: name,
          num: numText,
          heading: lineText(heading),
          parent,
          level,
        });
        units.push(value);
        if (leaves.has(name) || !visit(item, value.id, level + 1)) {
          value.text = provisionLines(item, { notes, top: true }).join('\n');
          if (!value.text) {
            delete value.text;
          }
        }
      } else if (name === 'notes' && notes) {
        const text = textLines(item).join('\n');
        if (text) {
          units.push(
            unit({ id: attr(item, 'id'), kind: 'note', text, parent, level })
          );
        }
      } else if (!['toc', 'notes', 'note', 'num', 'heading'].includes(name)) {
        found += visit(item, parent, level);
      }
    }
    return found;
  };
  if (main === top) {
    visit({ children: [main] }, null, 0);
  } else {
    visit(main, null, 0);
  }
  const meta = children(root)
    .flatMap((item) => (nameOf(item) === 'uscDoc' ? children(item) : [item]))
    .find((item) => nameOf(item) === 'meta');
  const field = (name) =>
    lineText(children(meta).find((item) => nameOf(item) === name));
  const head = units[0];
  return {
    title: head
      ? cleanLine(`${head.num} ${head.heading ?? ''}`)
      : field('title'),
    version: field('docPublicationName'),
    identifier: base,
    units,
  };
}
