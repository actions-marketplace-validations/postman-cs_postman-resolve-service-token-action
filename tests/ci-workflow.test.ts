import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
const releaseWorkflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const seaWorkflow = readFileSync(join(process.cwd(), '.github/workflows/sea-binary.yml'), 'utf8');

function linuxGatesBlock(): string {
  return ciWorkflow.slice(ciWorkflow.indexOf('- name: Run gates'), ciWorkflow.indexOf('- name: Upload expected dist on mismatch'));
}

function windowsGatesBlock(): string {
  return ciWorkflow.slice(ciWorkflow.indexOf('name: Run Windows gates'));
}

describe('CI dist build contract', () => {
  it('gates immutable dist on Linux and Windows with one bundle before a max-two queue', () => {
    expect(ciWorkflow.match(/npm run bundle/g)).toHaveLength(2);
    expect(ciWorkflow).not.toContain('- run: npm run build');
    expect(ciWorkflow.match(/npm run typecheck/g)).toHaveLength(2);
    expect(ciWorkflow.indexOf('- run: npm run bundle')).toBeLessThan(ciWorkflow.indexOf('- name: Run gates'));
    expect(ciWorkflow).toContain('MAX_PARALLEL_GATES=2');
    expect(ciWorkflow).toContain('wait -n -p finished_pid');
    expect(ciWorkflow).toContain('name: Windows gate');
    expect(ciWorkflow).toContain('runs-on: windows-latest');
    expect(ciWorkflow).toContain('group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}');
    expect(ciWorkflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(ciWorkflow.indexOf('npm run bundle', ciWorkflow.indexOf('name: Windows gate'))).toBeLessThan(
      ciWorkflow.indexOf('name: Run Windows gates')
    );
    expect(ciWorkflow).toContain('$maxParallel = 2');
    expect(ciWorkflow).toContain('npm run verify:dist:assert');

    const linux = linuxGatesBlock();
    expect(linux).toContain('run lint       npm run lint');
    expect(linux).toContain('run test       npm test');
    expect(linux).toContain('run typecheck  npm run typecheck');
    expect(linux).toContain('run dist       npm run verify:dist:assert');
    expect(linux).toContain('run actionlint "$ACTIONLINT_BIN"');
    expect(linux).toContain('gate:$n=pass');
    expect(linux).toContain('gate:$n=fail');
    expect(linux).not.toContain('npm publish');
    expect(linux).not.toContain('action-gh-release');
    expect(linux).not.toContain('git push');
    expect(ciWorkflow).toContain('fetch-depth: 0');
    expect(ciWorkflow).toContain('run commitlint npx commitlint');
    expect(ciWorkflow).toContain('--from "${{ github.event.pull_request.base.sha }}"');
    expect(ciWorkflow).toContain('--to "${{ github.event.pull_request.head.sha }}"');

    const windows = windowsGatesBlock();
    expect(windows).toContain("Name = 'lint'");
    expect(windows).toContain("Name = 'test'");
    expect(windows).toContain("Name = 'typecheck'");
    expect(windows).toContain("Name = 'dist'");
    expect(windows).toContain('npm run verify:dist:assert');
    expect(windows).toContain("gate:$($_.Name)=$($(if ($_.State -eq 'Completed') { 'pass' } else { 'fail' }))");
  });

  it('pins actionlint 1.7.11 into RUNNER_TEMP and never installs Go across CI, release, and SEA', () => {
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
});
