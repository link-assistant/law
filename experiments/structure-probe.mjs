// Experiment: run the structural converter on a downloaded sample.
// Usage: node experiments/structure-probe.mjs <file> <selector> <profile> [count]
import { readFileSync } from 'node:fs';
import { parseMarkup, selectAll, blocks } from '../src/law/dom.js';
import { convertBlocks } from '../src/law/convert/structure.js';
import { finalizeUnits } from '../src/law/model.js';

const [file, selector, profile, count = '15'] = process.argv.slice(2);
const doc = parseMarkup(readFileSync(file, 'utf8'));
const units = finalizeUnits(
  convertBlocks(selectAll(doc, selector).flatMap(blocks), { profile })
);
const kinds = {};
for (const u of units) {
  kinds[u.kind] = (kinds[u.kind] ?? 0) + 1;
}
console.log(units.length, JSON.stringify(kinds));
for (const u of units.slice(0, Number(count))) {
  console.log(
    `${'  '.repeat(u.level)}${u.id} [${u.num ?? ''}] ${u.heading ?? ''} :: ${(u.text ?? '').slice(0, 70).replace(/\n/g, ' / ')}`
  );
}
