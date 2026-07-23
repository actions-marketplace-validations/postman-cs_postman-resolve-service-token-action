export interface ReleaseManifest {
  schema_version: number;
  repository: string;
  commit_sha: string;
  tag: string;
  package_name: string;
  package_version: string;
  artifacts: Array<{ path: string; sha256: string }>;
}

export function validateManifest(
  manifest: ReleaseManifest,
  directory: string,
  expected: { repository: string; commitSha: string; tag: string }
): void;

export function validateTagVersion(tag: string, packageVersion: string): void;
