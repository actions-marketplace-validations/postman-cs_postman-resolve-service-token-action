import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

describe('CI dist build contract', () => {
  it('builds once before fan-out and runs only the read-only dist assertion in parallel', () => {
    expect(ciWorkflow.match(/npm run build/g)).toHaveLength(1);
    expect(ciWorkflow.indexOf('- run: npm run build')).toBeLessThan(ciWorkflow.indexOf('- name: Run gates'));
    expect(ciWorkflow).toContain('run dist       npm run verify:dist:assert');
    expect(ciWorkflow).not.toMatch(/run dist\s+npm run verify:dist(?:\s|$)/);
  });
});
