// Fetches consecutive kremlin.ru pages through PoliteFetcher with the
// registry interval and logs the network cause of any failure.
import { PoliteFetcher } from '../src/law/fetcher.js';

const [base = 'http://www.kremlin.ru/acts/bank/7279/page/', count = '8'] =
  process.argv.slice(2);
const fetcher = new PoliteFetcher({
  hostIntervals: {
    'http://www.kremlin.ru': Number(process.env.INTERVAL_MS ?? 6000),
  },
  log: (message) => console.log(new Date().toISOString(), message),
});
for (let page = 1; page <= Number(count); page += 1) {
  const started = Date.now();
  try {
    const text = await fetcher.text(`${base}${page}`);
    console.log(
      new Date().toISOString(),
      page,
      text.length,
      Date.now() - started
    );
  } catch (error) {
    console.log(
      new Date().toISOString(),
      page,
      'ERR',
      error.message,
      error.cause?.code
    );
  }
}
