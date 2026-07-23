import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateManifest, validateTagVersion } from '../scripts/verify-release-artifacts.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe('release artifact verifier', () => {
  it('accepts a manifest bound to its expected repository, commit, tag, and bytes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-artifact-'));
    try {
      writeFileSync(join(directory, 'release.tgz'), 'tarball');
      const manifest = {
        schema_version: 1, repository: 'postman-cs/example', commit_sha: 'abc', tag: 'v2.0.4',
        package_name: '@postman-cse/onboarding-resolve-service-token', package_version: '2.0.4',
        artifacts: [{ path: 'release.tgz', sha256: digest('tarball') }]
      };
      expect(() => validateManifest(manifest, directory, { repository: 'postman-cs/example', commitSha: 'abc', tag: 'v2.0.4' })).not.toThrow();
      expect(() => validateManifest({ ...manifest, repository: 'wrong/repo' }, directory, { repository: 'postman-cs/example', commitSha: 'abc', tag: 'v2.0.4' })).toThrow(/repository/);
      expect(() => validateManifest({ ...manifest, commit_sha: 'wrong' }, directory, { repository: 'postman-cs/example', commitSha: 'abc', tag: 'v2.0.4' })).toThrow(/commit_sha/);
      expect(() => validateManifest({ ...manifest, tag: 'v2.0.3' }, directory, { repository: 'postman-cs/example', commitSha: 'abc', tag: 'v2.0.4' })).toThrow(/tag/);
      expect(() => validateManifest({ ...manifest, artifacts: [{ path: 'release.tgz', sha256: digest('wrong') }] }, directory, { repository: 'postman-cs/example', commitSha: 'abc', tag: 'v2.0.4' })).toThrow(/checksum/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('accepts only exact and zero-patch minor publish tags', () => {
    expect(() => validateTagVersion('v2.0.4', '2.0.4')).not.toThrow();
    expect(() => validateTagVersion('v2.1', '2.1.0')).not.toThrow();
    expect(() => validateTagVersion('v2.0', '2.0.4')).toThrow(/does not match/);
  });
});
