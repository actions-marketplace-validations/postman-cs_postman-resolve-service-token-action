import {
  createNodeExecFile,
  readInputsFromEnv,
  runResolveServiceToken,
  type CoreLike
} from './index.js';

const cliInputNames = [
  'postman-api-key',
  'postman-access-token',
  'postman-team-id',
  'postman-stack',
  'write-github-secret',
  'access-token-secret-name',
  'team-id-secret-name',
  'github-token'
] as const;

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === `--${name}`) {
      return argv[index + 1];
    }
    if (value?.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return undefined;
}

function applyArgsToEnv(argv: string[], env: NodeJS.ProcessEnv): void {
  for (const name of cliInputNames) {
    const value = readFlag(argv, name);
    if (value !== undefined) {
      env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] = value;
    }
  }
}

const outputs: Record<string, string> = {};

const cliCore: CoreLike = {
  info(message) {
    console.error(message);
  },
  setOutput(name, value) {
    outputs[name] = value;
  },
  setSecret() {
  }
};

async function main(): Promise<void> {
  const env = { ...process.env };
  applyArgsToEnv(process.argv, env);
  await runResolveServiceToken(readInputsFromEnv(env), {
    core: cliCore,
    fetcher: fetch,
    execFile: createNodeExecFile(env),
    env
  });
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
