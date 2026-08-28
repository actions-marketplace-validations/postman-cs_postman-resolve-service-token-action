/**
 * Tier-2 contract tests for resolve-service-token: drive the REAL
 * runResolveServiceToken over an in-memory transport that serves the exact
 * wire shapes the production code parses (mint POST /service-account-tokens,
 * GET /me identity), across the axes real callers vary on: credential shape
 * (PMAK-only mint vs token passthrough), stack/region host routing, and the
 * two live token envelope shapes ({access_token} and {session:{token}}).
 */
import { describe, expect, it } from 'vitest';

import {
  runResolveServiceToken,
  type ResolveDependencies,
  type ResolveInputs
} from '../../src/index.js';

interface FakePlatformOptions {
  host?: string;
  /** Mint response body. Default {access_token}. */
  mintBody?: unknown;
  mintStatus?: number;
  /** /me response body. */
  meBody?: unknown;
  meStatus?: number;
}

function createFakePlatform(options: FakePlatformOptions = {}) {
  const host = options.host ?? 'https://api.getpostman.com';
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const fetcher: ResolveDependencies['fetcher'] = async (url, init) => {
    const call = {
      url: String(url),
      method: String(init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined
    };
    calls.push(call);
    if (call.url === `${host}/service-account-tokens` && call.method === 'POST') {
      return new Response(
        JSON.stringify(options.mintBody ?? { access_token: 'minted-token' }),
        { status: options.mintStatus ?? 201 }
      );
    }
    if (call.url === `${host}/me`) {
      return new Response(
        JSON.stringify(options.meBody ?? { user: { id: 1, teamId: 10490519 } }),
        { status: options.meStatus ?? 200 }
      );
    }
    throw new Error(`Unrouted fetch in resolve contract test: ${call.method} ${call.url}`);
  };
  return { fetcher, calls };
}

function createCore() {
  const outputs: Record<string, string> = {};
  const secrets: string[] = [];
  return {
    outputs,
    secrets,
    core: {
      info: () => {},
      warning: () => {},
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
      setSecret: (value: string) => {
        secrets.push(value);
      }
    }
  };
}

function baseInputs(overrides: Partial<ResolveInputs> = {}): ResolveInputs {
  return {
    postmanApiKey: 'pmak-contract',
    postmanRegion: 'us',
    postmanStack: 'prod',
    writeGithubSecret: false,
    accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
    teamIdSecretName: 'POSTMAN_TEAM_ID',
    ...overrides
  };
}

describe('contract: resolve-service-token credential matrix', () => {
  it('{PMAK-only, prod} mints with the x-api-key envelope and resolves team id from /me with Bearer + x-api-key', async () => {
    const platform = createFakePlatform();
    const harness = createCore();

    const result = await runResolveServiceToken(baseInputs(), {
      core: harness.core,
      fetcher: platform.fetcher
    });

    expect(result).toEqual({ token: 'minted-token', teamId: '10490519', skipped: false });
    expect(platform.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://api.getpostman.com/service-account-tokens',
      'GET https://api.getpostman.com/me'
    ]);
    // Mint wire contract: x-api-key header + {apiKey} JSON body.
    expect(platform.calls[0].headers).toMatchObject({ 'x-api-key': 'pmak-contract' });
    expect(JSON.parse(String(platform.calls[0].body))).toEqual({ apiKey: 'pmak-contract' });
    // /me identity contract: minted token as Bearer, PMAK still attached.
    expect(platform.calls[1].headers).toMatchObject({
      Authorization: 'Bearer minted-token',
      'x-api-key': 'pmak-contract'
    });
    // The minted token is registered with the log scrubber.
    expect(harness.secrets).toContain('minted-token');
    expect(harness.outputs).toMatchObject({ token: 'minted-token', 'team-id': '10490519' });
  });

  it('parses the alternative {session:{token}} mint envelope (live shape parity)', async () => {
    const platform = createFakePlatform({ mintBody: { session: { token: 'session-shaped-token' } } });
    const harness = createCore();

    const result = await runResolveServiceToken(baseInputs(), {
      core: harness.core,
      fetcher: platform.fetcher
    });

    expect(result.token).toBe('session-shaped-token');
  });

  it('{PMAK-only, beta} routes both mint and /me to the beta host', async () => {
    const platform = createFakePlatform({ host: 'https://api.getpostman-beta.com' });
    const harness = createCore();

    const result = await runResolveServiceToken(baseInputs({ postmanStack: 'beta' }), {
      core: harness.core,
      fetcher: platform.fetcher
    });

    expect(result.skipped).toBe(false);
    expect(platform.calls.every((call) => call.url.startsWith('https://api.getpostman-beta.com/'))).toBe(true);
  });

  it('{PMAK-only, prod, eu} routes to the eu host', async () => {
    const platform = createFakePlatform({ host: 'https://api.eu.postman.com' });
    const harness = createCore();

    const result = await runResolveServiceToken(baseInputs({ postmanRegion: 'eu' }), {
      core: harness.core,
      fetcher: platform.fetcher
    });

    expect(result.skipped).toBe(false);
    expect(platform.calls.every((call) => call.url.startsWith('https://api.eu.postman.com/'))).toBe(true);
  });

  it('{token+team-id provided} passes through without any network call', async () => {
    const harness = createCore();
    const result = await runResolveServiceToken(
      baseInputs({ postmanAccessToken: 'provided-token', postmanTeamId: 'team-9' }),
      {
        core: harness.core,
        fetcher: async () => {
          throw new Error('fetch must not be called for passthrough');
        }
      }
    );

    expect(result).toEqual({ token: 'provided-token', teamId: 'team-9', skipped: true });
  });

  it('mint failure surfaces the service-accounts advice without leaking the PMAK', async () => {
    const platform = createFakePlatform({ mintStatus: 400, mintBody: { error: 'service accounts not enabled' } });
    const harness = createCore();

    let thrown: unknown;
    try {
      await runResolveServiceToken(baseInputs(), {
        core: harness.core,
        fetcher: platform.fetcher
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    // The raw HTTP 400 is rewritten into actionable enable-service-accounts advice.
    expect(message).toContain('POST https://api.getpostman.com/service-account-tokens');
    expect(message).toContain('Service accounts are not enabled');
    expect(message).toContain('Team Settings');
    expect(message).not.toContain('pmak-contract');
  });

  it('/me without a resolvable team id fails with the team-id guidance', async () => {
    const platform = createFakePlatform({ meBody: { user: { id: 1 } } });
    const harness = createCore();

    await expect(
      runResolveServiceToken(baseInputs(), {
        core: harness.core,
        fetcher: platform.fetcher
      })
    ).rejects.toThrow(/GET https:\/\/api\.getpostman\.com\/me \(resolve team identity\) response did not include a team id/);
  });
});
