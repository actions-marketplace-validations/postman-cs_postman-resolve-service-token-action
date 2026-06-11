import type { Fetcher } from './index.js';

export interface TokenIdentity {
  teamId: string | undefined;
  userId: string | undefined;
  fullName: string | undefined;
}

let memo: TokenIdentity | undefined;

export function __resetIdentityMemo(): void {
  memo = undefined;
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

function stringifyField(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function parseJsonSafe(body: string): unknown {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

export async function resolveTokenIdentity(
  token: string,
  apiHost: string,
  fetcher: Fetcher
): Promise<TokenIdentity> {
  if (memo !== undefined) return memo;

  try {
    const response = await fetcher(`${apiHost}/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      memo = { teamId: undefined, userId: undefined, fullName: undefined };
      return memo;
    }
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    const payload = parseJsonSafe(body);
    const teamIdCandidates = [
      ['user', 'teamId'],
      ['user', 'team'],
      ['teamId'],
      ['team', 'id'],
      ['team'],
      ['identity', 'team'],
      ['session', 'identity', 'team']
    ];
    let teamId: string | undefined;
    for (const path of teamIdCandidates) {
      teamId = stringifyField(readPath(payload, path));
      if (teamId) break;
    }
    const userId =
      stringifyField(readPath(payload, ['user', 'id'])) ??
      stringifyField(readPath(payload, ['id']));
    const fullName =
      stringifyField(readPath(payload, ['user', 'fullName'])) ??
      stringifyField(readPath(payload, ['fullName']));
    memo = { teamId, userId, fullName };
    return memo;
  } catch {
    memo = { teamId: undefined, userId: undefined, fullName: undefined };
    return memo;
  }
}
