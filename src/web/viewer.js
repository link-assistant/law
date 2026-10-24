/**
 * Browser viewer for the static law site. Mirrored laws are read from
 * `laws/<key>.json.gz`; live mode downloads the original in the browser and
 * converts it with the same code the CI build uses.
 */
import { PoliteFetcher } from '../law/fetcher.js';
import { fetchTarget, legalOf, toDocument } from '../law/pipeline.js';
import { expandRegistry, parseRegistry } from '../law/registry.js';
import {
  escapeHtml,
  renderContents,
  renderHeader,
  renderUnits,
} from '../law/render.js';

const PROXY_KEY = 'law.proxy';

const $ = (selector) => document.querySelector(selector);

function setStatus(html) {
  $('#status').innerHTML = html;
}

async function gunzipJson(response) {
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return url.endsWith('.gz') ? gunzipJson(response) : response.json();
}

function fetcherFor(entry) {
  const proxy = entry.cors ? '' : (localStorage.getItem(PROXY_KEY) ?? '');
  return new PoliteFetcher({
    proxy,
    robots: false,
    intervalMs: 300,
    retries: 1,
  });
}

/** eCFR titles: the versioner API sends CORS headers. */
async function liveEcfr(entry, registry) {
  const titles = await getJson(
    'https://www.ecfr.gov/api/versioner/v1/titles.json'
  );
  const number = Number(entry.id.split('/t').pop());
  const date = titles.titles.find(
    (item) => item.number === number
  )?.up_to_date_as_of;
  const url = entry.live.replace('{date}', date);
  const text = await new PoliteFetcher({ robots: false }).text(url);
  const target = { ...entry, format: 'ecfr', pages: [url], downloadUrl: url };
  return toDocument(
    target,
    { pages: [text], version: date },
    { source: registry.sources[entry.source] }
  );
}

async function loadLive(entry) {
  const registry = parseRegistry(await (await fetch('registry.lino')).text());
  if (entry.live) {
    return liveEcfr(entry, registry);
  }
  const fetcher = fetcherFor(entry);
  const target = expandRegistry(registry).find(
    (item) => item.key === entry.key
  );
  if (!target) {
    throw new Error(`Live mode is not available for ${entry.key}`);
  }
  const fetched = await fetchTarget(fetcher, target);
  const document = toDocument(target, fetched, {
    source: registry.sources[target.source],
  });
  return { ...document, legal: legalOf(registry.sources[target.source]) };
}

function downloadLink(document) {
  const blob = new Blob([JSON.stringify(document)], {
    type: 'application/json',
  });
  const name = `${document.id.replaceAll('/', '-')}.json`;
  return `<a download="${escapeHtml(name)}" href="${URL.createObjectURL(blob)}">Download unified JSON</a>`;
}

function show(document, { live }) {
  const contents = renderContents(document.units, () => '');
  $('#document').innerHTML =
    `${renderHeader(document, { root: '' })}${live ? `<p>${downloadLink(document)}</p>` : ''}<details class="toc"><summary>Contents</summary>${contents}</details><main>${renderUnits(document.units)}</main>`;
  window.document.title = document.title;
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) {
    window.document.getElementById(id)?.scrollIntoView();
  }
}

function corsHint(entry) {
  if (entry.cors || entry.live || localStorage.getItem(PROXY_KEY)) {
    return '';
  }
  return ' The publisher does not send CORS headers, so a browser can only read it through a CORS proxy (see Settings).';
}

async function view(key, live) {
  const catalog = await getJson('catalog.json');
  const entry = catalog.entries.find((item) => item.key === key);
  if (!entry) {
    throw new Error(`Unknown law ${key}`);
  }
  if (entry.status === 'blocked') {
    setStatus(`<p class="error">Blocked: ${escapeHtml(entry.error)}</p>`);
    return;
  }
  const useLive = live || !entry.json;
  const other =
    useLive && entry.json
      ? `<a href="?doc=${encodeURIComponent(key)}">mirrored copy</a>`
      : `<a href="?doc=${encodeURIComponent(key)}&live=1">load live from the original</a>`;
  setStatus(
    `<p>${useLive ? `Loading live from <a href="${escapeHtml(entry.sourceUrl)}">the original</a> and converting in your browser…${escapeHtml(corsHint(entry))}` : 'Loading mirrored copy…'}</p>`
  );
  const document = useLive ? await loadLive(entry) : await getJson(entry.json);
  show(document, { live: useLive });
  setStatus(
    `<p>${useLive ? 'Live conversion' : 'Mirrored copy'} · ${other}</p>`
  );
}

function setupSettings() {
  const input = $('#proxy');
  if (!input) {
    return;
  }
  input.value = localStorage.getItem(PROXY_KEY) ?? '';
  input.addEventListener('change', () => {
    localStorage.setItem(PROXY_KEY, input.value.trim());
  });
}

function setupFilter() {
  const input = $('#filter');
  if (!input) {
    return;
  }
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    for (const row of document.querySelectorAll('tr[data-search]')) {
      row.hidden = Boolean(query) && !row.dataset.search.includes(query);
    }
  });
}

setupSettings();
setupFilter();
const key = new URLSearchParams(location.search).get('doc');
if (key && $('#document')) {
  view(key, new URLSearchParams(location.search).has('live')).catch((error) => {
    setStatus(
      `<p class="error">${escapeHtml(error.message)}.${escapeHtml(corsHint({}))}</p>`
    );
  });
}
