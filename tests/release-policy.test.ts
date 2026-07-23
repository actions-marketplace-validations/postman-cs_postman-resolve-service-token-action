import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyReleaseRef,
  compareSemver,
  decideAliasFromLsRemote,
  decideMajorAliasAdvance,
  MAX_LS_REMOTE_BYTES,
  MAX_LS_REMOTE_LINES,
  normalizeSemver,
  parseLsRemoteTags,
  versionFromImmutableTag
} from '../scripts/release-policy.mjs';

const policyScript = join(process.cwd(), 'scripts/release-policy.mjs');
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version as string;

function readOutputs(outputPath: string) {
  return Object.fromEntries(
    readFileSync(outputPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const eq = line.indexOf('=');
        return [line.slice(0, eq), line.slice(eq + 1)] as const;
      })
  );
}

function runClassifyCli(env: Record<string, string>) {
  const outputDir = mkdtempSync(join(tmpdir(), 'classify-out-'));
  const outputPath = join(outputDir, 'github_output');
  writeFileSync(outputPath, '');
  try {
    const result = execFileSync(process.execPath, [policyScript, 'classify'], {
      env: { ...process.env, ...env, GITHUB_OUTPUT: outputPath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return {
      status: 0,
      stdout: result,
      stderr: '',
      outputs: readOutputs(outputPath)
    };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      outputs: readOutputs(outputPath)
    };
  } finally {
    rmSync(dirname(outputPath), { recursive: true, force: true });
  }
}

function runDecideAliasCli(stdin: string, candidateVersion: string, major: string) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [policyScript, 'decide-alias', '--candidate-version', candidateVersion, '--major', major],
      {
        encoding: 'utf8',
        input: stdin,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: MAX_LS_REMOTE_BYTES + 1024 * 64
      }
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? ''
    };
  }
}

describe('release policy classification', () => {
  it('classifies exact and zero-patch immutable tags with npm_publish true', () => {
    expect(classifyReleaseRef({ ref: 'refs/tags/v2.0.4', refName: 'v2.0.4', packageVersion: '2.0.4' })).toEqual({
      release_kind: 'immutable',
      package_version: '2.0.4',
      npm_publish: 'true'
    });
    expect(classifyReleaseRef({ ref: 'refs/tags/v2.1', refName: 'v2.1', packageVersion: '2.1.0' })).toEqual({
      release_kind: 'immutable',
      package_version: '2.1.0',
      npm_publish: 'true'
    });
  });

  it('classifies rolling major aliases with npm_publish false and rejects branch/mismatch refs', () => {
    expect(classifyReleaseRef({ ref: 'refs/tags/v2', refName: 'v2', packageVersion: '2.0.4' })).toEqual({
      release_kind: 'alias',
      package_version: '2.0.4',
      npm_publish: 'false'
    });
    expect(() => classifyReleaseRef({ ref: 'refs/heads/main', refName: 'main', packageVersion: '2.0.4' })).toThrow(
      /accepted immutable tag/
    );
    expect(() => classifyReleaseRef({ ref: 'refs/tags/v2.0.3', refName: 'v2.0.3', packageVersion: '2.0.4' })).toThrow(
      /accepted immutable tag/
    );
  });

  it('invokes the classify CLI for immutable, alias, branch, and mismatched tag paths', () => {
    const immutable = runClassifyCli({
      GITHUB_REF: `refs/tags/v${packageVersion}`,
      GITHUB_REF_NAME: `v${packageVersion}`
    });
    expect(immutable.status).toBe(0);
    expect(immutable.outputs).toEqual({
      release_kind: 'immutable',
      package_version: packageVersion,
      npm_publish: 'true'
    });

    const major = packageVersion.split('.')[0];
    const alias = runClassifyCli({
      GITHUB_REF: `refs/tags/v${major}`,
      GITHUB_REF_NAME: `v${major}`
    });
    expect(alias.status).toBe(0);
    expect(alias.outputs).toEqual({
      release_kind: 'alias',
      package_version: packageVersion,
      npm_publish: 'false'
    });
    expect(alias.stdout).toContain(`::notice::Rolling alias v${major} requires no publication work.`);

    const branch = runClassifyCli({
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REF_NAME: 'main'
    });
    expect(branch.status).not.toBe(0);
    expect(branch.outputs).toEqual({});
    expect(branch.stderr.trim()).toMatch(
      /^::error::Release workflow must run from an accepted immutable tag; got refs\/heads\/main; expected /
    );
    expect(branch.stderr).toContain(`v${packageVersion}`);
    expect(branch.stderr).toContain(`or v${major}`);

    const mismatch = runClassifyCli({
      GITHUB_REF: 'refs/tags/v0.0.0',
      GITHUB_REF_NAME: 'v0.0.0'
    });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.outputs).toEqual({});
    expect(mismatch.stderr.trim()).toMatch(
      /^::error::Release workflow must run from an accepted immutable tag; got refs\/tags\/v0\.0\.0; expected /
    );
  });
});

describe('release policy alias decisions from ls-remote', () => {
  it('normalizes zero-patch minor forms and orders semantic versions', () => {
    expect(normalizeSemver('2.1')).toBe('2.1.0');
    expect(normalizeSemver('2.1.0')).toBe('2.1.0');
    expect(compareSemver('2.1', '2.1.0')).toBe(0);
    expect(compareSemver('2.0.4', '2.1.0')).toBe(-1);
    expect(versionFromImmutableTag('v2.1')).toBe('2.1.0');
  });

  it('skips when the alias target is newer and advances for same or older targets', () => {
    expect(decideMajorAliasAdvance({ candidateVersion: '2.0.4', targetVersions: ['2.1.0'] }).action).toBe('skip');
    expect(decideMajorAliasAdvance({ candidateVersion: '2.1.0', targetVersions: ['2.0.4'] }).action).toBe('advance');
    expect(decideMajorAliasAdvance({ candidateVersion: '2.1', targetVersions: ['2.1.0'] }).action).toBe('advance');
    expect(decideMajorAliasAdvance({ candidateVersion: '2.0.4', targetVersions: [] }).action).toBe('advance');
  });

  it('handles lightweight alias+immutable and annotated alias+immutable ls-remote fixtures', () => {
    const lightweight = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v2',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v2.0.4'
    ].join('\n');
    expect(decideAliasFromLsRemote({ candidateVersion: '2.0.5', major: 'v2', lsRemoteText: lightweight }).action).toBe(
      'advance'
    );

    const annotated = [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v2',
      'cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2^{}',
      'dddddddddddddddddddddddddddddddddddddddd\trefs/tags/v2.0.4',
      'cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.4^{}'
    ].join('\n');
    expect(decideAliasFromLsRemote({ candidateVersion: '2.0.4', major: 'v2', lsRemoteText: annotated }).action).toBe(
      'advance'
    );
    expect(decideAliasFromLsRemote({ candidateVersion: '2.0.3', major: 'v2', lsRemoteText: annotated }).action).toBe(
      'skip'
    );
  });

  it('advances when the alias is missing and fails closed when an existing alias has no immutable identity', () => {
    expect(decideAliasFromLsRemote({ candidateVersion: '2.0.4', major: 'v2', lsRemoteText: '' }).action).toBe('advance');
    expect(() =>
      decideAliasFromLsRemote({
        candidateVersion: '2.0.4',
        major: 'v2',
        lsRemoteText: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v2\n'
      })
    ).toThrow(/no immutable version resolves at its target/);
  });

  it('bounds ls-remote parsing by bytes and line count without a Git invocation', () => {
    expect(() => parseLsRemoteTags('x'.repeat(MAX_LS_REMOTE_BYTES + 1))).toThrow(/exceeds .* bytes/);
    const tooManyLines = Array.from({ length: MAX_LS_REMOTE_LINES + 1 }, () => '').join('\n');
    expect(() => parseLsRemoteTags(tooManyLines)).toThrow(/exceeds .* lines/);
    const ok = parseLsRemoteTags('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v2.0.4\n');
    expect(ok).toEqual([{ objectSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', peeledSha: '', tag: 'v2.0.4' }]);
  });

  it('invokes the decide-alias CLI for skip, advance, fail-closed, and bounded-stdin paths', () => {
    const annotatedNewer = [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v2',
      'cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2^{}',
      'dddddddddddddddddddddddddddddddddddddddd\trefs/tags/v2.0.4',
      'cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.4^{}'
    ].join('\n');
    const skip = runDecideAliasCli(annotatedNewer, '2.0.3', 'v2');
    expect(skip.status).toBe(0);
    expect(JSON.parse(skip.stdout).action).toBe('skip');
    expect(skip.stderr).toBe('');

    const missing = runDecideAliasCli('', '2.0.4', 'v2');
    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout).action).toBe('advance');
    expect(missing.stderr).toBe('');

    const unresolved = runDecideAliasCli(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v2\n',
      '2.0.4',
      'v2'
    );
    expect(unresolved.status).not.toBe(0);
    expect(unresolved.stdout.trim()).toBe('');
    expect(unresolved.stderr.trim()).toMatch(
      /^::error::alias v2 exists at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa but no immutable version resolves at its target$/
    );
    expect(unresolved.stderr.trim().split('\n')).toHaveLength(1);

    const oversized = runDecideAliasCli('x'.repeat(MAX_LS_REMOTE_BYTES + 1), '2.0.4', 'v2');
    expect(oversized.status).not.toBe(0);
    expect(oversized.stdout.trim()).toBe('');
    expect(oversized.stderr.trim()).toMatch(/^::error::ls-remote input exceeds .*bytes$/);
  });
});
