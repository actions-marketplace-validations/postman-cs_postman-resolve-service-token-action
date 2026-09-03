import type { Fetcher } from './index.js';

export type PmakDiagnosticKind = 'personal' | 'service-account' | 'invalid' | 'inconclusive';

export interface PmakDiagnosticResult {
  kind: PmakDiagnosticKind;
  status?: number;
  payload?: Record<string, unknown>;
}

export interface InspectPmakIdentityOptions {
  apiBaseUrl: string;
  apiKey: string;
  fetchImpl?: Fetcher;
  timeoutMs?: number;
  signal?: AbortSignal;
  mode?: 'diagnostic' | 'preflight';
}

const memo = new Map<string, Promise<PmakDiagnosticResult>>();
const CONTROL_CHARS = new RegExp(
  `[${Array.from({ length: 0x20 }, (_, index) => `\\u${index.toString(16).padStart(4, '0')}`).join('')}` +
    '\\u007f' +
    `${Array.from({ length: 0x20 }, (_, index) => `\\u${(0x80 + index).toString(16).padStart(4, '0')}`).join('')}]`,
  'g'
);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizedBaseUrl(apiBaseUrl: string): string {
  return new URL(apiBaseUrl.trim()).toString().replace(/\/+$/, '');
}

function isBlank(value: unknown): boolean {
  return value === null || value === '';
}

function timeoutError(): Error {
  return new Error('PMAK identity diagnosis timed out');
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError());
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(timeoutError()), { once: true });
    })
  ]);
}

async function inspect(options: InspectPmakIdentityOptions, baseUrl: string): Promise<PmakDiagnosticResult> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const fetchImpl = options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));

  let response: Response;
  try {
    response = await raceAbort(fetchImpl(`${baseUrl}/me`, {
      headers: { 'x-api-key': options.apiKey },
      signal
    }), signal);
  } catch {
    return { kind: 'inconclusive' };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: 'invalid', status: response.status };
  }
  if (!response.ok) return { kind: 'inconclusive', status: response.status };

  let payload: unknown;
  try {
    payload = await raceAbort(response.text(), signal).then((body) => JSON.parse(body));
  } catch {
    return { kind: 'inconclusive', status: response.status };
  }
  const body = asRecord(payload);
  const user = asRecord(body?.user);
  if (!body || !user) return { kind: 'inconclusive', status: response.status };

  if (typeof user.username === 'string' && user.username.trim() || typeof user.email === 'string' && user.email.trim()) {
    return { kind: 'personal', status: response.status, payload: body };
  }
  if (
    Object.hasOwn(user, 'username') && Object.hasOwn(user, 'email') &&
    isBlank(user.username) && isBlank(user.email)
  ) {
    return { kind: 'service-account', status: response.status, payload: body };
  }
  return { kind: 'inconclusive', status: response.status };
}

export function __resetPmakDiagnosticMemo(): void {
  memo.clear();
}

export function maskPmakDiagnostic(message: string, secrets: readonly (string | undefined)[]): string {
  let masked = message;
  for (const secret of secrets) {
    if (secret) masked = masked.split(secret).join('***');
  }
  return masked
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatRejectedMint(originalMintError: string, result: PmakDiagnosticResult): string {
  switch (result.kind) {
    case 'personal':
      return `${originalMintError} Personal API key detected, cannot mint a service-account access token.`;
    case 'service-account':
      return `${originalMintError} postman-api-key authenticates (GET /me OK) but was rejected by POST /service-account-tokens and lacks permission to mint access tokens.`;
    case 'invalid':
      return `${originalMintError} postman-api-key is invalid, disabled, or expired.`;
    case 'inconclusive':
      return originalMintError;
  }
}

export function inspectPmakIdentity(options: InspectPmakIdentityOptions): Promise<PmakDiagnosticResult> {
  const baseUrl = normalizedBaseUrl(options.apiBaseUrl);
  const key = `${baseUrl}\u0000${options.apiKey}`;
  const existing = memo.get(key);
  if (existing) return existing;

  const promise = inspect(options, baseUrl);
  memo.set(key, promise);
  if (options.mode === 'preflight') {
    void promise.then((result) => {
      if (result.kind === 'inconclusive' && memo.get(key) === promise) memo.delete(key);
    });
  }
  return promise;
}
