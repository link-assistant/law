// Prints status, timing and the underlying network error for kremlin.ru
// pages, spaced by a polite interval, to tell throttling from outages.
const UA = 'link-assistant-law/0.1 (+https://github.com/link-assistant/law)';
const urls = process.argv.slice(2);
for (const url of urls) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(60000),
    });
    const body = await response.text();
    console.log(response.status, body.length, Date.now() - started, url);
  } catch (error) {
    console.log(
      'ERR',
      error.message,
      error.cause?.code,
      error.cause?.message,
      Date.now() - started,
      url
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
