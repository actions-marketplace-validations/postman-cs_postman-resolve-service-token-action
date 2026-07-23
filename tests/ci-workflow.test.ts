import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const seaPath = join(root, '.github/workflows/sea-binary.yml');
const seaWorkflow = existsSync(seaPath) ? readFileSync(seaPath, 'utf8') : null;
const packagingSource = readFileSync(join(root, 'tests/cli-packaging.test.ts'), 'utf8');
const verifyDistSource = readFileSync(join(root, 'scripts/verify-dist-artifact.mjs'), 'utf8');

/** Extract one top-level job block: `  <id>:` through the next job header or EOF. */
function jobText(workflow: string, jobId: string): string {
  const jobsBody = workflow.match(/^jobs:\n([\s\S]*)$/m)?.[1] ?? '';
  const header = `  ${jobId}:\n`;
  const start = jobsBody.indexOf(header);
  if (start < 0) return '';
  const rest = jobsBody.slice(start + header.length);
  const nextJob = rest.search(/^ {2}[a-zA-Z0-9_-]+:\n/m);
  return header + (nextJob < 0 ? rest : rest.slice(0, nextJob));
}

function namedStep(source: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`      - name: ${escapedName}\\n[\\s\\S]*?(?=\\n      - |\\n?$)`));
  return match?.[0] ?? '';
}

/** Ordered gate names launched via `run <name> ...` (excludes the `run()` helper definition). */
function linuxQueuedGates(runGates: string): string[] {
  return [...runGates.matchAll(/^\s+run ([a-zA-Z0-9_-]+)\s+/gm)].map((m) => m[1]!);
}

const linux = jobText(ciWorkflow, 'gate');
const windows = jobText(ciWorkflow, 'windows');

describe('CI dist build contract', () => {
  it('preserves concurrency, permissions, and independent job names with no needs edges', () => {
    expect(ciWorkflow).toContain(
      'group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}'
    );
    expect(ciWorkflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(ciWorkflow).toMatch(/^permissions:\n {2}contents: read\n/m);

    const jobsSection = ciWorkflow.slice(ciWorkflow.indexOf('\njobs:\n'));
    const jobMatches = jobsSection.match(/^ {2}[a-zA-Z0-9_-]+:$/gm) ?? [];
    expect(jobMatches).toEqual(['  gate:', '  windows:']);
    expect(windows).toContain('name: Windows gate');

    expect(linux).not.toMatch(/^\s*needs:/m);
    expect(windows).not.toMatch(/^\s*needs:/m);
    expect(ciWorkflow).not.toMatch(/^\s*needs:/m);
  });

  it('retains the exact Linux gate inventory with one prequeue bundle and max-two queue', () => {
    expect(linux).toContain('runs-on: ubuntu-latest');
    expect(linux).toContain('contents: read');
    expect(linux).toContain('pull-requests: read');
    expect(linux).toContain('fetch-depth: 0');
    expect(linux.match(/^\s*- run: npm ci\s*$/gm) ?? []).toHaveLength(1);
    expect(linux).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');

    expect(linux.match(/^\s*- run: npm run bundle\s*$/gm) ?? []).toHaveLength(1);
    expect(linux.indexOf('- run: npm run bundle')).toBeLessThan(linux.indexOf('- name: Run gates'));
    expect(ciWorkflow).not.toMatch(/^\s*- run: npm run build\s*$/m);

    const runGates = namedStep(linux, 'Run gates');
    expect(runGates.length).toBeGreaterThan(0);
    expect(runGates).toContain('MAX_PARALLEL_GATES=2');
    expect(runGates).toContain('while [ "${#pid[@]}" -ge "$MAX_PARALLEL_GATES" ]; do finish_one; done');
    expect(runGates).toContain('while [ "${#pid[@]}" -gt 0 ]; do finish_one; done');
    expect(runGates).toContain('wait -n -p finished_pid');

    expect(linuxQueuedGates(runGates)).toEqual([
      'lint',
      'test',
      'typecheck',
      'dist',
      'actionlint',
      'commitlint'
    ]);
    expect(runGates).toContain('run lint       npm run lint');
    expect(runGates).toContain('run test       npm test');
    expect(runGates).toContain('run typecheck  npm run typecheck');
    expect(runGates).toContain('run dist       npm run verify:dist:assert');
    expect(runGates).toContain('run actionlint "$ACTIONLINT_BIN"');
    expect(runGates).toContain('if [ "${{ github.event_name }}" = "pull_request" ]; then');
    expect(runGates).toContain('run commitlint npx commitlint \\');
    expect(runGates).toContain('--from "${{ github.event.pull_request.base.sha }}"');
    expect(runGates).toContain('--to "${{ github.event.pull_request.head.sha }}"');

    expect(runGates).not.toContain('npm run build');
    expect(runGates).not.toContain('npm run bundle');
    expect(runGates).not.toMatch(/npm run verify:dist(?:\s|$|"|')/);
    expect(runGates).not.toContain('npm publish');
    expect(runGates).not.toContain('action-gh-release');
    expect(runGates).not.toContain('git push');
    expect(runGates).toContain('gate:$n=pass');
    expect(runGates).toContain('gate:$n=fail');
    expect(runGates).toContain('::group::$n');
    expect(runGates).toContain('exit $fail');

    const upload = namedStep(linux, 'Upload expected dist on mismatch');
    expect(upload.length).toBeGreaterThan(0);
    expect(upload).toContain('if: failure()');
    expect(upload).toContain('uses: actions/upload-artifact@v7');
    expect(upload).toContain('name: expected-dist');
    expect(upload).toContain('path: dist/');
  });

  it('pins actionlint 1.7.11 into RUNNER_TEMP and never installs Go in the CI gate', () => {
    const install = namedStep(linux, 'Install actionlint');
    expect(install.length).toBeGreaterThan(0);
    expect(install).toContain(
      'https://raw.githubusercontent.com/rhysd/actionlint/393031adb9afb225ee52ae2ccd7a5af5525e03e8/scripts/download-actionlint.bash'
    );
    expect(install).toMatch(/393031adb9afb225ee52ae2ccd7a5af5525e03e8/);
    expect(install.match(/393031adb9afb225ee52ae2ccd7a5af5525e03e8/)?.[0]).toHaveLength(40);
    expect(install).toContain('download-actionlint.bash) 1.7.11 "$RUNNER_TEMP"');
    expect(install).toContain('ACTIONLINT_BIN=$RUNNER_TEMP/actionlint');
    expect(ciWorkflow).not.toContain('/main/scripts/download-actionlint.bash');
    expect(ciWorkflow).not.toContain('/main/scripts');

    expect(ciWorkflow).toContain('download-actionlint.bash) 1.7.11 "$RUNNER_TEMP"');
    expect(ciWorkflow).toContain('ACTIONLINT_BIN=$RUNNER_TEMP/actionlint');
    expect(ciWorkflow).not.toContain('actions/setup-go');
    expect(ciWorkflow).not.toContain('go install github.com/rhysd/actionlint');
    expect(ciWorkflow).not.toMatch(/\bgo install\b/);

    // Origin-shaped release/SEA already dropped Go; assert that when present.
    for (const workflow of [releaseWorkflow, ...(seaWorkflow ? [seaWorkflow] : [])]) {
      if (workflow.includes('download-actionlint.bash) 1.7.11 "$RUNNER_TEMP"')) {
        expect(workflow).toContain('ACTIONLINT_BIN=$RUNNER_TEMP/actionlint');
        expect(workflow).not.toContain('actions/setup-go');
        expect(workflow).not.toContain('go install github.com/rhysd/actionlint');
        expect(workflow).not.toMatch(/\bgo install\b/);
      }
    }
    if (seaWorkflow) {
      expect(seaWorkflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    }
  });

  it('caches Windows node_modules with exact pin, no restore keys, and guarded miss install', () => {
    expect(windows).toContain('name: Windows gate');
    expect(windows).toContain('runs-on: windows-latest');
    expect(windows).not.toMatch(/^\s*fetch-depth:\s*/m);
    expect(windows).not.toContain('fetch-depth: 0');

    expect(windows).toContain("node-version: '24'");
    expect(windows).not.toMatch(/^\s*cache:\s*npm\s*$/m);

    expect(windows).toContain('id: windows-node-modules');
    expect(windows).toContain(
      'uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57 # v4.2.0'
    );
    expect(windows).toContain('path: node_modules');
    expect(windows).toContain("key: Windows/node-24/exact-${{ hashFiles('package-lock.json') }}");
    expect(windows).not.toContain('restore-keys');
    expect(windows).not.toContain('restore-key');

    expect(windows).toContain("if: steps.windows-node-modules.outputs.cache-hit != 'true'");
    expect(windows).toContain('run: npm ci --prefer-offline --no-audit --no-fund');
    expect(windows.match(/npm ci --prefer-offline --no-audit --no-fund/g) ?? []).toHaveLength(1);
    expect(windows.match(/^\s*- run: npm ci\s*$/gm) ?? []).toHaveLength(0);
    expect(windows).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');

    const cacheIdx = windows.indexOf('id: windows-node-modules');
    const missInstallIdx = windows.indexOf('npm ci --prefer-offline --no-audit --no-fund');
    const testIdx = windows.indexOf('- run: npm test');
    expect(cacheIdx).toBeGreaterThanOrEqual(0);
    expect(missInstallIdx).toBeGreaterThan(cacheIdx);
    expect(testIdx).toBeGreaterThan(missInstallIdx);
  });

  it('runs sole direct unconditional npm test on Windows with no queue or platform-neutral gates', () => {
    expect(windows.match(/^\s*- run: npm test\s*$/gm) ?? []).toHaveLength(1);
    expect(windows).not.toMatch(/npm test --/);
    expect(windows).not.toMatch(/npm test -/);

    expect(windows).not.toContain('Run Windows gates');
    expect(windows).not.toContain('name: Run gates');
    expect(windows).not.toContain('shell: pwsh');
    expect(windows).not.toContain('$maxParallel');
    expect(windows).not.toContain('MAX_PARALLEL_GATES');
    expect(windows).not.toContain('Start-Job');
    expect(windows).not.toContain('Wait-Job');
    expect(windows).not.toContain('Receive-Job');
    expect(windows).not.toMatch(/@\{ Name = '/);

    expect(windows).not.toContain('npm run bundle');
    expect(windows).not.toContain('npm run build');
    expect(windows).not.toContain('npm run lint');
    expect(windows).not.toContain('npm run typecheck');
    expect(windows).not.toContain('npm run verify:dist');
    expect(windows).not.toContain('actionlint');
    expect(windows).not.toContain('commitlint');
    expect(windows).not.toContain('Upload expected dist');
    expect(windows).not.toContain('expected-dist');
  });

  it('keeps packaging and dist verifier Windows-viable without Unix-only find or unguarded shebang exec', () => {
    expect(packagingSource).toContain("process.platform === 'win32' ? process.execPath : 'npm'");
    expect(packagingSource).toContain('process.env.npm_execpath');
    expect(packagingSource).toContain("process.platform === 'win32' ? `${binName}.cmd` : binName");
    expect(packagingSource).toContain('function planPackedBinInvocation(');
    expect(packagingSource).toContain('async function runPackedBin(');
    expect(packagingSource).toContain("process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe'");
    expect(packagingSource).toContain("'/d', '/s', '/c'");
    expect(packagingSource).toContain('readdir(sandbox, { recursive: true })');
    expect(packagingSource).not.toMatch(/\bexecFileAsync\(\s*binPath\b/);
    expect(packagingSource).not.toMatch(/\bexecFileAsync\(\s*['"]find['"]/);
    expect(packagingSource).not.toMatch(/\bspawnSync\(\s*['"]find['"]/);
    expect(packagingSource).toMatch(/process\.platform !== 'win32'/);

    expect(verifyDistSource).toContain("if (process.platform === 'win32') return;");
    expect(verifyDistSource).toContain(
      "const command = process.platform === 'win32' ? process.execPath : cliPath;"
    );
    expect(verifyDistSource).toContain(
      "const cliArgs = process.platform === 'win32' ? [cliPath] : [];"
    );
    expect(verifyDistSource).toContain('rmSync(sandbox, { recursive: true, force: true })');
  });
});
