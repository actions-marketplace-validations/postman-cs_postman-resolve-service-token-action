import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const seaWorkflow = readFileSync(join(root, '.github/workflows/sea-binary.yml'), 'utf8');
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
    expect(runGates).toContain('run dist       node scripts/verify-dist-artifact.mjs');
    expect(runGates).toContain('run actionlint "$ACTIONLINT_BIN"');
    expect(runGates).toContain('if [ "${{ github.event_name }}" = "pull_request" ]; then');
    expect(runGates).toContain('run commitlint npx commitlint \\');
    expect(runGates).toContain('--from "${{ github.event.pull_request.base.sha }}"');
    expect(runGates).toContain('--to "${{ github.event.pull_request.head.sha }}"');

    expect(runGates).not.toContain('npm run build');
    expect(runGates).not.toContain('npm run bundle');
    expect(ciWorkflow).not.toContain('verify:dist');
    expect(runGates).not.toContain('npm publish');
    expect(runGates).not.toContain('action-gh-release');
    expect(runGates).not.toContain('git push');
    expect(runGates).toContain('gate:$n=pass');
    expect(runGates).toContain('gate:$n=fail');
    expect(runGates).toContain('::group::$n');
    expect(runGates).toContain('exit $fail');

    expect(ciWorkflow).not.toContain('expected-dist');
  });

  it('pins actionlint 1.7.11 into RUNNER_TEMP and never installs Go across CI, release, and SEA', () => {
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

    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow).toContain('download-actionlint.bash) 1.7.11 "$RUNNER_TEMP"');
      expect(workflow).toContain('ACTIONLINT_BIN=$RUNNER_TEMP/actionlint');
    }
    for (const workflow of [ciWorkflow, releaseWorkflow, seaWorkflow]) {
      expect(workflow).not.toContain('actions/setup-go');
      expect(workflow).not.toContain('go install github.com/rhysd/actionlint');
      expect(workflow).not.toContain('go install');
    }
    expect(seaWorkflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('caches Windows node_modules with exact pin, no restore keys, and guarded miss install', () => {
    expect(windows).toContain('name: Windows gate');
    expect(windows).toContain('runs-on: windows-latest');
    expect(windows).not.toMatch(/^\s*fetch-depth:\s*/m);
    expect(windows).not.toContain('fetch-depth: 0');

    expect(windows).toContain("node-version: '24'");
    expect(windows).not.toMatch(/^\s*cache:\s*npm\s*$/m);

    expect(windows).toContain('id: windows-node-modules');
    // Semantic pin: any 40-char hex SHA, consistent across file, with semver comment
    {
      const cachePins = [...ciWorkflow.matchAll(/actions\/cache@([0-9a-f]{40})/g)].map((m) => m[1]!);
      expect(cachePins.length).toBeGreaterThanOrEqual(1);
      for (const sha of cachePins) expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(new Set(cachePins).size).toBe(1);
      expect(windows).toMatch(/uses:\s*actions\/cache@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+/);
    }
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
    const testIdx = windows.indexOf('- run: node --run test');
    expect(cacheIdx).toBeGreaterThanOrEqual(0);
    expect(missInstallIdx).toBeGreaterThan(cacheIdx);
    expect(testIdx).toBeGreaterThan(missInstallIdx);
  });

  it('runs sole direct unconditional node test on Windows with no queue or platform-neutral gates', () => {
    expect(windows.match(/^\s*- run: node --run test\s*$/gm) ?? []).toHaveLength(1);
    expect(windows.match(/^\s*- run: npm test\s*$/gm) ?? []).toHaveLength(0);

    expect(windows).not.toContain('Run Windows gates');
    expect(windows).not.toContain('name: Run gates');
    expect(windows).not.toContain('shell: pwsh');
    expect(windows).not.toContain('$maxParallel');
    expect(windows).not.toContain('MAX_PARALLEL_GATES');
    expect(windows).not.toContain('Start-Job');
    expect(windows).not.toContain('Wait-Job');
    expect(windows).not.toContain('Receive-Job');
    expect(windows).not.toMatch(/@\{ Name = '/);

    // dist-off-main: Windows rebuilds once for OS-runtime suite; release consumes tag bytes.
    expect(windows.match(/^\s*- run: npm run bundle\s*$/gm) ?? []).toHaveLength(1);
    expect(windows.indexOf('- run: npm run bundle')).toBeLessThan(
      windows.indexOf('- run: node --run test')
    );
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
    expect(packagingSource).toContain('const env = options?.env ?? process.env;');
    expect(packagingSource).toContain("const comSpec = env.ComSpec ?? env.COMSPEC ?? 'cmd.exe';");
    expect(packagingSource).toContain("'/d', '/s', '/c'");
    expect(packagingSource).toContain('`"${commandPayload}"`');
    expect(packagingSource).toContain('windowsVerbatimArguments: true');
    expect(packagingSource).toContain('planPackedBinInvocation(binPath, args, { env: options.env })');
    expect(packagingSource).toContain('readdir(sandbox, { recursive: true })');
    expect(packagingSource).not.toMatch(/\bexecFileAsync\(\s*binPath\b/);
    expect(packagingSource).not.toMatch(/\bexecFileAsync\(\s*['"]find['"]/);
    expect(packagingSource).not.toMatch(/\bspawnSync\(\s*['"]find['"]/);
    expect(packagingSource).not.toMatch(/\bshell:\s*true\b/);
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
