#!/usr/bin/env node
"use strict";

// src/index.ts
var import_node_child_process = require("node:child_process");
var DEFAULT_ACCESS_TOKEN_SECRET_NAME = "POSTMAN_ACCESS_TOKEN";
var DEFAULT_TEAM_ID_SECRET_NAME = "POSTMAN_TEAM_ID";
function normalizeOptional(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : void 0;
}
function parseBooleanInput(name, value, defaultValue) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value: true or false`);
}
function resolvePostmanApiHost(stackInput) {
  const stack = normalizeOptional(stackInput) ?? "prod";
  if (stack === "prod") return "https://api.getpostman.com";
  if (stack === "beta") return "https://api.getpostman-beta.com";
  throw new Error(`postman-stack must be one of: prod, beta; got: ${stack}`);
}
function readInputsFromAction(input) {
  return {
    postmanApiKey: normalizeOptional(input.getInput("postman-api-key")),
    postmanAccessToken: normalizeOptional(input.getInput("postman-access-token")),
    postmanTeamId: normalizeOptional(input.getInput("postman-team-id")),
    postmanStack: normalizeOptional(input.getInput("postman-stack")) ?? "prod",
    writeGithubSecret: parseBooleanInput("write-github-secret", input.getInput("write-github-secret"), false),
    accessTokenSecretName: normalizeOptional(input.getInput("access-token-secret-name")) ?? DEFAULT_ACCESS_TOKEN_SECRET_NAME,
    teamIdSecretName: normalizeOptional(input.getInput("team-id-secret-name")) ?? DEFAULT_TEAM_ID_SECRET_NAME,
    githubToken: normalizeOptional(input.getInput("github-token"))
  };
}
function readInputsFromEnv(env = process.env) {
  const getInput = (name) => env[`INPUT_${name.replace(/-/g, "_").toUpperCase()}`] ?? "";
  return readInputsFromAction({ getInput });
}
function createHeaders(entries) {
  return Object.fromEntries(
    Object.entries(entries).filter((entry) => Boolean(entry[1]))
  );
}
async function readResponseBody(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
function parseJsonBody(body, context) {
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    throw new Error(`${context} returned non-JSON response`, { cause: error });
  }
}
function getRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function readPath(source, path) {
  let current = source;
  for (const segment of path) {
    const record = getRecord(current);
    if (!record) return void 0;
    current = record[segment];
  }
  return current;
}
function stringifyCandidate(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || void 0;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  const record = getRecord(value);
  if (record) {
    return stringifyCandidate(record.id);
  }
  return void 0;
}
function extractAccessToken(payload) {
  return stringifyCandidate(readPath(payload, ["access_token"])) ?? stringifyCandidate(readPath(payload, ["session", "token"]));
}
function extractTeamId(payload) {
  const candidates = [
    ["user", "teamId"],
    ["user", "team"],
    ["teamId"],
    ["team", "id"],
    ["team"],
    ["identity", "team"],
    ["session", "identity", "team"]
  ];
  for (const path of candidates) {
    const teamId = stringifyCandidate(readPath(payload, path));
    if (teamId) return teamId;
  }
  return void 0;
}
function formatHttpErrorBody(body) {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return `: ${trimmed}`;
}
async function mintServiceToken(inputs, apiHost, fetcher) {
  const response = await fetcher(`${apiHost}/service-account-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": inputs.postmanApiKey ?? ""
    },
    body: JSON.stringify({ apiKey: inputs.postmanApiKey })
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`service-account-tokens failed (HTTP ${response.status})${formatHttpErrorBody(body)}`);
  }
  const token = extractAccessToken(parseJsonBody(body, "service-account-tokens"));
  if (!token) {
    throw new Error("Mint succeeded but no access token in response");
  }
  return token;
}
async function resolveTeamId(inputs, apiHost, token, fetcher) {
  const response = await fetcher(`${apiHost}/me`, {
    headers: createHeaders({
      Authorization: `Bearer ${token}`,
      "x-api-key": inputs.postmanApiKey
    })
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`/me failed (HTTP ${response.status})${formatHttpErrorBody(body)}`);
  }
  const teamId = extractTeamId(parseJsonBody(body, "/me"));
  if (!teamId) {
    throw new Error("Could not read team id from /me response");
  }
  return teamId;
}
async function writeSecret(name, value, repository, githubToken, dependencies) {
  await dependencies.execFile("gh", ["secret", "set", name, "--repo", repository], {
    env: {
      ...dependencies.env ?? process.env,
      GH_TOKEN: githubToken
    },
    input: value
  });
}
async function writeGitHubSecrets(result, inputs, dependencies) {
  const env = dependencies.env ?? process.env;
  const repository = normalizeOptional(env.GITHUB_REPOSITORY);
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required when write-github-secret is true.");
  }
  if (!inputs.githubToken) {
    throw new Error("github-token is required when write-github-secret is 'true'. The default GITHUB_TOKEN cannot write repo secrets; use a PAT or GitHub App installation token with secrets write permission.");
  }
  try {
    await dependencies.execFile("gh", ["--version"]);
  } catch (error) {
    throw new Error("gh CLI not found on runner. Use a runner image that includes gh (the default GitHub-hosted runners do), or install it before invoking this action.", { cause: error });
  }
  await writeSecret(inputs.accessTokenSecretName, result.token, repository, inputs.githubToken, dependencies);
  await writeSecret(inputs.teamIdSecretName, result.teamId, repository, inputs.githubToken, dependencies);
  dependencies.core.info(`Wrote secrets: ${inputs.accessTokenSecretName}, ${inputs.teamIdSecretName}`);
}
function validateInputs(inputs) {
  resolvePostmanApiHost(inputs.postmanStack);
  if (!inputs.postmanAccessToken && !inputs.postmanApiKey) {
    throw new Error("postman-api-key is required when postman-access-token is not provided.");
  }
  if (inputs.writeGithubSecret && !inputs.githubToken) {
    throw new Error("github-token is required when write-github-secret is 'true'. The default GITHUB_TOKEN cannot write repo secrets; use a PAT or GitHub App installation token with secrets write permission.");
  }
}
async function runResolveServiceToken(inputs, dependencies) {
  validateInputs(inputs);
  const apiHost = resolvePostmanApiHost(inputs.postmanStack);
  const skipped = Boolean(inputs.postmanAccessToken);
  const token = inputs.postmanAccessToken ?? await mintServiceToken(inputs, apiHost, dependencies.fetcher);
  dependencies.core.setSecret(token);
  if (skipped) {
    dependencies.core.info("Skipped mint - using provided postman-access-token.");
  }
  const teamId = inputs.postmanTeamId ?? await resolveTeamId(inputs, apiHost, token, dependencies.fetcher);
  if (inputs.postmanTeamId) {
    dependencies.core.info("Using provided postman-team-id.");
  }
  const result = { token, teamId, skipped };
  dependencies.core.setOutput("token", result.token);
  dependencies.core.setOutput("team-id", result.teamId);
  dependencies.core.setOutput("skipped", result.skipped ? "true" : "false");
  if (inputs.writeGithubSecret) {
    await writeGitHubSecrets(result, inputs, dependencies);
  }
  return result;
}
function createNodeExecFile(baseEnv = process.env) {
  return (file, args, options) => new Promise((resolve, reject) => {
    const child = (0, import_node_child_process.spawn)(file, args, {
      env: options?.env ? { ...baseEnv, ...options.env } : baseEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let interruptedSignal;
    const cleanupSignalHandlers = () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    };
    const handleSignal = (signal) => {
      interruptedSignal = signal;
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      cleanupSignalHandlers();
      reject(error);
    });
    child.on("close", (code) => {
      cleanupSignalHandlers();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (interruptedSignal) {
        reject(new Error(`Command interrupted by ${interruptedSignal}: ${file} ${args.join(" ")}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${file} ${args.join(" ")}${stderr ? `
${stderr}` : ""}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (options?.input !== void 0) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

// src/cli.ts
var cliInputNames = [
  "postman-api-key",
  "postman-access-token",
  "postman-team-id",
  "postman-stack",
  "write-github-secret",
  "access-token-secret-name",
  "team-id-secret-name",
  "github-token"
];
function readFlag(argv, name) {
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
  return void 0;
}
function applyArgsToEnv(argv, env) {
  for (const name of cliInputNames) {
    const value = readFlag(argv, name);
    if (value !== void 0) {
      env[`INPUT_${name.replace(/-/g, "_").toUpperCase()}`] = value;
    }
  }
}
var outputs = {};
var cliCore = {
  info(message) {
    console.error(message);
  },
  setOutput(name, value) {
    outputs[name] = value;
  },
  setSecret() {
  }
};
async function main() {
  const env = { ...process.env };
  applyArgsToEnv(process.argv, env);
  await runResolveServiceToken(readInputsFromEnv(env), {
    core: cliCore,
    fetcher: fetch,
    execFile: createNodeExecFile(env),
    env
  });
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}
`);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
