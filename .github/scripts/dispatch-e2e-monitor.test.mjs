import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('dispatch script pins the released ref and smoke suite', () => {
  const script = readFileSync(new URL('./dispatch-e2e-monitor.mjs', import.meta.url), 'utf8');
  assert.match(script, /action_ref: tag/);
  assert.match(script, /post-release-monitor/);
});
