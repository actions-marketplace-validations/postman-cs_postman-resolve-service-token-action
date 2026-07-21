import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const seaWorkflow = readFileSync(join(process.cwd(), '.github/workflows/sea-binary.yml'), 'utf8');
const seaBuildScript = readFileSync(join(process.cwd(), 'scripts/build-sea.sh'), 'utf8');
const seaProxyScript = readFileSync(join(process.cwd(), 'scripts/assert-sea-proxy.mjs'), 'utf8');
const seaDocs = readFileSync(join(process.cwd(), 'docs/self-contained-binary.md'), 'utf8');

function namedStep(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = releaseWorkflow.match(
    new RegExp(`      - name: ${escapedName}\\n[\\s\\S]*?(?=\\n      - |\\n  [a-zA-Z0-9_-]+:|\\n?$)`)
  );
  return match?.[0] ?? '';
}

function namedJob(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return releaseWorkflow.match(new RegExp(`  ${escapedName}:\n[\\s\\S]*?(?=\n  [a-zA-Z0-9_-]+:|$)`))?.[0] ?? '';
}

function npmRegistrySetupStep(): string {
  return releaseWorkflow
    .match(/ {6}- uses: actions\/setup-node@v\d+\n(?: {8}[^\n]+\n| {10}[^\n]+\n)*/g)
    ?.find((step) => step.includes("registry-url: 'https://registry.npmjs.org'")) ?? '';
}

describe('release workflow publishing contract', () => {
  it('keeps the package major as the rolling alias and major.minor as a zero-patch publish tag', () => {
    expect(releaseWorkflow).toContain('PUBLISH_TAGS=("$PKG_VERSION")');
    expect(releaseWorkflow).toContain('PUBLISH_TAGS+=("$MAJOR.$MINOR")');
    expect(releaseWorkflow).toContain('if [ "$TAG_VERSION" = "$MAJOR" ]; then');
    expect(releaseWorkflow).not.toContain('if [ "$TAG_VERSION" = "0" ]; then');
    expect(releaseWorkflow).toContain('or v$MAJOR');
    expect(releaseWorkflow).toContain('echo "npm_publish=true" >> "$GITHUB_OUTPUT"');
    expect(releaseWorkflow).toContain('echo "npm_publish=false" >> "$GITHUB_OUTPUT"');
    expect(releaseWorkflow).toContain('skipping npm publish');
    expect(releaseWorkflow).toContain('rolling major alias');
    expect(releaseWorkflow).not.toContain('rolling v1 alias');
    expect(releaseWorkflow).not.toContain('ALIAS_TAGS');
    expect(releaseWorkflow).not.toContain('publish_tag');
  });

  it('keeps GitHub release artifacts while making npm publication idempotent', () => {
    expect(namedStep('Publish GitHub release')).not.toMatch(/\n\s+if:/);
    expect(npmRegistrySetupStep()).not.toMatch(/\n\s+if:/);
    expect(namedStep('Check npm package version')).toContain('id: npm_package');
    expect(namedStep('Check npm package version')).toContain('npm view "$PKG_NAME@$PKG_VERSION" version');
    expect(namedStep('Check npm package version')).toContain('already_published=true');
    expect(namedStep('Publish to npm')).toContain("if: needs.validate.outputs.npm_publish == 'true' && steps.npm_package.outputs.already_published != 'true'");
    expect(namedStep('Attach npm tarball to release')).not.toMatch(/\n\s+if:/);
    expect(namedStep('Upload tarball and SEA binary')).not.toMatch(/\n\s+if:/);
  });

  it('builds, smoke-tests, and attaches the self-contained SEA binary on release', () => {
    // Tag pushes do not trigger sea-binary.yml, so the release job must build and
    // execute the binary before any publish/upload, and ship it as a release asset.
    expect(namedStep('Build self-contained SEA binary')).toContain('bash scripts/build-sea.sh');
    const smoke = namedStep('Smoke test SEA binary with an empty environment');
    expect(smoke).toContain('env -i PATH=/nonexistent');
    expect(smoke).toContain('postman-resolve-service-token-${VERSION}-linux-x64');
    expect(smoke).toContain('version not embedded');
    // Hermetic-runtime guard: the smoke must prove ambient NODE_OPTIONS is ignored.
    expect(smoke).toContain("NODE_OPTIONS='--this-flag-does-not-exist'");
    expect(smoke).toContain('honored ambient NODE_OPTIONS');
    const proxySmoke = namedStep('Smoke test SEA proxy routing');
    expect(proxySmoke).toContain('scripts/assert-sea-proxy.mjs');
    expect(proxySmoke).toContain('api.getpostman.com:443');
    expect(seaWorkflow).toContain('scripts/assert-sea-proxy.mjs');
    expect(seaProxyScript).toContain("socket.on('error'");
    expect(namedStep('Upload tarball and SEA binary')).toContain(
      'build/sea/postman-resolve-service-token-*-linux-x64'
    );
    expect(seaBuildScript).toContain('shasum -a 256');
    expect(seaBuildScript).toContain('.sha256');
    expect(seaWorkflow).toContain(
      'build/sea/postman-resolve-service-token-*-linux-x64.sha256'
    );
    expect(namedStep('Upload tarball and SEA binary')).toContain(
      'build/sea/postman-resolve-service-token-*-linux-x64.sha256'
    );
  });

  it('documents proxy activation, complete egress, and checksum verification', () => {
    expect(seaDocs).toContain('NODE_USE_ENV_PROXY=1');
    expect(seaDocs).toContain('api.getpostman-beta.com');
    expect(seaDocs).toContain('events.pm-cse.dev');
    expect(seaDocs).toContain('POSTMAN_ACTIONS_TELEMETRY=off');
    expect(seaDocs).toContain('shasum -a 256 -c');
  });

  it('advances the rolling major alias after an immutable release publishes', () => {
    const aliasJob = namedJob('advance-major-alias');
    expect(aliasJob).toContain('needs:');
    expect(aliasJob).toContain('- validate');
    expect(aliasJob).toContain('- publish');
    expect(aliasJob).toContain(
      "if: ${{ !cancelled() && needs.publish.result == 'success' && needs.validate.outputs.npm_publish == 'true' }}"
    );
    expect(aliasJob).toContain('VERSION="${GITHUB_REF_NAME#v}"');
    expect(aliasJob).toContain('MAJOR="v${VERSION%%.*}"');
    expect(aliasJob).toContain('git tag -fa "$MAJOR"');
    expect(aliasJob).toContain('git push origin "$MAJOR" --force');
  });
});
