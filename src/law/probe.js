/**
 * Reachability probe: for one URL per registry document and collection,
 * report robots.txt verdict, HTTP status, CORS header and timing. CI runs
 * it so access problems are recorded from GitHub-hosted runners too.
 */
import { expandRegistry } from './registry.js';

const ORIGIN = 'https://link-assistant.github.io';

/** One probe URL per document id (first language) and per collection. */
export function probeTargets(registry, { only = [] } = {}) {
  const seen = new Set();
  const targets = [];
  for (const target of expandRegistry(registry)) {
    if (seen.has(target.id)) {
      continue;
    }
    seen.add(target.id);
    targets.push({
      key: target.key,
      url: target.pages[0],
      headers: target.headers,
    });
  }
  for (const [id, collection] of Object.entries(registry.collections)) {
    targets.push({
      key: id,
      url: collection.index,
      headers: { accept: 'application/json, text/html' },
    });
  }
  return targets.filter(
    (target) =>
      !only.length || only.some((prefix) => target.key.startsWith(prefix))
  );
}

async function probeOne(fetcher, target) {
  const started = Date.now();
  const row = { key: target.key, url: target.url };
  try {
    const response = await fetcher.fetch(target.url, {
      headers: { ...target.headers, origin: ORIGIN },
    });
    await response.body?.cancel();
    Object.assign(row, {
      robots: 'allowed',
      status: response.status,
      cors: response.headers.get('access-control-allow-origin') ?? '',
      type: (response.headers.get('content-type') ?? '').split(';')[0],
    });
  } catch (error) {
    row.robots = error.code === 'ROBOTS_DISALLOWED' ? 'disallowed' : 'allowed';
    row.error = error.cause?.code ?? error.message;
  }
  row.ms = Date.now() - started;
  return row;
}

export function probe(registry, { fetcher, only } = {}) {
  const targets = probeTargets(registry, { only });
  // Hosts are queued separately by the fetcher, so probe them concurrently.
  return Promise.all(targets.map((target) => probeOne(fetcher, target)));
}

const cell = (value) => String(value ?? '').replaceAll('|', '\\|');

export function probeMarkdown(rows, { agent } = {}) {
  const lines = [
    `### Source probe (robots.txt token \`${agent}\`)`,
    '',
    '| Document | Status | robots.txt | CORS | Type | ms | Error | URL |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${cell(row.key)} | ${cell(row.status ?? '—')} | ${cell(row.robots)} | ${cell(row.cors || '—')} | ${cell(row.type)} | ${row.ms} | ${cell(row.error)} | ${cell(row.url)} |`
    ),
  ];
  return `${lines.join('\n')}\n`;
}
