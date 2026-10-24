/**
 * Single conversion entry point used by the CLI, CI and the browser viewer.
 * Input is raw source text (one or more pages); output is the unified
 * document body `{ title?, version?, units }`.
 */
import { blocks, parseMarkup, selectAll } from '../dom.js';
import { convertBlocks } from './structure.js';
import { convertUslm } from './uslm.js';
import { convertEcfr } from './ecfr.js';

export const FORMATS = ['html', 'uslm', 'ecfr'];

export function decodeText(input, charset = 'utf-8') {
  return typeof input === 'string'
    ? input
    : new TextDecoder(charset).decode(input);
}

function htmlBlocks(pages, selector) {
  return pages.flatMap((page) => {
    const root = parseMarkup(page);
    const scope = selector ? selectAll(root, selector) : [root];
    if (!scope.length) {
      throw new Error(`Selector ${selector} matched nothing`);
    }
    return scope.flatMap(blocks);
  });
}

/**
 * @param {object} options
 * @param {string} options.format html | uslm | ecfr
 * @param {Array<string|Uint8Array>} options.pages source pages in order
 * @param {string} [options.selector] content selector for html
 * @param {string} [options.profile] structure profile for html
 * @param {string} [options.charset]
 * @param {boolean} [options.notes] keep editorial notes (uslm)
 */
export function convert({
  format,
  pages,
  selector,
  profile,
  charset,
  notes = false,
}) {
  const texts = pages.map((page) => decodeText(page, charset));
  if (format === 'html') {
    return { units: convertBlocks(htmlBlocks(texts, selector), { profile }) };
  }
  if (format === 'uslm' || format === 'ecfr') {
    if (texts.length !== 1) {
      throw new Error(`${format} expects exactly one page`);
    }
    const root = parseMarkup(texts[0], { xml: true });
    return format === 'uslm' ? convertUslm(root, { notes }) : convertEcfr(root);
  }
  throw new Error(`Unknown format ${format}; expected ${FORMATS.join(', ')}`);
}
