// Reproduce the govinfo listing timeout through PoliteFetcher.
import { PoliteFetcher } from '../src/law/fetcher.js';

const fetcher = new PoliteFetcher({
  log: console.log,
  timeoutMs: 20000,
  retries: 0,
});
const headers = { accept: 'application/json' };
for (const url of [
  'https://www.govinfo.gov/bulkdata/json/ECFR',
  'https://www.govinfo.gov/bulkdata/json/ECFR/title-1',
]) {
  const started = Date.now();
  try {
    const value = await fetcher.json(url, { headers });
    console.log(url, Object.keys(value), Date.now() - started, 'ms');
  } catch (error) {
    console.log(url, 'ERROR', error.message, Date.now() - started, 'ms');
  }
}
