import { describe, expect, test } from 'vitest';

import {
  createNodeExecFile,
  runResolveServiceToken,
  type ResolveDependencies
} from '../src/index.js';

function expectNoTerminalControls(text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isControl = code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    expect(isControl, `unexpected control U+${code.toString(16)} at ${i}`).toBe(false);
  }
}

function createCore() {
  const outputs: Record<string, string> = {};
  const secrets: string[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];

  return {
    outputs,
    secrets,
    infos,
    warnings,
    core: {
      info(message: string) {
        infos.push(message);
      },
      warning(message: string) {
        warnings.push(message);
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
    const rawTeamId = 'team-123\r\nextra';
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
      postmanTeamId: rawTeamId,
      postmanRegion: 'us',
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, dependencies);

    expect(result).toEqual({
      token: 'existing-token',
      teamId: rawTeamId,
      skipped: true
    });
    expect(harness.outputs).toMatchObject({
      token: 'existing-token',
      'team-id': rawTeamId,
      skipped: 'true'
    });
    expect(harness.secrets).toEqual(['existing-token']);
    expect(harness.warnings).toEqual([
      'Using a provided postman-access-token. Prefer minting a fresh service-account token with postman-api-key unless this workflow intentionally manages token rotation outside this action.'
    ]);
    const providedTeamInfo = harness.infos.find((line) => line.startsWith('Using provided postman-team-id'));
    expect(providedTeamInfo).toBe('Using provided postman-team-id team-123 extra.');
    expect(providedTeamInfo).not.toContain('\n');
    expect(providedTeamInfo).not.toContain('\r');
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
      postmanRegion: 'us',
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
    const rawAccessSecret = 'CUSTOM_TOKEN\r\nlabel';
    const rawTeamSecret = 'CUSTOM_TEAM\nlabel';
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
      postmanRegion: 'us',
      postmanStack: 'prod',
      writeGithubSecret: true,
      githubToken: 'ghp-token',
      accessTokenSecretName: rawAccessSecret,
      teamIdSecretName: rawTeamSecret
    }, dependencies);

    expect(execCalls).toEqual([
      { file: 'gh', args: ['--version'], options: undefined },
      {
        file: 'gh',
        args: ['secret', 'set', rawAccessSecret, '--repo', 'postman-cs/example'],
        options: { env: expect.objectContaining({ GH_TOKEN: 'ghp-token' }), input: 'existing-token' }
      },
      {
        file: 'gh',
        args: ['secret', 'set', rawTeamSecret, '--repo', 'postman-cs/example'],
        options: { env: expect.objectContaining({ GH_TOKEN: 'ghp-token' }), input: 'team-123' }
      }
    ]);
    const wroteInfo = harness.infos.find((line) => line.startsWith('Wrote secrets:'));
    expect(wroteInfo).toBe('Wrote secrets: CUSTOM_TOKEN label, CUSTOM_TEAM label');
    expect(wroteInfo).not.toContain('\n');
    expect(wroteInfo).not.toContain('\r');
  });

  test('gh probe failure includes safe cause and installation remediation', async () => {
    const harness = createCore();
    const ghToken = 'ghp-PROBE-SECRET';
    const accessToken = 'existing-token-PROBE';
    const dependencies: ResolveDependencies = {
      core: harness.core,
      env: { GITHUB_REPOSITORY: 'postman-cs/example' },
      fetcher: async () => {
        throw new Error('fetch should not be called');
      },
      execFile: async () => {
        throw new Error(`spawn gh ENOENT\npath detail with ${ghToken}`);
      }
    };

    let errorMessage = '';
    try {
      await runResolveServiceToken({
        postmanAccessToken: accessToken,
        postmanTeamId: 'team-123',
        writeGithubSecret: true,
        githubToken: ghToken,
        accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
        teamIdSecretName: 'POSTMAN_TEAM_ID'
      }, dependencies);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('gh CLI not found on runner');
    expect(errorMessage).toContain('ENOENT');
    expect(errorMessage).toMatch(/install it before invoking|GitHub-hosted runners/);
    expect(errorMessage).not.toContain('\n');
    expect(errorMessage).not.toContain(ghToken);
    expect(errorMessage).not.toContain(accessToken);
  });

  test('first secret write failure names repository, secret, cause, and secrets-write remediation', async () => {
    const harness = createCore();
    const ghToken = 'ghp-FIRST-WRITE-SECRET';
    const accessToken = 'existing-token-FIRST';
    const rawRepo = 'postman-cs/example\r\nextra\u001b[31m';
    const rawAccessSecret = 'CUSTOM_TOKEN\nlabel\u0007';
    const execCalls: string[][] = [];
    let call = 0;
    const dependencies: ResolveDependencies = {
      core: harness.core,
      env: { GITHUB_REPOSITORY: rawRepo },
      fetcher: async () => {
        throw new Error('fetch should not be called');
      },
      execFile: async (_file, args) => {
        execCalls.push(args);
        call += 1;
        if (call === 1) return { stdout: '', stderr: '' };
        throw new Error(`HTTP 403: Resource not accessible by integration\n${ghToken}\u001b[0m`);
      }
    };

    let errorMessage = '';
    try {
      await runResolveServiceToken({
        postmanAccessToken: accessToken,
        postmanTeamId: 'team-123',
        writeGithubSecret: true,
        githubToken: ghToken,
        accessTokenSecretName: rawAccessSecret,
        teamIdSecretName: 'CUSTOM_TEAM'
      }, dependencies);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(execCalls).toEqual([
      ['--version'],
      ['secret', 'set', rawAccessSecret, '--repo', rawRepo]
    ]);
    expect(errorMessage).toContain('Failed to write GitHub secret CUSTOM_TOKEN label');
    expect(errorMessage).toContain('postman-cs/example extra');
    expect(errorMessage).toContain('HTTP 403');
    expect(errorMessage).toMatch(/secrets-write/);
    expectNoTerminalControls(errorMessage);
    expect(errorMessage).not.toContain(ghToken);
    expect(errorMessage).not.toContain(accessToken);
    expect(errorMessage).not.toContain('Partial success');
  });

  test('createNodeExecFile bounds retained child output while draining streams', async () => {
    const execFile = createNodeExecFile();
    const overCap = 8 * 1024 + 4096;
    const harness = createCore();
    // Markers are constructed at runtime so they do not appear as literals in argv.
    const headMarker = ['STREAM', 'HEAD'].join('-');
    const tailMarker = ['STREAM', 'TAIL'].join('-');

    let failMessage = '';
    try {
      await execFile(process.execPath, [
        '-e',
        [
          "const head=['STREAM','HEAD'].join('-');",
          "const tail=['STREAM','TAIL'].join('-');",
          'process.stderr.write(head);',
          "process.stderr.write('\\u001b[31m');",
          `process.stderr.write('x'.repeat(${overCap}));`,
          'process.stderr.write(tail);',
          'process.exit(2);'
        ].join('')
      ]);
    } catch (error) {
      failMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failMessage).toContain(headMarker);
    expect(failMessage).toContain('[truncated]');
    expect(failMessage).not.toContain(tailMarker);
    expect(Buffer.byteLength(failMessage)).toBeLessThanOrEqual(
      'Command failed with exit code 2: '.length + 8 * 1024 + '...[truncated]'.length
    );

    const success = await execFile(process.execPath, [
      '-e',
      [
        "const head=['STREAM','HEAD'].join('-');",
        "const tail=['STREAM','TAIL'].join('-');",
        'process.stdout.write(head);',
        `process.stdout.write('y'.repeat(${overCap}));`,
        'process.stdout.write(tail);'
      ].join('')
    ]);
    expect(success.stdout).toContain(headMarker);
    expect(success.stdout).toContain('[truncated]');
    expect(success.stdout).not.toContain(tailMarker);
    expect(Buffer.byteLength(success.stdout)).toBeLessThanOrEqual(8 * 1024 + '...[truncated]'.length);

    // Operator-facing path: real createNodeExecFile failure is sanitized to one safe line.
    const operatorExec = createNodeExecFile();
    const dependencies: ResolveDependencies = {
      core: harness.core,
      env: { GITHUB_REPOSITORY: 'postman-cs/example' },
      fetcher: async () => {
        throw new Error('fetch should not be called');
      },
      execFile: async (_file, args, options) => {
        if (args[0] === '--version') return { stdout: '', stderr: '' };
        return operatorExec(
          process.execPath,
          [
            '-e',
            [
              "const head=['STREAM','HEAD'].join('-');",
              "const tail=['STREAM','TAIL'].join('-');",
              "process.stderr.write(head + '\\u001b[31m');",
              `process.stderr.write('z'.repeat(${overCap}));`,
              'process.stderr.write(tail);',
              'process.exit(1);'
            ].join('')
          ],
          options
        );
      }
    };

    let operatorMessage = '';
    try {
      await runResolveServiceToken({
        postmanAccessToken: 'existing-token-BOUND',
        postmanTeamId: 'team-123',
        writeGithubSecret: true,
        githubToken: 'ghp-BOUND-SECRET',
        accessTokenSecretName: 'CUSTOM_TOKEN',
        teamIdSecretName: 'CUSTOM_TEAM'
      }, dependencies);
    } catch (error) {
      operatorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(operatorMessage).toContain('Failed to write GitHub secret CUSTOM_TOKEN');
    expect(operatorMessage).toContain(headMarker);
    expect(operatorMessage).toContain('Command failed');
    // Raw exec path above asserts the retention truncation marker; here the 200-char
    // diagnostic cause window keeps the head marker and drops the over-cap tail.
    expect(operatorMessage).not.toContain(tailMarker);
    expect(operatorMessage).toMatch(/secrets-write/);
    expectNoTerminalControls(operatorMessage);
    expect(operatorMessage).not.toContain('ghp-BOUND-SECRET');
    expect(operatorMessage).not.toContain('existing-token-BOUND');
  });

  test('second secret write failure reports partial success without leaking token values', async () => {
    const harness = createCore();
    const ghToken = 'ghp-SECOND-WRITE-SECRET';
    const accessToken = 'existing-token-SECOND';
    const execCalls: string[][] = [];
    const dependencies: ResolveDependencies = {
      core: harness.core,
      env: { GITHUB_REPOSITORY: 'postman-cs/example' },
      fetcher: async () => {
        throw new Error('fetch should not be called');
      },
      execFile: async (_file, args) => {
        execCalls.push(args);
        if (args[0] === '--version') return { stdout: '', stderr: '' };
        if (args.includes('CUSTOM_TOKEN')) return { stdout: '', stderr: '' };
        throw new Error(`HTTP 403: denied writing team secret\nleak ${ghToken} ${accessToken}`);
      }
    };

    let errorMessage = '';
    try {
      await runResolveServiceToken({
        postmanAccessToken: accessToken,
        postmanTeamId: 'team-123',
        writeGithubSecret: true,
        githubToken: ghToken,
        accessTokenSecretName: 'CUSTOM_TOKEN',
        teamIdSecretName: 'CUSTOM_TEAM'
      }, dependencies);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(execCalls).toEqual([
      ['--version'],
      ['secret', 'set', 'CUSTOM_TOKEN', '--repo', 'postman-cs/example'],
      ['secret', 'set', 'CUSTOM_TEAM', '--repo', 'postman-cs/example']
    ]);
    expect(errorMessage).toContain('Partial success');
    expect(errorMessage).toContain('CUSTOM_TOKEN');
    expect(errorMessage).toContain('CUSTOM_TEAM');
    expect(errorMessage).toContain('postman-cs/example');
    expect(errorMessage).toContain('HTTP 403');
    expect(errorMessage).toMatch(/secrets-write|reconcile|rotate/);
    expect(errorMessage).not.toContain('\n');
    expect(errorMessage).not.toContain(ghToken);
    expect(errorMessage).not.toContain(accessToken);
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

  test('uses the EU Postman API host when postman-region is eu', async () => {
    const harness = createCore();
    const calls: string[] = [];
    const dependencies: ResolveDependencies = {
      core: harness.core,
      fetcher: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith('/service-account-tokens')) {
          return new Response(JSON.stringify({ session: { token: 'minted-token' } }), { status: 201 });
        }
        return new Response(JSON.stringify({ user: { teamId: 'team-eu' } }), { status: 200 });
      },
      execFile: async () => {
        throw new Error('exec should not be called');
      }
    };

    await runResolveServiceToken({
      postmanApiKey: 'pmak-service',
      postmanRegion: 'eu',
      postmanStack: 'prod',
      writeGithubSecret: false,
      accessTokenSecretName: 'POSTMAN_ACCESS_TOKEN',
      teamIdSecretName: 'POSTMAN_TEAM_ID'
    }, dependencies);

    expect(calls).toEqual([
      'https://api.eu.postman.com/service-account-tokens',
      'https://api.eu.postman.com/me'
    ]);
  });
});
