/**
 * Convert a law page to the unified model, offline.
 *
 * The same `convert` runs in CI (`law build`), locally (`law fetch`) and in
 * the browser viewer when a source can only be loaded live.
 *
 * Run with any runtime:
 * - Node.js: node examples/law-convert.mjs
 * - Bun: bun examples/law-convert.mjs
 * - Deno: deno run examples/law-convert.mjs
 */
import { convert } from '../src/law/convert/index.js';
import { lawDocument } from '../src/law/model.js';
import { renderUnits } from '../src/law/render.js';

const page = `<html><body><div class="text">
<p>Глава 1. Общие положения</p>
<p>Статья 1. Сфера действия</p>
<p>Настоящий закон применяется ко всем.</p>
<p>Статья 2. Основные понятия</p>
<p>Лицо — любой, кто обладает правоспособностью.</p>
</div></body></html>`;

const { units } = convert({
  format: 'html',
  pages: [page],
  selector: '.text',
  profile: 'ru',
});

const document = lawDocument({
  id: 'example/law',
  title: 'Пример закона',
  jurisdiction: 'RU',
  language: 'ru',
  sourceUrl: 'https://example.org/law',
  units,
});

for (const item of document.units) {
  console.log(`${item.id.padEnd(16)} ${item.kind} ${item.num ?? ''}`.trim());
}
console.log(renderUnits(document.units).slice(0, 300));
