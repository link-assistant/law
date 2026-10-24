import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function dependencyReviewAvailable(response, eventName) {
  if (!response.ok && ![403, 404].includes(response.status)) {
    throw new Error(
      `Dependency review capability probe failed: HTTP ${response.status}`
    );
  }
  if (!response.ok && eventName !== 'pull_request') {
    throw new Error(
      'Enable Dependency graph under Settings → Advanced Security → Dependency graph, then rerun Security.'
    );
  }
  return response.ok;
}
async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const base = process.env.REVIEW_BASE;
  const head = process.env.REVIEW_HEAD;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/dependency-graph/compare/${base}...${head}`,
    {
      headers: {
        authorization: `Bearer ${process.env.GH_TOKEN}`,
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30000),
    }
  );
  const available = dependencyReviewAvailable(
    response,
    process.env.GITHUB_EVENT_NAME
  );
  if (!available) {
    const action =
      'Enable Dependency graph under Settings → Advanced Security → Dependency graph, then rerun Security.';
    console.log(
      `::notice::Dependency review API unavailable (HTTP ${response.status}). Both npm locks are audited instead. ${action}`
    );
  }
  await appendFile(process.env.GITHUB_OUTPUT, `available=${available}\n`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
