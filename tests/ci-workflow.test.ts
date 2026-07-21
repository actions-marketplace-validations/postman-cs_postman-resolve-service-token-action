import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

describe('CI dist build contract', () => {
  it('gates immutable dist on Linux and Windows', () => {
    expect(ciWorkflow.match(/npm run bundle/g)).toHaveLength(2);
    expect(ciWorkflow).not.toContain('- run: npm run build');
    expect(ciWorkflow.match(/npm run typecheck/g)).toHaveLength(2);
    expect(ciWorkflow.indexOf('- run: npm run bundle')).toBeLessThan(ciWorkflow.indexOf('- name: Run gates'));
    expect(ciWorkflow).toContain('run dist       npm run verify:dist:assert');
    expect(ciWorkflow).not.toMatch(/run dist\s+npm run verify:dist(?:\s|$)/);
    expect(ciWorkflow).toContain('MAX_PARALLEL_GATES=2');
    expect(ciWorkflow).toContain('wait -n -p finished_pid');
    expect(ciWorkflow).toContain('name: Windows gate');
    expect(ciWorkflow).toContain('runs-on: windows-latest');
  });
});
