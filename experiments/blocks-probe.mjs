// Experiment: print the first text blocks extracted from a sample page.
// Usage: node experiments/blocks-probe.mjs <file> <selector> [count]
import { readFileSync } from 'node:fs';
import { parseMarkup, selectAll, blocks } from '../src/law/dom.js';

const [file, selector, count = '40'] = process.argv.slice(2);
const doc = parseMarkup(readFileSync(file, 'utf8'));
const roots = selectAll(doc, selector);
console.log('roots', roots.length);
const all = roots.flatMap(blocks);
console.log('blocks', all.length);
for (const b of all.slice(0, Number(count))) {
  console.log(`${b.tag}.${b.className.slice(0, 20)} | ${b.text.slice(0, 110)}`);
}
