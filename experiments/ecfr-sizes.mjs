// Experiment: measure eCFR title sizes from the versioner structure API.
// Usage: node experiments/ecfr-sizes.mjs <date>
const date = process.argv[2];
const ua = 'link-assistant-law/0.1 (+https://github.com/link-assistant/law)';
let total = 0;
for (let n = 1; n <= 50; n += 1) {
  const response = await fetch(
    `https://www.ecfr.gov/api/versioner/v1/structure/${date}/title-${n}.json`,
    { headers: { 'user-agent': ua } }
  );
  if (!response.ok) {
    console.log(n, 'HTTP', response.status);
  } else {
    const body = await response.json();
    total += body.size ?? 0;
    console.log(n, body.size, (body.children ?? []).length);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log('total', total);
