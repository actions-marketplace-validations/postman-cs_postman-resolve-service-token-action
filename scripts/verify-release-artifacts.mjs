import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function validateManifest(manifest, directory, expected) {
  for (const [key, value] of Object.entries({ repository: expected.repository, commit_sha: expected.commitSha, tag: expected.tag })) {
    if (manifest[key] !== value) throw new Error(`manifest ${key} mismatch`);
  }
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.artifacts)) throw new Error('invalid manifest schema');
  for (const artifact of manifest.artifacts) {
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || !artifact.path || artifact.path.includes('..')) throw new Error('invalid artifact manifest entry');
    const path = join(directory, artifact.path);
    if (!existsSync(path)) throw new Error(`missing artifact ${artifact.path}`);
    if (sha256(path) !== artifact.sha256) throw new Error(`checksum mismatch for ${artifact.path}`);
  }
  validateTagVersion(manifest.tag, manifest.package_version);
}

export function validateTagVersion(tag, packageVersion) {
  const [major, minor, patch] = packageVersion.split('.');
  if (tag !== `v${packageVersion}` && !(patch === '0' && tag === `v${major}.${minor}`)) {
    throw new Error(`tag ${tag} does not match package version ${packageVersion}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = process.cwd();
  const manifest = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'));
  validateManifest(manifest, directory, {
    repository: process.env.GITHUB_REPOSITORY,
    commitSha: process.env.GITHUB_SHA,
    tag: process.env.GITHUB_REF_NAME
  });
  console.log('release artifact manifest verified');
}
