import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_LS_REMOTE_BYTES = 1024 * 1024;
export const MAX_LS_REMOTE_LINES = 10_000;

/**
 * @param {string} version
 * @returns {string}
 */
export function normalizeSemver(version) {
  const bare = String(version).replace(/^v/, '');
  const parts = bare.split('.');
  if (parts.length === 2 && parts.every((part) => /^\d+$/.test(part))) {
    return `${parts[0]}.${parts[1]}.0`;
  }
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return bare;
  }
  throw new Error(`invalid semantic version: ${version}`);
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {-1|0|1}
 */
export function compareSemver(left, right) {
  const a = normalizeSemver(left).split('.').map(Number);
  const b = normalizeSemver(right).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * @param {string} tag
 * @returns {boolean}
 */
export function isImmutableTagName(tag) {
  return /^v\d+\.\d+\.\d+$/.test(tag) || /^v\d+\.\d+$/.test(tag);
}

/**
 * @param {string} tag
 * @returns {string}
 */
export function versionFromImmutableTag(tag) {
  if (!isImmutableTagName(tag)) {
    throw new Error(`not an immutable tag: ${tag}`);
  }
  return normalizeSemver(tag.slice(1));
}

/**
 * @param {{ ref: string, refName: string, packageVersion: string }} input
 * @returns {{ release_kind: 'immutable'|'alias', package_version: string, npm_publish: 'true'|'false' }}
 */
export function classifyReleaseRef({ ref, refName, packageVersion }) {
  const [major, minor, patch] = packageVersion.split('.');
  const accepted = `expected v${packageVersion}, v${major}.${minor} when patch is zero, or v${major}`;
  if (!ref?.startsWith('refs/tags/v') || !refName?.startsWith('v')) {
    throw new Error(`Release workflow must run from an accepted immutable tag; got ${ref}; ${accepted}`);
  }
  const tagVersion = refName.slice(1);
  if (tagVersion === packageVersion || (patch === '0' && tagVersion === `${major}.${minor}`)) {
    return { release_kind: 'immutable', package_version: packageVersion, npm_publish: 'true' };
  }
  if (tagVersion === major) {
    return { release_kind: 'alias', package_version: packageVersion, npm_publish: 'false' };
  }
  throw new Error(`Release workflow must run from an accepted immutable tag; got ${ref}; ${accepted}`);
}

/**
 * @param {{ objectSha: string, peeledSha: string, tag: string }} record
 * @param {string} targetCommit
 */
export function recordMatchesCommit(record, targetCommit) {
  const commit = record.peeledSha || record.objectSha;
  return commit === targetCommit;
}

/**
 * @param {Array<{ objectSha: string, peeledSha: string, tag: string }>} records
 * @param {string} targetCommit
 */
export function immutableTagsAtCommit(records, targetCommit) {
  return records.filter((record) => isImmutableTagName(record.tag) && recordMatchesCommit(record, targetCommit));
}

/**
 * @param {{ candidateVersion: string, targetVersions: string[] }} input
 * @returns {{ action: 'advance'|'skip', notice: string|null, targetVersion: string|null }}
 */
export function decideMajorAliasAdvance({ candidateVersion, targetVersions }) {
  const candidate = normalizeSemver(candidateVersion);
  if (!targetVersions.length) {
    return { action: 'advance', notice: null, targetVersion: null };
  }
  const newest = [...targetVersions].map(normalizeSemver).sort(compareSemver).at(-1) ?? null;
  if (newest && compareSemver(newest, candidate) > 0) {
    return {
      action: 'skip',
      notice: `not advancing major alias because it already targets newer ${newest}`,
      targetVersion: newest
    };
  }
  return { action: 'advance', notice: null, targetVersion: newest };
}

/**
 * Parse one `git ls-remote --tags` line.
 * @param {string} line
 * @returns {{ oid: string, tag: string, peeled: boolean }|null}
 */
export function parseLsRemoteLine(line) {
  const trimmed = line.trimEnd();
  if (!trimmed) return null;
  const tab = trimmed.indexOf('\t');
  if (tab < 0) return null;
  const oid = trimmed.slice(0, tab);
  const ref = trimmed.slice(tab + 1);
  if (!/^[0-9a-f]{40,64}$/i.test(oid) || !ref.startsWith('refs/tags/')) return null;
  const peeled = ref.endsWith('^{}');
  const tag = peeled ? ref.slice('refs/tags/'.length, -'^{}'.length) : ref.slice('refs/tags/'.length);
  if (!tag) return null;
  return { oid, tag, peeled };
}

/**
 * Aggregate ls-remote lines into tag records with optional peeled SHAs.
 * @param {string} text
 * @param {{ maxBytes?: number, maxLines?: number }} [limits]
 * @returns {Array<{ objectSha: string, peeledSha: string, tag: string }>}
 */
export function parseLsRemoteTags(text, limits = {}) {
  const maxBytes = limits.maxBytes ?? MAX_LS_REMOTE_BYTES;
  const maxLines = limits.maxLines ?? MAX_LS_REMOTE_LINES;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`ls-remote input exceeds ${maxBytes} bytes`);
  }
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    throw new Error(`ls-remote input exceeds ${maxLines} lines`);
  }
  /** @type {Map<string, { objectSha: string, peeledSha: string, tag: string }>} */
  const byTag = new Map();
  for (const line of lines) {
    const parsed = parseLsRemoteLine(line);
    if (!parsed) continue;
    const current = byTag.get(parsed.tag) ?? { objectSha: '', peeledSha: '', tag: parsed.tag };
    if (parsed.peeled) current.peeledSha = parsed.oid;
    else current.objectSha = parsed.oid;
    byTag.set(parsed.tag, current);
  }
  return [...byTag.values()].filter((record) => record.objectSha);
}

/**
 * Decide whether to advance the rolling major alias from scoped ls-remote output.
 * @param {{ candidateVersion: string, major: string, lsRemoteText: string }} input
 */
export function decideAliasFromLsRemote({ candidateVersion, major, lsRemoteText }) {
  if (!major?.startsWith('v')) throw new Error('--major must look like vN');
  const records = parseLsRemoteTags(lsRemoteText);
  const alias = records.find((record) => record.tag === major);
  if (!alias) {
    return decideMajorAliasAdvance({ candidateVersion, targetVersions: [] });
  }
  const targetCommit = alias.peeledSha || alias.objectSha;
  if (!targetCommit) {
    throw new Error(`alias ${major} exists but has no resolvable target commit`);
  }
  const matched = immutableTagsAtCommit(records, targetCommit);
  const targetVersions = matched.map((record) => versionFromImmutableTag(record.tag));
  if (!targetVersions.length) {
    throw new Error(
      `alias ${major} exists at ${targetCommit} but no immutable version resolves at its target`
    );
  }
  return decideMajorAliasAdvance({ candidateVersion, targetVersions });
}

function writeOutput(key, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(output, `${key}=${value}\n`);
}

function runClassify() {
  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const result = classifyReleaseRef({
    ref: process.env.GITHUB_REF ?? '',
    refName: process.env.GITHUB_REF_NAME ?? '',
    packageVersion
  });
  writeOutput('release_kind', result.release_kind);
  writeOutput('package_version', result.package_version);
  writeOutput('npm_publish', result.npm_publish);
  if (result.release_kind === 'alias') {
    console.log(`::notice::Rolling alias ${process.env.GITHUB_REF_NAME} requires no publication work.`);
  }
}

/**
 * @param {AsyncIterable<Buffer|string>} stream
 * @param {number} maxBytes
 */
export async function readBoundedStdin(stream, maxBytes = MAX_LS_REMOTE_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`ls-remote input exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function runDecideAlias() {
  const candidateVersion = process.argv.includes('--candidate-version')
    ? process.argv[process.argv.indexOf('--candidate-version') + 1]
    : '';
  const major = process.argv.includes('--major')
    ? process.argv[process.argv.indexOf('--major') + 1]
    : '';
  if (!candidateVersion) throw new Error('--candidate-version is required');
  if (!major) throw new Error('--major is required');
  const lsRemoteText = await readBoundedStdin(process.stdin);
  const decision = decideAliasFromLsRemote({ candidateVersion, major, lsRemoteText });
  console.log(JSON.stringify(decision));
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'classify') {
    runClassify();
    return;
  }
  if (mode === 'decide-alias') {
    await runDecideAlias();
    return;
  }
  throw new Error('usage: release-policy.mjs classify|decide-alias');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
