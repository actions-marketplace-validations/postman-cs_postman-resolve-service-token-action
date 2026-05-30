import { spawn } from 'node:child_process';

export type PostmanStack = 'prod' | 'beta';

export interface ResolveInputs {
  postmanApiKey?: string;
  postmanAccessToken?: string;
  postmanTeamId?: string;
  postmanStack?: string;
  writeGithubSecret: boolean;
  accessTokenSecretName: string;
  teamIdSecretName: string;
  githubToken?: string;
}

export interface ResolveResult {
  token: string;
  teamId: string;
  skipped: boolean;
}

export interface CoreLike {
  info(message: string): void;
  setOutput(name: string, value: string): void;
  setSecret(value: string): void;
}

export interface ExecFileOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type ExecFile = (file: string, args: string[], options?: ExecFileOptions) => Promise<ExecFileResult>;

export interface ResolveDependencies {
  core: CoreLike;
  fetcher: Fetcher;
  execFile: ExecFile;
  env?: NodeJS.ProcessEnv;
}

export interface ActionInputReader {
  getInput(name: string, options?: { required?: boolean }): string;
}

const DEFAULT_ACCESS_TOKEN_SECRET_NAME = 'POSTMAN_ACCESS_TOKEN';
const DEFAULT_TEAM_ID_SECRET_NAME = 'POSTMAN_TEAM_ID';

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBooleanInput(name: string, value: string | undefined, defaultValue: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value: true or false`);
}

export function resolvePostmanApiHost(stackInput: string | undefined): string {
  const stack = normalizeOptional(stackInput) ?? 'prod';
  if (stack === 'prod') return 'https://api.getpostman.com';
  if (stack === 'beta') return 'https://api.getpostman-beta.com';
  throw new Error(`postman-stack must be one of: prod, beta; got: ${stack}`);
}

export function readInputsFromAction(input: ActionInputReader): ResolveInputs {
  return {
    postmanApiKey: normalizeOptional(input.getInput('postman-api-key')),
    postmanAccessToken: normalizeOptional(input.getInput('postman-access-token')),
    postmanTeamId: normalizeOptional(input.getInput('postman-team-id')),
    postmanStack: normalizeOptional(input.getInput('postman-stack')) ?? 'prod',
    writeGithubSecret: parseBooleanInput('write-github-secret', input.getInput('write-github-secret'), false),
    accessTokenSecretName: normalizeOptional(input.getInput('access-token-secret-name')) ?? DEFAULT_ACCESS_TOKEN_SECRET_NAME,
    teamIdSecretName: normalizeOptional(input.getInput('team-id-secret-name')) ?? DEFAULT_TEAM_ID_SECRET_NAME,
    githubToken: normalizeOptional(input.getInput('github-token'))
  };
}

export function readInputsFromEnv(env: NodeJS.ProcessEnv = process.env): ResolveInputs {
  const getInput = (name: string): string => env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] ?? '';
  return readInputsFromAction({ getInput });
}

function createHeaders(entries: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseJsonBody(body: string, context: string): unknown {
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    throw new Error(`${context} returned non-JSON response`, { cause: error });
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readPath(source: unknown, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    const record = getRecord(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return current;
}

function stringifyCandidate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  const record = getRecord(value);
  if (record) {
    return stringifyCandidate(record.id);
  }
  return undefined;
}

function extractAccessToken(payload: unknown): string | undefined {
  return stringifyCandidate(readPath(payload, ['access_token']))
    ?? stringifyCandidate(readPath(payload, ['session', 'token']));
}

function extractTeamId(payload: unknown): string | undefined {
  const candidates = [
    ['user', 'teamId'],
    ['user', 'team'],
    ['teamId'],
    ['team', 'id'],
    ['team'],
    ['identity', 'team'],
    ['session', 'identity', 'team']
  ];

  for (const path of candidates) {
    const teamId = stringifyCandidate(readPath(payload, path));
    if (teamId) return teamId;
  }
  return undefined;
}

function formatHttpErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return `: ${trimmed}`;
}

async function mintServiceToken(inputs: ResolveInputs, apiHost: string, fetcher: Fetcher): Promise<string> {
  const response = await fetcher(`${apiHost}/service-account-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': inputs.postmanApiKey ?? ''
    },
    body: JSON.stringify({ apiKey: inputs.postmanApiKey })
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`service-account-tokens failed (HTTP ${response.status})${formatHttpErrorBody(body)}`);
  }
  const token = extractAccessToken(parseJsonBody(body, 'service-account-tokens'));
  if (!token) {
    throw new Error('Mint succeeded but no access token in response');
  }
  return token;
}

async function resolveTeamId(inputs: ResolveInputs, apiHost: string, token: string, fetcher: Fetcher): Promise<string> {
  const response = await fetcher(`${apiHost}/me`, {
    headers: createHeaders({
      Authorization: `Bearer ${token}`,
      'x-api-key': inputs.postmanApiKey
    })
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`/me failed (HTTP ${response.status})${formatHttpErrorBody(body)}`);
  }
  const teamId = extractTeamId(parseJsonBody(body, '/me'));
  if (!teamId) {
    throw new Error('Could not read team id from /me response');
  }
  return teamId;
}

async function writeSecret(
  name: string,
  value: string,
  repository: string,
  githubToken: string,
  dependencies: ResolveDependencies
): Promise<void> {
  await dependencies.execFile('gh', ['secret', 'set', name, '--repo', repository], {
    env: {
      ...(dependencies.env ?? process.env),
      GH_TOKEN: githubToken
    },
    input: value
  });
}

async function writeGitHubSecrets(result: ResolveResult, inputs: ResolveInputs, dependencies: ResolveDependencies): Promise<void> {
  const env = dependencies.env ?? process.env;
  const repository = normalizeOptional(env.GITHUB_REPOSITORY);
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required when write-github-secret is true.');
  }
  if (!inputs.githubToken) {
    throw new Error("github-token is required when write-github-secret is 'true'. The default GITHUB_TOKEN cannot write repo secrets; use a PAT or GitHub App installation token with secrets write permission.");
  }

  try {
    await dependencies.execFile('gh', ['--version']);
  } catch (error) {
    throw new Error('gh CLI not found on runner. Use a runner image that includes gh (the default GitHub-hosted runners do), or install it before invoking this action.', { cause: error });
  }

  await writeSecret(inputs.accessTokenSecretName, result.token, repository, inputs.githubToken, dependencies);
  await writeSecret(inputs.teamIdSecretName, result.teamId, repository, inputs.githubToken, dependencies);
  dependencies.core.info(`Wrote secrets: ${inputs.accessTokenSecretName}, ${inputs.teamIdSecretName}`);
}

function validateInputs(inputs: ResolveInputs): void {
  resolvePostmanApiHost(inputs.postmanStack);
  if (!inputs.postmanAccessToken && !inputs.postmanApiKey) {
    throw new Error('postman-api-key is required when postman-access-token is not provided.');
  }
  if (inputs.writeGithubSecret && !inputs.githubToken) {
    throw new Error("github-token is required when write-github-secret is 'true'. The default GITHUB_TOKEN cannot write repo secrets; use a PAT or GitHub App installation token with secrets write permission.");
  }
}

export async function runResolveServiceToken(inputs: ResolveInputs, dependencies: ResolveDependencies): Promise<ResolveResult> {
  validateInputs(inputs);
  const apiHost = resolvePostmanApiHost(inputs.postmanStack);
  const skipped = Boolean(inputs.postmanAccessToken);
  const token = inputs.postmanAccessToken ?? await mintServiceToken(inputs, apiHost, dependencies.fetcher);
  dependencies.core.setSecret(token);
  if (skipped) {
    dependencies.core.info('Skipped mint - using provided postman-access-token.');
  }

  const teamId = inputs.postmanTeamId ?? await resolveTeamId(inputs, apiHost, token, dependencies.fetcher);
  if (inputs.postmanTeamId) {
    dependencies.core.info('Using provided postman-team-id.');
  }

  const result: ResolveResult = { token, teamId, skipped };
  dependencies.core.setOutput('token', result.token);
  dependencies.core.setOutput('team-id', result.teamId);
  dependencies.core.setOutput('skipped', result.skipped ? 'true' : 'false');

  if (inputs.writeGithubSecret) {
    await writeGitHubSecrets(result, inputs, dependencies);
  }

  return result;
}

export function createNodeExecFile(baseEnv: NodeJS.ProcessEnv = process.env): ExecFile {
  return (file, args, options) => new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: options?.env ? { ...baseEnv, ...options.env } : baseEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let interruptedSignal: NodeJS.Signals | undefined;

    const cleanupSignalHandlers = (): void => {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    };
    const handleSignal = (signal: NodeJS.Signals): void => {
      interruptedSignal = signal;
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error) => {
      cleanupSignalHandlers();
      reject(error);
    });
    child.on('close', (code) => {
      cleanupSignalHandlers();
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (interruptedSignal) {
        reject(new Error(`Command interrupted by ${interruptedSignal}: ${file} ${args.join(' ')}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${file} ${args.join(' ')}${stderr ? `\n${stderr}` : ''}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    if (options?.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
