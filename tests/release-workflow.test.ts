import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const release = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const sea = readFileSync(join(process.cwd(), '.github/workflows/sea-binary.yml'), 'utf8');
const ci = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

function job(name: string) {
  return release.match(new RegExp(`  ${name}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:|$)`))?.[0] ?? '';
}

describe('release workflow contract', () => {
  it('classifies with the policy helper before install and serializes immutable release work without cancellation', () => {
    expect(release).toContain('group: release-${{ github.repository }}');
    expect(release).toContain('cancel-in-progress: false');
    const classify = job('classify');
    expect(classify).toContain('node scripts/release-policy.mjs classify');
    expect(classify).toContain('release_kind: ${{ steps.release_tag.outputs.release_kind }}');
    expect(classify).toContain('package_version: ${{ steps.release_tag.outputs.package_version }}');
    expect(classify).toContain('npm_publish: ${{ steps.release_tag.outputs.npm_publish }}');
    expect(classify).toContain('actions/checkout@v7');
    expect(classify).toContain('actions/setup-node@v7');
    expect(classify.indexOf('actions/checkout@v7')).toBeLessThan(classify.indexOf('actions/setup-node@v7'));
    expect(classify.indexOf('actions/setup-node@v7')).toBeLessThan(classify.indexOf('release-policy.mjs classify'));
    expect(classify).not.toContain('npm ci');
    expect(job('verify-package')).toContain("if: ${{ needs.classify.outputs.release_kind == 'immutable' }}");
    expect(job('publish')).toContain("needs.classify.outputs.release_kind == 'immutable' && needs.verify-package.result == 'success'");
    expect(job('advance-major-alias')).toContain("needs.classify.outputs.release_kind == 'immutable' && needs.publish.result == 'success'");
    expect(job('dispatch-live-monitor')).toContain("needs.classify.outputs.release_kind == 'immutable' && needs.publish.result == 'success'");
  });

  it('uses unprivileged artifact construction and artifact-only privileged publication', () => {
    const verify = job('verify-package');
    const publish = job('publish');
    expect(verify).toContain('contents: read');
    expect(verify).not.toContain('id-token: write');
    expect(verify).toContain('npm run bundle');
    expect(verify.indexOf('npm run bundle')).toBeLessThan(verify.indexOf('Run gates'));
    expect(verify).toContain('MAX_PARALLEL_GATES=2');
    expect(verify).toContain('run lint npm run lint');
    expect(verify).toContain('run test npm test');
    expect(verify).toContain('run typecheck npm run typecheck');
    expect(verify).toContain('run dist npm run verify:dist:assert');
    expect(verify).toContain('run actionlint "$ACTIONLINT_BIN"');
    expect(verify).toContain('gate:$n=pass');
    expect(verify).toContain('gate:$n=fail');
    expect(verify).not.toContain('npm publish');
    expect(verify).not.toContain('action-gh-release');
    expect(verify).not.toContain('git push');
    expect(verify).toContain('release.tgz');
    expect(verify).toContain('release-manifest.json');
    expect(verify).toContain("const paths = ['release.tgz', sea, `${sea}.sha256`]");
    expect(verify).not.toContain('readdirSync');
    expect(verify).toContain('node scripts/verify-release-artifacts.mjs release-stage');
    expect(verify.indexOf('Verify staged release artifacts')).toBeLessThan(verify.indexOf('upload-artifact@v7'));
    expect(verify).toContain('release-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(verify).toContain('release-stage/release.tgz');
    expect(verify).toContain('release-stage/release-manifest.json');
    expect(verify).toContain('release-stage/postman-resolve-service-token-${{ needs.classify.outputs.package_version }}-linux-x64');
    expect(verify).toContain('release-stage/postman-resolve-service-token-${{ needs.classify.outputs.package_version }}-linux-x64.sha256');
    expect(publish).toContain('contents: write');
    expect(publish).toContain('id-token: write');
    expect(publish).not.toContain('actions/checkout');
    expect(publish).not.toContain('cache: npm');
    expect(publish).not.toContain('npm ci');
    expect(publish).not.toContain('npm run bundle');
    expect(publish).not.toContain('npm test');
    expect(publish).not.toMatch(/^\s*- run: npm pack/m);
    expect(publish).toContain('Verify checksummed release artifacts');
    expect(publish).toContain('exact artifact allowlist mismatch');
    expect(publish).toContain('tarball package identity mismatch');
    expect(publish).toContain('SEA sidecar digest does not match executable and manifest');
    expect(publish.indexOf('Verify checksummed release artifacts')).toBeLessThan(
      publish.indexOf('Publish or verify npm package identity')
    );
    expect(publish).toContain(
      `ACTUAL=$(node -e "const {createHash}=require('node:crypto'); console.log('sha512-'+createHash('sha512').update(require('node:fs').readFileSync('release.tgz')).digest('base64'))")`
    );
    expect(publish).toContain(
      `test "$INTEGRITY" = "$ACTUAL" || { echo '::error::existing npm package integrity differs from staged tarball'; exit 1; }`
    );
    expect(publish.indexOf('Publish or verify npm package identity')).toBeLessThan(
      publish.indexOf('softprops/action-gh-release')
    );
    expect(publish.indexOf("createHash('sha512')")).toBeLessThan(
      publish.indexOf('npm publish ./release.tgz --provenance --access public')
    );
    expect(publish.indexOf('existing npm package integrity differs from staged tarball')).toBeLessThan(
      publish.indexOf('npm publish ./release.tgz --provenance --access public')
    );
    expect(publish.indexOf('npm publish ./release.tgz --provenance --access public')).toBeLessThan(
      publish.indexOf('softprops/action-gh-release')
    );
    expect(publish).toContain('npm view "$PKG_NAME@$PKG_VERSION" dist.integrity');
    expect(release.indexOf('  publish:')).toBeLessThan(release.indexOf('  advance-major-alias:'));
  });

  it('advances aliases from scoped ls-remote identity before force-push without full history fetch', () => {
    expect(job('verify-package')).toContain('scripts/assert-sea-proxy.mjs');
    expect(job('verify-package')).toContain("NODE_OPTIONS='--this-flag-does-not-exist'");
    expect(sea).toContain('scripts/assert-sea-proxy.mjs');
    expect(sea).toContain('.sha256');
    const alias = job('advance-major-alias');
    expect(alias).not.toContain('fetch-depth: 0');
    expect(alias).not.toContain('git for-each-ref');
    expect(alias).not.toContain('objectname:peel');
    expect(alias).not.toContain('git rev-parse');
    expect(alias).toContain('set -euo pipefail');
    expect(alias.indexOf('set -euo pipefail')).toBeLessThan(alias.indexOf('git ls-remote'));
    expect(alias).toContain('git ls-remote --tags origin "$MAJOR" "$MAJOR^{}" "$MAJOR.*"');
    expect(alias).not.toContain('--refs');
    expect(alias).toContain('release-policy.mjs decide-alias');
    expect(alias).toContain('--candidate-version');
    expect(alias).toContain('--major');
    expect(alias.indexOf('git ls-remote')).toBeLessThan(alias.indexOf('git tag -fa'));
    expect(alias.indexOf('decide-alias')).toBeLessThan(alias.indexOf('git tag -fa'));
    expect(alias.indexOf('decide-alias')).toBeLessThan(alias.indexOf('git push origin "$MAJOR" --force'));
    expect(alias).toContain('::notice::$NOTICE');
    expect(alias).not.toContain('sort -V');
  });

  it('uses pinned binary actionlint without Go across release and sibling workflows', () => {
    expect(release).toContain('download-actionlint.bash) 1.7.11 "$RUNNER_TEMP"');
    expect(release).toContain('ACTIONLINT_BIN=$RUNNER_TEMP/actionlint');
    for (const workflow of [release, ci, sea]) {
      expect(workflow).not.toContain('actions/setup-go');
      expect(workflow).not.toContain('go install github.com/rhysd/actionlint');
    }
  });
});
