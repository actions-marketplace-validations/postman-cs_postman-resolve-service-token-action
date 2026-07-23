import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assertScript = path.join(repoRoot, 'scripts', 'assert-release-dist-untouched.mjs');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-c', 'core.excludesFile=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'assert-release-dist-fixture',
      GIT_AUTHOR_EMAIL: 'assert-release-dist-fixture@example.com',
      GIT_COMMITTER_NAME: 'assert-release-dist-fixture',
      GIT_COMMITTER_EMAIL: 'assert-release-dist-fixture@example.com'
    }
  });
  return result.stdout;
}

async function runAssert(root: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [assertScript, root], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? ''
      },
      maxBuffer: 1024 * 1024
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const execError = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof execError.code === 'number' ? execError.code : 1,
      stdout: String(execError.stdout ?? ''),
      stderr: String(execError.stderr ?? '')
    };
  }
}

describe('assert-release-dist-untouched post-check mutation detection', () => {
  it('rejects a tracked dist mutation with nonzero exit and mutation error output', async () => {
    const root = await makeTempDir('assert-release-dist-mod-');
    const distDir = path.join(root, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, 'cli.cjs'), 'module.exports = { entry: "cli" };\n', 'utf8');
    await writeFile(path.join(distDir, 'index.cjs'), 'module.exports = { entry: "index" };\n', 'utf8');

    await git(root, ['init', '--quiet']);
    await git(root, ['config', 'user.email', 'assert-release-dist-fixture@example.com']);
    await git(root, ['config', 'user.name', 'assert-release-dist-fixture']);
    await git(root, ['add', '--', 'dist/cli.cjs', 'dist/index.cjs']);
    await git(root, ['commit', '--quiet', '-m', 'fixture: track clean release dist']);

    const tracked = (await git(root, ['ls-files', '--', 'dist'])).trim().split('\n').filter(Boolean);
    expect(tracked.sort()).toEqual(['dist/cli.cjs', 'dist/index.cjs']);
    expect((await git(root, ['status', '--porcelain', '--', 'dist'])).trim()).toBe('');

    await writeFile(path.join(distDir, 'index.cjs'), 'module.exports = { entry: "mutated" };\n', 'utf8');

    const result = await runAssert(root);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('::error::dist was modified; release consumers must not rebuild tagged bytes');
    expect(result.stderr).toMatch(/dist\/index\.cjs/);
  }, 30_000);
});
