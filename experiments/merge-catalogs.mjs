// Merges catalogs from separate partial builds (e.g. an RU-only build and
// a build of everything else) into one Links Notation catalog.
// Usage: node experiments/merge-catalogs.mjs out.lino a.lino b.lino ...
import { writeFile } from 'node:fs/promises';
import { readCatalogLino } from '../src/law/site.js';
import { toLino } from '../src/law/lino.js';

const [out, ...inputs] = process.argv.slice(2);
const documents = {};
for (const input of inputs) {
  Object.assign(documents, await readCatalogLino(input));
}
await writeFile(out, `${toLino({ documents })}\n`);
console.log(`${Object.keys(documents).length} documents → ${out}`);
