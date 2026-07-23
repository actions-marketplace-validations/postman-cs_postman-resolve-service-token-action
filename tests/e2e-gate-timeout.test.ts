import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const monitorScript = readFileSync(join(process.cwd(), '.github/scripts/dispatch-e2e-monitor.mjs'), 'utf8');

describe('asynchronous e2e monitor dispatch', () => {
  it('pins the released tag with an explicit abort deadline and without polling', () => {
    expect(monitorScript).toContain('action_ref: tag');
    expect(monitorScript).toContain('post-release-monitor');
    expect(monitorScript).toContain('AbortSignal.timeout');
    expect(monitorScript).toContain('10_000');
    expect(monitorScript).not.toContain('wait-for-e2e-gate');
    expect(monitorScript).not.toContain('setInterval');
  });
});
