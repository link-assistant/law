// Experiment: convert XHTML saved by eu-samples.mjs offline and compare the
// units each language yields with the English text of the same document.
// Usage: node experiments/eu-convert-samples.mjs <samples-dir> [document-id ...]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toDocument } from '../src/law/pipeline.js';
import { documentTargets, parseRegistry } from '../src/law/registry.js';

// English first: the other languages are compared with it.
const LANGUAGES =
  'en bg es cs da de et el fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(
    ' '
  );
const [dir, ...ids] = process.argv.slice(2);
const registry = parseRegistry(readFileSync('data/registry.lino', 'utf8'));
for (const id of ids.length ? ids : ['eu/gdpr', 'eu/treaties', 'eu/ai-act']) {
  const raw = { ...registry.documents[id], languages: LANGUAGES };
  let english = null;
  for (const target of documentTargets(id, raw, registry.sources)) {
    const file = join(dir, `${target.key.replaceAll('/', '-')}.xhtml`);
    if (!existsSync(file)) {
      continue;
    }
    const doc = toDocument(target, { pages: [readFileSync(file, 'utf8')] });
    const leafIds = doc.units
      .filter((unit) => ['article', 'annex'].includes(unit.kind))
      .map((unit) => unit.id);
    english ??= new Set(leafIds);
    const kinds = [...new Set(doc.units.map((unit) => unit.kind))].join(',');
    const missing = english
      ? [...english].filter((unitId) => !leafIds.includes(unitId))
      : [];
    console.log(
      `${target.key}\t${doc.units.length} units\t${leafIds.length} articles+annexes\tmissing vs en: ${missing.length ? missing.slice(0, 6).join(' ') : '-'}\tkinds: ${kinds}`
    );
  }
}
