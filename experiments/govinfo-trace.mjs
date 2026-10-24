// Trace each request PoliteFetcher sends to govinfo (headers and timing).
import { PoliteFetcher } from '../src/law/fetcher.js';

const traced = (url, init) => {
  const started = Date.now();
  console.log('→', url, Object.fromEntries(init.headers));
  return fetch(url, init).then(
    (response) => {
      console.log('←', url, response.status, Date.now() - started, 'ms');
      return response;
    },
    (error) => {
      console.log('✗', url, error.message, Date.now() - started, 'ms');
      throw error;
    }
  );
};
const fetcher = new PoliteFetcher({
  fetch: traced,
  timeoutMs: 15000,
  retries: 0,
});
const value = await fetcher
  .json('https://www.govinfo.gov/bulkdata/json/ECFR', {
    headers: { accept: 'application/json' },
  })
  .catch((error) => error.message);
console.log(typeof value === 'string' ? value : Object.keys(value));
