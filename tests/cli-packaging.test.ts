import { execFile } from 'node:child_process';
import { access, constants, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmCliArgs = process.platform === 'win32' ? [process.env.npm_execpath || ''] : [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('CLI packaging contract', () => {
  it('commits a Node shebang and git-index executable mode on dist/cli.cjs', async () => {
    const cliPath = path.join(repoRoot, 'dist', 'cli.cjs');
    const contents = await readFile(cliPath, 'utf8');
    expect(contents.startsWith('#!/usr/bin/env node\n')).toBe(true);

    if (process.platform !== 'win32') {
      const mode = (await stat(cliPath)).mode & 0o777;
      expect(mode & 0o111).not.toBe(0);
      await access(cliPath, constants.X_OK);
    }

    const staged = await execFileAsync('git', ['ls-files', '--stage', 'dist/cli.cjs'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    expect(staged.stdout).toMatch(/^100755 /);
  });

  it('runs ./dist/cli.cjs --help and --version without credentials, network, or writes', async () => {
    const cliPath = path.join(repoRoot, 'dist', 'cli.cjs');
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const sandbox = await makeTempDir('postman-resolve-service-token-cli-sandbox-');
    const env = {
      PATH: process.env.PATH ?? '',
      INPUT_POSTMAN_API_KEY: '',
      POSTMAN_API_KEY: '',
      POSTMAN_ACCESS_TOKEN: '',
      INPUT_POSTMAN_ACCESS_TOKEN: '',
      HOME: sandbox,
      TMPDIR: sandbox
    };

    const help = await execFileAsync(process.execPath, [cliPath, '--help'], {
      cwd: sandbox,
      encoding: 'utf8',
      env,
      maxBuffer: 1024 * 1024
    });
    expect(help.stdout).toMatch(/Usage:\s+postman-resolve-service-token/i);
    expect(help.stderr).not.toMatch(/permission denied|exec format|syntax error|unexpected token|"use strict"/i);

    const version = await execFileAsync(process.execPath, [cliPath, '--version'], {
      cwd: sandbox,
      encoding: 'utf8',
      env,
      maxBuffer: 1024 * 1024
    });
    expect(version.stdout.trim()).toBe(packageJson.version);

    const written = await import('node:fs/promises').then(({ readdir }) =>
      readdir(sandbox, { recursive: true })
    );
    expect(written).toEqual([]);
  }, 20_000);

  it('prefers CLI credential flags over action and plain environment values', async () => {
    const cliPath = path.join(repoRoot, 'dist', 'cli.cjs');
    const sandbox = await makeTempDir('postman-resolve-service-token-precedence-');
    const result = await execFileAsync(
      process.execPath,
      [
        cliPath,
        '--postman-access-token',
        'flag-access-token',
        '--postman-team-id',
        'flag-team-id'
      ],
      {
        cwd: sandbox,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: sandbox,
          TMPDIR: sandbox,
          INPUT_POSTMAN_ACCESS_TOKEN: 'input-access-token',
          INPUT_POSTMAN_TEAM_ID: 'input-team-id',
          POSTMAN_ACCESS_TOKEN: 'plain-access-token',
          POSTMAN_ACTIONS_TELEMETRY: 'off'
        },
        maxBuffer: 1024 * 1024
      }
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      token: 'flag-access-token',
      'team-id': 'flag-team-id',
      skipped: 'true'
    });
  });

  it('packs, installs, and runs postman-resolve-service-token --help/--version without side effects', async () => {
    const packDir = await makeTempDir('postman-resolve-service-token-pack-');
    const prefixDir = await makeTempDir('postman-resolve-service-token-prefix-');
    const distBefore = new Map(
      await Promise.all(
        ['cli.cjs', 'index.cjs'].map(async (name) => [name, await readFile(path.join(repoRoot, 'dist', name))] as const)
      )
    );

    const packResult = await execFileAsync(
      npmCommand,
      [...npmCliArgs, 'pack', '--json', '--pack-destination', packDir],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          NPM_CONFIG_CACHE: path.join(packDir, '.npm-cache'),
          NPM_CONFIG_IGNORE_SCRIPTS: 'true',
          PATH: process.env.PATH ?? ''
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );
    const [packed] = JSON.parse(packResult.stdout) as Array<{
      filename: string;
      name: string;
      files: Array<{ mode: number; path: string }>;
    }>;
    expect(packed.name).toBe('@postman-cse/onboarding-resolve-service-token');
    expect(
      packed.files.filter((file) => file.path.startsWith('dist/')).map((file) => file.path).sort()
    ).toEqual(['dist/cli.cjs', 'dist/index.cjs']);
    if (process.platform !== 'win32') {
      expect(packed.files.find((file) => file.path === 'dist/cli.cjs')?.mode).toBe(0o755);
    }

    const tarballPath = path.join(packDir, packed.filename);
    await mkdir(prefixDir, { recursive: true });
    await execFileAsync(npmCommand, [...npmCliArgs, 'install', '--prefix', prefixDir, '--ignore-scripts', tarballPath], {
      encoding: 'utf8',
      env: {
        NPM_CONFIG_CACHE: path.join(packDir, '.npm-cache'),
        PATH: process.env.PATH ?? ''
      },
      maxBuffer: 20 * 1024 * 1024
    });

    const binPath = path.join(
      prefixDir,
      'node_modules',
      '@postman-cse',
      'onboarding-resolve-service-token',
      'dist',
      'cli.cjs'
    );

    const help = await execFileAsync(process.execPath, [binPath, '--help'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        INPUT_POSTMAN_API_KEY: 'should-not-be-used',
        POSTMAN_API_KEY: 'should-not-be-used',
        POSTMAN_ACCESS_TOKEN: 'should-not-be-used'
      },
      maxBuffer: 1024 * 1024
    });

    expect(help.stdout).toMatch(/Usage:\s+postman-resolve-service-token/i);
    expect(help.stderr).not.toMatch(
      /permission denied|exec format|syntax error|unexpected token|"use strict"/i
    );
    expect(help.stdout).not.toMatch(/"use strict"/);

    const version = await execFileAsync(process.execPath, [binPath, '--version'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      maxBuffer: 1024 * 1024
    });
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(version.stdout.trim()).toBe(packageJson.version);

    for (const [name, before] of distBefore) {
      expect(await readFile(path.join(repoRoot, 'dist', name))).toEqual(before);
    }
  }, 60_000);

  it('keeps an exact dist census of cli/index entrypoints', async () => {
    const distDir = path.join(repoRoot, 'dist');
    const entries = (
      await execFileAsync('git', ['ls-files', '--', 'dist'], {
        cwd: repoRoot,
        encoding: 'utf8'
      })
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((filePath) => path.basename(filePath))
      .sort();
    expect(entries).toEqual(['cli.cjs', 'index.cjs']);

    const onDisk = (await import('node:fs/promises')).readdir(distDir);
    expect((await onDisk).slice().sort()).toEqual(['cli.cjs', 'index.cjs']);
  });

  it('does not rebuild dist from packaging tests', async () => {
    const packageJson = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;
    const packagingSource = await readFile(path.join(repoRoot, 'tests', 'cli-packaging.test.ts'), 'utf8');
    // Build the banned rebuild token without embedding the contiguous literal in this file,
    // otherwise the self-scan would match the expectation source itself.
    const bannedRebuild = ['rm', '-rf', 'dist'].join(' ');
    expect(scripts['verify:dist:assert']).toBe(
      'git diff --ignore-space-at-eol --text --exit-code -- dist && node scripts/verify-dist-artifact.mjs'
    );
    expect(scripts['verify:dist']).toBe(
      ['npm run', 'build', '&& npm run verify:dist:assert'].join(' ')
    );
    expect(packageJson).toMatch(/"bundle"/);
    expect(packagingSource).not.toMatch(/\bnpm run (?:build|bundle)\b/);
    expect(packagingSource).not.toMatch(/\besbuild\b/);
    expect(packagingSource).not.toMatch(new RegExp(bannedRebuild.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
