import { pathToFileURL } from 'node:url';

const DISPATCH_TIMEOUT_MS = 10_000;

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 *   abortSignal?: AbortSignal
 * }} [options]
 */
export async function dispatchLiveMonitor({
  fetchImpl = fetch,
  env = process.env,
  abortSignal
} = {}) {
  const token = env.E2E_DISPATCH_TOKEN;
  const tag = env.GITHUB_REF_NAME;
  const repository = env.GITHUB_REPOSITORY;
  const suite = env.E2E_GATE_SUITE;
  if (!token || !tag || !repository || !suite) {
    throw new Error('E2E_DISPATCH_TOKEN, GITHUB_REF_NAME, GITHUB_REPOSITORY, and E2E_GATE_SUITE are required');
  }
  const signal = abortSignal ?? AbortSignal.timeout(DISPATCH_TIMEOUT_MS);
  const response = await fetchImpl('https://api.github.com/repos/postman-cs/postman-actions-e2e/dispatches', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      event_type: 'post-release-monitor',
      client_payload: {
        action_repository: repository,
        action_ref: tag,
        suite
      }
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`live monitor dispatch failed: HTTP ${response.status}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await dispatchLiveMonitor();
}
