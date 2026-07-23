import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchLiveMonitor } from './dispatch-e2e-monitor.mjs';

const baseEnv = {
  E2E_DISPATCH_TOKEN: 'test-token',
  GITHUB_REF_NAME: 'v2.0.4',
  GITHUB_REPOSITORY: 'postman-cs/postman-resolve-service-token-action',
  E2E_GATE_SUITE: 'smoke'
};

test('dispatchLiveMonitor posts the immutable action_ref and smoke suite payload', async () => {
  /** @type {RequestInit|undefined} */
  let init;
  const fetchImpl = async (_url, options) => {
    init = options;
    return { ok: true, status: 204 };
  };
  await dispatchLiveMonitor({ fetchImpl, env: baseEnv });
  assert.ok(init?.signal, 'bounded AbortSignal must be supplied');
  assert.equal(init?.method, 'POST');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.event_type, 'post-release-monitor');
  assert.deepEqual(body.client_payload, {
    action_repository: baseEnv.GITHUB_REPOSITORY,
    action_ref: 'v2.0.4',
    suite: 'smoke'
  });
  assert.match(String(init?.headers?.Authorization), /Bearer test-token/);
});

test('dispatchLiveMonitor rejects missing required env without leaking a token', async () => {
  await assert.rejects(
    () => dispatchLiveMonitor({ fetchImpl: async () => ({ ok: true, status: 204 }), env: { E2E_DISPATCH_TOKEN: 'secret-token' } }),
    (error) => {
      assert.match(String(error.message), /E2E_DISPATCH_TOKEN, GITHUB_REF_NAME, GITHUB_REPOSITORY, and E2E_GATE_SUITE are required/);
      assert.doesNotMatch(String(error.message), /secret-token/);
      return true;
    }
  );
});

test('dispatchLiveMonitor throws status-only errors on non-2xx responses', async () => {
  await assert.rejects(
    () => dispatchLiveMonitor({
      fetchImpl: async () => ({ ok: false, status: 502 }),
      env: baseEnv
    }),
    (error) => {
      assert.equal(String(error.message), 'live monitor dispatch failed: HTTP 502');
      assert.doesNotMatch(String(error.message), /test-token/);
      return true;
    }
  );
});

test('dispatchLiveMonitor accepts an explicit abort deadline', async () => {
  const controller = new AbortController();
  /** @type {AbortSignal|undefined} */
  let seen;
  await dispatchLiveMonitor({
    fetchImpl: async (_url, options) => {
      seen = options?.signal;
      return { ok: true, status: 204 };
    },
    env: baseEnv,
    abortSignal: controller.signal
  });
  assert.equal(seen, controller.signal);
});
