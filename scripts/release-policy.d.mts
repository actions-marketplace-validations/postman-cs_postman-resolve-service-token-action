export const MAX_LS_REMOTE_BYTES: number;
export const MAX_LS_REMOTE_LINES: number;

export function normalizeSemver(version: string): string;
export function compareSemver(left: string, right: string): -1 | 0 | 1;
export function isImmutableTagName(tag: string): boolean;
export function versionFromImmutableTag(tag: string): string;
export function classifyReleaseRef(input: {
  ref: string;
  refName: string;
  packageVersion: string;
}): {
  release_kind: 'immutable' | 'alias';
  package_version: string;
  npm_publish: 'true' | 'false';
};
export function recordMatchesCommit(
  record: { objectSha: string; peeledSha: string; tag: string },
  targetCommit: string
): boolean;
export function immutableTagsAtCommit(
  records: Array<{ objectSha: string; peeledSha: string; tag: string }>,
  targetCommit: string
): Array<{ objectSha: string; peeledSha: string; tag: string }>;
export function decideMajorAliasAdvance(input: {
  candidateVersion: string;
  targetVersions: string[];
}): { action: 'advance' | 'skip'; notice: string | null; targetVersion: string | null };
export function parseLsRemoteLine(
  line: string
): { oid: string; tag: string; peeled: boolean } | null;
export function parseLsRemoteTags(
  text: string,
  limits?: { maxBytes?: number; maxLines?: number }
): Array<{ objectSha: string; peeledSha: string; tag: string }>;
export function decideAliasFromLsRemote(input: {
  candidateVersion: string;
  major: string;
  lsRemoteText: string;
}): { action: 'advance' | 'skip'; notice: string | null; targetVersion: string | null };
export function readBoundedStdin(
  stream: AsyncIterable<Buffer | string>,
  maxBytes?: number
): Promise<string>;
