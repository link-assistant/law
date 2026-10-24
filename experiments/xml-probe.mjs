// Experiment: run the USLM or eCFR converter on a local XML file.
// Usage: node experiments/xml-probe.mjs <uslm|ecfr> <file> [count]
import { readFileSync } from 'node:fs';
import { parseMarkup } from '../src/law/dom.js';
import { convertUslm } from '../src/law/convert/uslm.js';
import { convertEcfr } from '../src/law/convert/ecfr.js';
import { finalizeUnits } from '../src/law/model.js';

const [format, file, count = '12'] = process.argv.slice(2);
const started = Date.now();
const root = parseMarkup(readFileSync(file, 'utf8'), { xml: true });
const result = (format === 'uslm' ? convertUslm : convertEcfr)(root);
const units = finalizeUnits(result.units);
const kinds = {};
for (const u of units) {
  kinds[u.kind] = (kinds[u.kind] ?? 0) + 1;
}
console.log(
  result.title,
  '|',
  result.version,
  '|',
  units.length,
  JSON.stringify(kinds),
  `${Date.now() - started}ms`,
  `json=${JSON.stringify(units).length}`
);
for (const u of units.slice(0, Number(count))) {
  console.log(
    `${'  '.repeat(u.level)}${u.id} [${u.num ?? ''}] ${u.heading ?? ''} :: ${(u.text ?? '').slice(0, 90).replace(/\n/g, ' / ')}`
  );
}
