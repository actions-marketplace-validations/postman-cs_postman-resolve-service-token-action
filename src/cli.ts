import {
  createNodeExecFile,
  readInputsFromEnv,
  runResolveServiceToken,
  type CoreLike
} from './index.js';
import { resolveActionVersion } from './action-version.js';

const cliInputNames = [
  'postman-api-key',
  'postman-access-token',
  'postman-team-id',
  'postman-region',
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

function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-V');
}

function printHelp(): void {
  const inputFlags = cliInputNames.map((name) => `  --${name} <value>`).join('\n');
  process.stdout.write(`Usage: postman-resolve-service-token [options]

Mint a Postman service-account access token and resolve the team ID.

Options mirror action.yml inputs as --kebab-case flags:
${inputFlags}

Other:
  --help       Show this help text and exit
  --version    Print the package version and exit
`);
}

function printVersion(): void {
  process.stdout.write(`${resolveActionVersion()}\n`);
}

const outputs: Record<string, string> = {};

const cliCore: CoreLike = {
  info(message) {
    console.error(message);
  },
  // Diagnostics belong on stderr so `--json`-style stdout stays parseable.
  // Whether these lines are emitted at all is the logger's level decision,
  // driven by POSTMAN_ACTIONS_LOG_LEVEL / RUNNER_DEBUG.
  debug(message) {
    console.error(message);
  },
  warning(message) {
    console.error(message);
  },
  error(message) {
    console.error(message);
  },
  setOutput(name, value) {
    outputs[name] = value;
  },
  setSecret() {
  }
};

async function main(argv: string[] = process.argv): Promise<void> {
  if (wantsHelp(argv)) {
    printHelp();
    return;
  }
  if (wantsVersion(argv)) {
    printVersion();
    return;
  }

  const env = { ...process.env };
  applyArgsToEnv(argv, env);
  await runResolveServiceToken(readInputsFromEnv(env), {
    core: cliCore,
    fetcher: fetch,
    execFile: createNodeExecFile(env),
    env
  });
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}

function shouldRunMain(): boolean {
  const cjsModule = typeof module !== 'undefined' ? module : undefined;
  const cjsRequire = typeof require !== 'undefined' ? require : undefined;
  return Boolean(cjsModule && cjsRequire && cjsRequire.main === cjsModule);
}

if (shouldRunMain()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  });
}
