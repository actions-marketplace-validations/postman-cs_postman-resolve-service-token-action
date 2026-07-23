import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const monitorScript = readFileSync(join(process.cwd(), '.github/scripts/dispatch-e2e-monitor.mjs'), 'utf8');

describe('asynchronous e2e monitor dispatch', () => {
  it('pins the released tag without polling for a monitor result', () => {
    expect(monitorScript).toContain('action_ref: tag');
    expect(monitorScript).toContain('post-release-monitor');
    expect(monitorScript).not.toContain('setTimeout');
  });
});
