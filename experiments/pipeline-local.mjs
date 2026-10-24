// Run the pipeline against previously downloaded samples (no network).
// Usage: node experiments/pipeline-local.mjs [/tmp/dl]
import { readFileSync, existsSync } from 'node:fs';
import { PoliteFetcher } from '../src/law/fetcher.js';
import { parseRegistry, expandRegistry } from '../src/law/registry.js';
import { buildTarget, collectionTargets } from '../src/law/pipeline.js';

const dir = process.argv[2] ?? '/tmp/dl';
const files = {
  'https://www.archives.gov/founding-docs/constitution-transcript':
    'samples/archives-constitution.html',
  'http://publications.europa.eu/resource/celex/32016R0679':
    'samples/gdpr.xhtml',
  'http://publications.europa.eu/resource/oj/JOC_2016_202_R.ENG.xhtml':
    'eu3/d1',
  'https://www.gov.cn/guoqing/2018-03/22/content_5276318.htm':
    'samples/govcn-constitution.html',
  'http://www.kremlin.ru/acts/constitution':
    'samples/kremlin-constitution.html',
  'https://matsne.gov.ge/en/document/view/30346':
    'samples/matsne-30346-en.html',
  'https://uscode.house.gov/download.html': null,
  'https://www.govinfo.gov/bulkdata/json/ECFR': null,
};
const respond = (url) => {
  const href = String(url);
  if (href === 'https://uscode.house.gov/download.html') {
    return new Response(
      '<a href="download/releasepoints/us/pl/119/124/xml_uscAll@119-124.zip">zip</a>'
    );
  }
  if (href.endsWith('xml_uscAll@119-124.zip')) {
    return new Response(readFileSync(`${dir}/usc/all.zip`));
  }
  if (href === 'https://www.govinfo.gov/bulkdata/json/ECFR') {
    return Response.json({
      files: [
        {
          folder: true,
          cfrTitle: 1,
          link: 'https://www.govinfo.gov/bulkdata/json/ECFR/title-1',
        },
      ],
    });
  }
  if (href === 'https://www.govinfo.gov/bulkdata/json/ECFR/title-1') {
    return new Response(readFileSync(`${dir}/govinfo/list.json`));
  }
  if (href.endsWith('ECFR-title1.xml')) {
    return new Response(readFileSync(`${dir}/govinfo/t1.xml`));
  }
  const file = files[href];
  return file && existsSync(`${dir}/${file}`)
    ? new Response(readFileSync(`${dir}/${file}`), {
        headers: { 'content-type': 'text/html' },
      })
    : new Response('missing', { status: 404 });
};
const local = (url) => Promise.resolve(respond(url));
const fetcher = new PoliteFetcher({
  fetch: local,
  intervalMs: 0,
  robots: false,
  retries: 0,
});
const registry = parseRegistry(readFileSync('data/registry.lino', 'utf8'));
const report = (result) => {
  const { target, document, error } = result;
  console.log(
    target.key.padEnd(30),
    document
      ? `${document.units.length} units ${document.sha256.slice(0, 8)} ${document.title}`
      : `ERROR ${error}`
  );
};
for (const target of expandRegistry(registry)) {
  if (files[target.pages[0]] || target.mode === 'blocked') {
    report(
      await buildTarget(
        { ...target, pages: target.pages.slice(0, 1) },
        { fetcher, registry }
      )
    );
  }
}
let count = 0;
for (const [id, collection] of Object.entries(registry.collections)) {
  for await (const target of collectionTargets(id, collection, {
    fetcher,
    registry,
  })) {
    if (count++ % 20 === 0 || id === 'us/cfr') {
      report(await buildTarget(target, { fetcher, registry }));
    }
  }
}
