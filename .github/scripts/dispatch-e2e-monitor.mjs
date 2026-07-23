const token = process.env.E2E_DISPATCH_TOKEN;
const tag = process.env.GITHUB_REF_NAME;
if (!token || !tag) throw new Error('E2E_DISPATCH_TOKEN and GITHUB_REF_NAME are required');
const response = await fetch('https://api.github.com/repos/postman-cs/postman-actions-e2e/dispatches', {
  method: 'POST',
  headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
  body: JSON.stringify({ event_type: 'post-release-monitor', client_payload: { action_repository: process.env.GITHUB_REPOSITORY, action_ref: tag, suite: process.env.E2E_GATE_SUITE } })
});
if (!response.ok) throw new Error(`live monitor dispatch failed: HTTP ${response.status}`);
