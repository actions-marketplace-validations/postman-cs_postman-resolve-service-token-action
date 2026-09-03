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

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null'
    }
  });
}

async function initFixtureRepo(options: {
  includeCli?: boolean;
  includeIndex?: boolean;
  commit?: boolean;
}): Promise<string> {
  const root = await makeTempDir('assert-release-dist-');
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'user.name', 'assert-release-dist-fixture']);
  await git(root, ['config', 'user.email', 'assert-release-dist-fixture@example.com']);
  // Detach host XDG/global excludes (often include dist/) so fixture add/commit is hermetic.
  await git(root, ['config', 'core.excludesFile', path.join(root, '.git', 'no-excludes')]);

  const distDir = path.join(root, 'dist');
  await mkdir(distDir, { recursive: true });
  if (options.includeCli !== false) {
    await writeFile(path.join(distDir, 'cli.cjs'), 'module.exports = {};\n', 'utf8');
  }
  if (options.includeIndex !== false) {
    await writeFile(path.join(distDir, 'index.cjs'), 'module.exports = {};\n', 'utf8');
  }

  if (options.commit) {
    await git(root, ['add', '--', 'dist']);
    await git(root, ['commit', '--quiet', '-m', 'fixture: track release dist']);
  }

  return root;
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

describe('assert-release-dist-untouched presence', () => {
  it('succeeds when clean tracked dist/cli.cjs and dist/index.cjs are present', async () => {
    const root = await initFixtureRepo({ commit: true });
    const result = await runAssert(root);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('release dist present and untouched');
  }, 30_000);

  it('fails with nonzero status when a required dist file is missing', async () => {
    const root = await initFixtureRepo({ includeIndex: false, commit: true });
    const result = await runAssert(root);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('::error::release tag missing committed dist/index.cjs');
  }, 30_000);
});
