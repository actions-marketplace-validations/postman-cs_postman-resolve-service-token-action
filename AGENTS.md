# postman-resolve-service-token-action

Credential producer for onboarding suite. Mints fresh service-account access token and resolves team ID in CI, ready to hand to onboarding action or store as repo secrets. Dual entry: GitHub Action (`dist/index.cjs`) and CLI (`dist/cli.cjs`, bin `postman-resolve-service-token`).

## Structure

```
src/
  index.ts                # GitHub Action entry: reads inputs, mints token, sets outputs
  cli.ts                  # CLI adapter for non-GitHub CI; writes JSON/dotenv
  main.ts                 # Core: service-account token exchange + team-ID resolution
  credential-identity.ts  # Session identity derivation (iapub + access token)
tests/                    # vitest unit tests
```

## Commands

```bash
npm ci && npm test && npm run typecheck && npm run build
npm run verify:dist         # rebuild + git diff + artifact assert (hooks/local)
npm run verify:dist:assert  # read-only dist contract (CI after one build)
```

## Key Behaviors

- Mints short-lived service-account access token; token is suite's preferred Bifrost/governance credential and can expire, so this action is meant to run first in CI.
- Resolves team ID by calling `GET /me` with minted token and reading team field out of response, walking list of candidate paths (`credential-identity.ts`, memoized for run).
- `account_type` for this producer is always `service` in suite telemetry.
- Outputs are masked before logging; minted token never appears in clear in logs or artifacts.

## Gotchas

- `main.ts` holds real token-exchange logic; `index.ts` is GitHub Action shell and `cli.ts` non-GitHub adapter. Wire any pre-output logic into both entries.
- esbuild bundles `--target=node24`; `dist/` is part of release integrity and is verified by `verify:dist` / `verify:dist:assert` (CI + pre-push hook).
- `dist/cli.cjs` must stay executable in git index (`100755`); `npm run bundle` chmods it.

## CI

`.github/workflows/ci.yml` runs single `gate` job. Setup installs deps/tools,
then `npm run build` runs once before fan-out so `dist/` is present for pack
tests. Job then fans out lint, test, typecheck, read-only
`verify:dist:assert`, commitlint, and actionlint as backgrounded shell
processes on one runner: wall-clock is `max(gate)`, not `sum`, and every gate
prints its result under a `::group::` block even when another fails. Building
before fan-out prevents pack tests from racing parallel `rm -rf dist`.

See workspace-root `../../docs/CI.md` for shared rationale.
