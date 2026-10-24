// Experiment: save Cellar XHTML of EU registry documents in all 24
// official languages, then list the heading, article and annex lines the
// Official Journal profiles have to recognise.
// Usage: node experiments/eu-samples.mjs <out-dir> [document-id ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocks, parseMarkup, selectAll } from '../src/law/dom.js';
import { PoliteFetcher } from '../src/law/fetcher.js';
import { fetchTarget } from '../src/law/pipeline.js';
import { documentTargets, parseRegistry } from '../src/law/registry.js';

const LANGUAGES =
  'bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(
    ' '
  );
const [outDir, ...ids] = process.argv.slice(2);
const registry = parseRegistry(readFileSync('data/registry.lino', 'utf8'));
const fetcher = new PoliteFetcher({ log: (line) => console.log(`  ${line}`) });
mkdirSync(outDir, { recursive: true });
const classes = /(?:^|\s)(?:oj-)?(ti-section-1|ti-art|doc-ti)(?:\s|$)/u;
for (const id of ids.length ? ids : ['eu/gdpr', 'eu/treaties']) {
  const raw = { ...registry.documents[id], languages: LANGUAGES };
  for (const target of documentTargets(id, raw, registry.sources)) {
    const file = join(outDir, `${target.key.replaceAll('/', '-')}.xhtml`);
    if (!existsSync(file)) {
      const fetched = await fetchTarget(fetcher, target);
      writeFileSync(file, fetched.pages[0]);
    }
    const root = parseMarkup(readFileSync(file, 'utf8'));
    const lines = selectAll(root, target.selector)
      .flatMap((scope) => blocks(scope))
      .filter((block) => classes.test(block.className))
      .map((block) => `${classes.exec(block.className)[1]}\t${block.text}`);
    writeFileSync(`${file}.lines.txt`, `${lines.join('\n')}\n`);
    console.log(`${target.key} ${lines.length} lines`);
  }
}
