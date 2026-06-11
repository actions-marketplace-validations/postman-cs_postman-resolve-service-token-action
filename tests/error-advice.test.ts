import { beforeEach, describe, expect, test } from 'vitest';

import { runResolveServiceToken, type ResolveDependencies } from '../src/index.js';
import { resolveTokenIdentity, __resetIdentityMemo } from '../src/credential-identity.js';

function createCore() {
  const outputs: Record<string, string> = {};
  const secrets: string[] = [];
  const infos: string[] = [];

  return {
    outputs,
    secrets,
    infos,
    core: {
      info(message: string) {
        infos.push(message);
      },
      setOutput(name: string, value: string) {
        outputs[name] = value;
      },
      setSecret(value: string) {
        secrets.push(value);
      }
    }
  };
}

beforeEach(() => {
  __resetIdentityMemo();
});

describe('mint failure error messages', () => {
  test('mint failure on 403 yields actionable PMAK message', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response('{"error":"Forbidden"}', { status: 403 });
        }
        throw new Error('unexpected fetch');
      },
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    await expect(
      runResolveServiceToken({
        postmanApiKey: 'pmak-test-fake',
        postmanStack: 'prod',
        writeGithubSecret: false,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies)
    ).rejects.toThrow(/The postman-api-key was rejected \(HTTP 403\)/);
  });

  test('mint failure on 401 yields actionable PMAK message', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response('{"error":"Unauthorized"}', { status: 401 });
        }
        throw new Error('unexpected fetch');
      },
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    await expect(
      runResolveServiceToken({
        postmanApiKey: 'pmak-test-fake',
        postmanStack: 'prod',
        writeGithubSecret: false,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies)
    ).rejects.toThrow(/The postman-api-key was rejected \(HTTP 401\)/);
  });

  test('mint failure on 400 service-accounts-disabled yields enablement message', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response('{"error":"service accounts not enabled for this team"}', { status: 400 });
        }
        throw new Error('unexpected fetch');
      },
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    await expect(
      runResolveServiceToken({
        postmanApiKey: 'pmak-test-fake',
        postmanStack: 'prod',
        writeGithubSecret: false,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies)
    ).rejects.toThrow(/Service accounts are not enabled for this team/);
  });

  test('mint failure on 400 without service-accounts keyword keeps generic error', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response('{"error":"bad request"}', { status: 400 });
        }
        throw new Error('unexpected fetch');
      },
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    await expect(
      runResolveServiceToken({
        postmanApiKey: 'pmak-test-fake',
        postmanStack: 'prod',
        writeGithubSecret: false,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies)
    ).rejects.toThrow(/service-account-tokens failed \(HTTP 400\)/);
  });
});

describe('identity echo after successful mint', () => {
  test('mint echoes resolved identity (team id, user) after minting', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response(JSON.stringify({ session: { token: 'minted-token-fake' } }), { status: 201 });
        }
        if (String(url).endsWith('/me')) {
          return new Response(JSON.stringify({
            user: {
              teamId: 'team-789',
              id: 'user-42',
              fullName: 'Test User'
            }
          }), { status: 200 });
        }
        throw new Error('unexpected fetch');
      },
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    await runResolveServiceToken({
      postmanApiKey: 'pmak-test-fake',
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, dependencies);

    const echoLine = harness.infos.find((line) => line.startsWith('resolve-service-token:'));
    expect(echoLine).toBeDefined();
    expect(echoLine).toContain('team-789');
    expect(echoLine).toContain('user-42');
  });

  test('echo line carries no token (masking-safe by construction)', async () => {
    const harness = createCore();
    const mintedToken = 'minted-token-secret-fake';
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response(JSON.stringify({ session: { token: mintedToken } }), { status: 201 });
        }
        if (String(url).endsWith('/me')) {
          return new Response(JSON.stringify({
            user: {
              teamId: 'team-999',
              id: 'user-77',
              fullName: 'Sample Name'
            }
          }), { status: 200 });
        }
        throw new Error('unexpected fetch');
      },
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    await runResolveServiceToken({
      postmanApiKey: 'pmak-test-fake',
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, dependencies);

    const echoLine = harness.infos.find((line) => line.startsWith('resolve-service-token:'));
    expect(echoLine).toBeDefined();
    expect(echoLine).toContain('team-999');
    expect(echoLine).toContain('user-77');

    // Token must not appear in the echo
    expect(echoLine).not.toContain(mintedToken);

    // Style-ban: no dangerous credential prefixes, no em dash, no antithesis shapes
    const allInfos = harness.infos.join('\n');
    expect(allInfos).not.toContain('Bearer ');
    expect(allInfos).not.toContain('x-access-token:');
    expect(allInfos).not.toContain('\u2014'); 
    expect(allInfos).not.toContain(' , not ');
    expect(allInfos).not.toContain(' - not ');
  });
});

describe('style-ban on mint failure messages', () => {
  test('403 mint failure message passes style-ban', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async () => new Response('{}', { status: 403 }),
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    let errorMessage = '';
    try {
      await runResolveServiceToken({
        postmanApiKey: 'pmak-test-fake',
        postmanStack: 'prod',
        writeGithubSecret: false,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).not.toContain('Bearer ');
    expect(errorMessage).not.toContain('x-access-token:');
    expect(errorMessage).not.toContain('\u2014');
    expect(errorMessage).not.toContain(' , not ');
    expect(errorMessage).not.toContain(' - not ');
  });

  test('400 service-accounts-disabled message passes style-ban', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async () => new Response('service accounts not enabled', { status: 400 }),
      execFile: async () => ({ stdout: '', stderr: '' })
    };

    let errorMessage = '';
    try {
      await runResolveServiceToken({
        postmanApiKey: 'pmak-test-fake',
        postmanStack: 'prod',
        writeGithubSecret: false,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).not.toContain('Bearer ');
    expect(errorMessage).not.toContain('x-access-token:');
    expect(errorMessage).not.toContain('\u2014');
    expect(errorMessage).not.toContain(' , not ');
    expect(errorMessage).not.toContain(' - not ');
  });
});

describe('resolveTokenIdentity (credential-identity.ts)', () => {
  test('resolves userId, fullName, teamId from /me response', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      user: {
        teamId: 'team-111',
        id: 'user-22',
        fullName: 'Jane Doe'
      }
    }), { status: 200 });

    const identity = await resolveTokenIdentity('fake-token', 'https://api.getpostman.com', fetcher);
    expect(identity.teamId).toBe('team-111');
    expect(identity.userId).toBe('user-22');
    expect(identity.fullName).toBe('Jane Doe');
  });

  test('returns undefined fields when /me fails', async () => {
    const fetcher = async () => new Response('{}', { status: 500 });

    const identity = await resolveTokenIdentity('fake-token', 'https://api.getpostman.com', fetcher);
    expect(identity.teamId).toBeUndefined();
    expect(identity.userId).toBeUndefined();
    expect(identity.fullName).toBeUndefined();
  });
});
