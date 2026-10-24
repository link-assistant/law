// Experiment: convert every EU registry document in all 24 official
// languages through the Cellar, politely (one host, 1.5 s spacing).
// Usage: node experiments/eu-languages.mjs [document-prefix]
import { readFileSync } from 'node:fs';
import { PoliteFetcher } from '../src/law/fetcher.js';
import { buildTarget } from '../src/law/pipeline.js';
import { documentTargets, parseRegistry } from '../src/law/registry.js';

const LANGUAGES =
  'bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(
    ' '
  );
const prefix = process.argv[2] ?? 'eu/';
const registry = parseRegistry(readFileSync('data/registry.lino', 'utf8'));
const fetcher = new PoliteFetcher({ log: (line) => console.log(`  ${line}`) });
for (const [id, raw] of Object.entries(registry.documents)) {
  if (!id.startsWith(prefix)) {
    continue;
  }
  const targets = documentTargets(
    id,
    { ...raw, languages: LANGUAGES },
    registry.sources
  );
  for (const target of targets) {
    const started = Date.now();
    const result = await buildTarget(target, {
      fetcher,
      registry,
      retrievedAt: new Date().toISOString(),
    });
    const ms = Date.now() - started;
    console.log(
      result.document
        ? `ok ${target.key} ${result.document.units.length} units ${ms} ms`
        : `error ${target.key} ${result.error}`
    );
  }
}
