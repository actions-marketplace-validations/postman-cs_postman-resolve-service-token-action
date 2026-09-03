import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const seaBuild = readFileSync(join(process.cwd(), 'scripts/build-sea.sh'), 'utf8');
const seaWorkflow = readFileSync(join(process.cwd(), '.github/workflows/sea-binary.yml'), 'utf8');
const releaseWorkflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

describe('SEA build contract', () => {
  it('bounds both Node runtime downloads and builds exactly one SEA binary', () => {
    const curlDownloads = seaBuild.match(/curl -fsSL --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 2/g) ?? [];
    expect(curlDownloads).toHaveLength(2);
    expect(seaBuild).toContain('NODE_VERSION="24.18.0"');
    expect(seaBuild).toContain('shasum -a 256 -c');
    expect(seaBuild.match(/postject/g)?.length).toBeGreaterThanOrEqual(1);
    expect(seaBuild.match(/--experimental-sea-config sea-config\.json/g)).toHaveLength(1);
    expect(seaBuild).toContain('.sha256');
  });

  it('keeps empty-env, exact --version, NODE_OPTIONS hardening, proxy smoke, and artifact upload observables', () => {
    expect(seaWorkflow).toContain('env -i PATH=/nonexistent');
    expect(seaWorkflow).toContain('is missing or invalid|is required');
    expect(seaWorkflow).toContain('"$ver" != "$VERSION"');
    expect(seaWorkflow).toContain("NODE_OPTIONS='--this-flag-does-not-exist'");
    expect(seaWorkflow).toContain('scripts/assert-sea-proxy.mjs');
    expect(seaWorkflow).toContain('build/sea/postman-resolve-service-token-*-linux-x64');
    expect(seaWorkflow).toContain('build/sea/postman-resolve-service-token-*-linux-x64.sha256');
    expect(seaWorkflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(releaseWorkflow).toContain('scripts/assert-sea-proxy.mjs');
    expect(releaseWorkflow).toContain("NODE_OPTIONS='--this-flag-does-not-exist'");
  });
});
