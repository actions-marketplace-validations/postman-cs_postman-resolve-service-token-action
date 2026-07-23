import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const release = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const sea = readFileSync(join(process.cwd(), '.github/workflows/sea-binary.yml'), 'utf8');

function job(name: string) {
  return release.match(new RegExp(`  ${name}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:|$)`))?.[0] ?? '';
}

describe('release workflow contract', () => {
  it('classifies before install and serializes immutable release work without cancellation', () => {
    expect(release).toContain('group: release-${{ github.repository }}');
    expect(release).toContain('cancel-in-progress: false');
    const classify = job('classify');
    expect(classify).toContain('release_kind=immutable');
    expect(classify).toContain('release_kind=alias');
    expect(classify).toContain('Release workflow must run from an accepted immutable tag');
    expect(classify).not.toContain('npm ci');
    expect(job('verify-package')).toContain("if: ${{ needs.classify.outputs.release_kind == 'immutable' }}");
  });

  it('uses unprivileged artifact construction and artifact-only privileged publication', () => {
    const verify = job('verify-package');
    const publish = job('publish');
    expect(verify).toContain('contents: read');
    expect(verify).not.toContain('id-token: write');
    expect(verify).toContain('npm run bundle');
    expect(verify).toContain('MAX_PARALLEL_GATES=2');
    expect(verify).toContain('npm run verify:dist:assert');
    expect(verify).toContain('release.tgz');
    expect(verify).toContain('release-manifest.json');
    expect(verify).toContain('${{ github.run_id }}-${{ github.run_attempt }}');
    expect(publish).toContain('contents: write');
    expect(publish).toContain('id-token: write');
    expect(publish).not.toContain('actions/checkout');
    expect(publish).not.toContain('npm ci');
    expect(publish).not.toMatch(/^\s*- run: npm pack/m);
    expect(publish).toContain('Verify checksummed release artifacts');
    expect(publish).toContain('tarball package identity mismatch');
    expect(publish.indexOf('npm publish ./release.tgz --provenance --access public')).toBeLessThan(
      publish.indexOf('softprops/action-gh-release')
    );
    expect(publish).toContain('npm view "$PKG_NAME@$PKG_VERSION" dist.integrity');
  });

  it('preserves SEA smoke/checksum and advances aliases monotonically', () => {
    expect(job('verify-package')).toContain('scripts/assert-sea-proxy.mjs');
    expect(job('verify-package')).toContain("NODE_OPTIONS='--this-flag-does-not-exist'");
    expect(sea).toContain('scripts/assert-sea-proxy.mjs');
    expect(sea).toContain('.sha256');
    const alias = job('advance-major-alias');
    expect(alias).toContain('sort -V');
    expect(alias).toContain('not advancing');
    expect(alias).toContain('git push origin "$MAJOR" --force');
  });

  it('uses pinned binary actionlint without Go', () => {
    expect(release).toContain('download-actionlint.bash) 1.7.11 "$RUNNER_TEMP"');
    expect(release).toContain('ACTIONLINT_BIN=$RUNNER_TEMP/actionlint');
    expect(release).not.toContain('actions/setup-go');
    expect(release).not.toContain('go install github.com/rhysd/actionlint');
  });
});
