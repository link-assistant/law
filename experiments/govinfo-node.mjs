// Diagnose Node fetch against govinfo bulk JSON listings.
const ua = 'link-assistant-law/0.1 (+https://github.com/link-assistant/law)';
for (const url of [
  'https://www.govinfo.gov/bulkdata/json/ECFR',
  'https://www.govinfo.gov/bulkdata/json/ECFR/title-1',
]) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': ua },
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    console.log(url, response.status, text.length, Date.now() - started, 'ms');
  } catch (error) {
    console.log(url, 'ERROR', error.message, Date.now() - started, 'ms');
  }
}
