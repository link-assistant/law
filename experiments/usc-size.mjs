// Experiment: convert every US Code title in a directory and report sizes.
// Usage: node experiments/usc-size.mjs <dir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseMarkup } from '../src/law/dom.js';
import { convertUslm } from '../src/law/convert/uslm.js';
import { finalizeUnits } from '../src/law/model.js';

const dir = process.argv[2];
let total = 0;
let gz = 0;
let max = ['', 0];
const started = Date.now();
for (const file of readdirSync(dir)
  .filter((name) => name.endsWith('.xml'))
  .sort()) {
  const result = convertUslm(
    parseMarkup(readFileSync(join(dir, file), 'utf8'), { xml: true })
  );
  const json = JSON.stringify(finalizeUnits(result.units));
  total += json.length;
  gz += gzipSync(json).length;
  if (json.length > max[1]) {
    max = [file, json.length];
  }
  console.log(file, result.units.length, (json.length / 1e6).toFixed(1), 'MB');
}
console.log(
  'total MB',
  (total / 1e6).toFixed(1),
  'gzip MB',
  (gz / 1e6).toFixed(1),
  'largest',
  max[0],
  (max[1] / 1e6).toFixed(1),
  `${((Date.now() - started) / 1000).toFixed(0)}s`
);
