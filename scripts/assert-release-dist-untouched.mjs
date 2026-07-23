#!/usr/bin/env node
/**
 * Release Windows/Linux consumer: tag must carry dist and tests must not rebuild it.
 * Usage: node scripts/assert-release-dist-untouched.mjs [repoRoot]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const required = ['dist/cli.cjs', 'dist/index.cjs'];

for (const rel of required) {
  if (!existsSync(path.join(root, rel))) {
    console.error(`::error::release tag missing committed ${rel}`);
    process.exit(1);
  }
}

const porcelain = execFileSync('git', ['status', '--porcelain', '--', 'dist'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

if (porcelain.length > 0) {
  console.error('::error::dist was modified; release consumers must not rebuild tagged bytes');
  console.error(porcelain);
  process.exit(1);
}

console.log('release dist present and untouched');
