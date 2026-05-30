import { describe, expect, test } from 'vitest';

import { runResolveServiceToken, type ResolveDependencies } from '../src/index.js';

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

describe('runResolveServiceToken', () => {
  test('passes through an existing token and team ID without network calls', async () => {
    const harness = createCore();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async () => {
        throw new Error('fetch should not be called');
      },
      execFile: async () => {
        throw new Error('exec should not be called');
      }
    };

    const result = await runResolveServiceToken({
      postmanAccessToken: 'existing-token',
      postmanTeamId: 'team-123',
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, dependencies);

    expect(result).toEqual({
      token: 'existing-token',
      teamId: 'team-123',
      skipped: true
    });
    expect(harness.outputs).toMatchObject({
      token: 'existing-token',
      'team-id': 'team-123',
      skipped: 'true'
    });
    expect(harness.secrets).toEqual(['existing-token']);
  });

  test('mints a token and resolves team ID from prod APIs', async () => {
    const harness = createCore();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response(JSON.stringify({ session: { token: 'minted-token' } }), { status: 201 });
        }
        return new Response(JSON.stringify({ user: { teamId: 'team-456' } }), { status: 200 });
      },
      execFile: async () => {
        throw new Error('exec should not be called');
      }
    };

    const result = await runResolveServiceToken({
      postmanApiKey: 'pmak-service',
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, dependencies);

    expect(result).toEqual({
      token: 'minted-token',
      teamId: 'team-456',
      skipped: false
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.getpostman.com/service-account-tokens',
      'https://api.getpostman.com/me'
    ]);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'pmak-service'
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ apiKey: 'pmak-service' });
    expect(calls[1]?.init?.headers).toMatchObject({
      Authorization: 'Bearer minted-token',
      'x-api-key': 'pmak-service'
    });
    expect(harness.outputs).toMatchObject({
      token: 'minted-token',
      'team-id': 'team-456',
      skipped: 'false'
    });
    expect(harness.secrets).toEqual(['minted-token']);
  });

  test('writes resolved values through gh when secret persistence is enabled', async () => {
    const harness = createCore();
    const execCalls: Array<{ file: string; args: string[]; options?: { env?: NodeJS.ProcessEnv; input?: string } }> = [];
    const dependencies: ResolveDependencies = {
      core: harness.core,
      env: { GITHUB_REPOSITORY: 'postman-cs/example' },
      fetcher: async () => {
        throw new Error('fetch should not be called');
      },
      execFile: async (file, args, options) => {
        execCalls.push({ file, args, options });
        return { stdout: '', stderr: '' };
      }
    };

    await runResolveServiceToken({
      postmanAccessToken: 'existing-token',
      postmanTeamId: 'team-123',
      postmanStack: 'prod',
      writeGithubSecret: true,
      githubToken: 'ghp-token',
      accessTokenSecretName: 'CUSTOM_TOKEN',
      teamIdSecretName: 'CUSTOM_TEAM'
    }, dependencies);

    expect(execCalls).toEqual([
      { file: 'gh', args: ['--version'], options: undefined },
      {
        file: 'gh',
        args: ['secret', 'set', 'CUSTOM_TOKEN', '--repo', 'postman-cs/example'],
        options: { env: expect.objectContaining({ GH_TOKEN: 'ghp-token' }), input: 'existing-token' }
      },
      {
        file: 'gh',
        args: ['secret', 'set', 'CUSTOM_TEAM', '--repo', 'postman-cs/example'],
        options: { env: expect.objectContaining({ GH_TOKEN: 'ghp-token' }), input: 'team-123' }
      }
    ]);
  });

  test('requires a Postman API key when no token is provided', async () => {
    const harness = createCore();

    await expect(runResolveServiceToken({
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, {
      core: harness.core,
      fetcher: fetch,
      execFile: async () => ({ stdout: '', stderr: '' })
    })).rejects.toThrow('postman-api-key is required when postman-access-token is not provided.');
  });
});
