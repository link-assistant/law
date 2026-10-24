import { describe, it, expect } from 'test-anywhere';
import { dependencyReviewAvailable } from '../scripts/dependency-capability.mjs';

describe('dependency review capability', () => {
  it('uses the review API when it is available', () => {
    expect(dependencyReviewAvailable({ ok: true, status: 200 }, 'push')).toBe(
      true
    );
  });

  it('falls back to lock audits on pull requests without Dependency graph', () => {
    for (const status of [403, 404]) {
      expect(
        dependencyReviewAvailable({ ok: false, status }, 'pull_request')
      ).toBe(false);
    }
  });

  it('fails default-branch runs with the setting a maintainer must enable', () => {
    expect(() =>
      dependencyReviewAvailable({ ok: false, status: 403 }, 'push')
    ).toThrow(/Enable Dependency graph/);
  });

  it('fails closed on unexpected API errors', () => {
    expect(() =>
      dependencyReviewAvailable({ ok: false, status: 500 }, 'pull_request')
    ).toThrow(/HTTP 500/);
  });
});
