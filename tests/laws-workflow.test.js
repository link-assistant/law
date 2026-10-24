import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';

const workflow = readFileSync('.github/workflows/laws.yml', 'utf8').replaceAll(
  '\r\n',
  '\n'
);

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const rest = workflow.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/u);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

describe('laws workflow', () => {
  it('refreshes the laws on a schedule, on main and on demand', () => {
    expect(workflow).toMatch(/schedule:\n\s+.*\n?\s+- cron: '[^']+'/u);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("      - 'data/registry.lino'");
    // The catalog is written by the workflow, so it must not retrigger it.
    expect(workflow).not.toContain("'data/**'");
  });

  it('builds a subset on pull requests and the full site elsewhere', () => {
    const build = job('build');
    expect(build).toContain("if: github.event_name == 'pull_request'");
    expect(build).toContain('--min-ok 3');
    expect(build).toContain('--previous "$LAW_SITE_URL"');
    expect(build).toContain('--catalog data/catalog.lino');
    expect(build).toContain('actions/upload-pages-artifact');
  });

  it('deploys Pages and commits the catalog only from main', () => {
    for (const name of ['pages-deploy', 'catalog-commit']) {
      expect(job(name)).toContain(
        "if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"
      );
    }
    // A manual run limited by `only` or `limit` is a trial build: publishing
    // it would drop every other law from the site and the catalog.
    for (const name of ['pages-deploy', 'catalog-commit']) {
      expect(job(name)).toContain(
        "&& !inputs.only && (inputs.limit || '0') == '0'"
      );
    }
    expect(job('pages-deploy')).toContain('actions/deploy-pages');
    const commit = job('catalog-commit');
    expect(commit).toContain('RELEASE_PR_TOKEN is required');
    expect(commit).toContain('git add data/catalog.lino');
  });
});
