# postman-resolve-service-token-action

Credential producer for the onboarding suite. Mints a fresh service-account access token and resolves the team ID in CI, ready to hand to the onboarding action or store as repo secrets. Dual entry: GitHub Action (`dist/index.cjs`) and CLI (`dist/cli.cjs`, bin `postman-resolve-service-token`).

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
npm run verify:dist  # CI/hook gate: rebuild + git diff (dev runs build)
```

## Key Behaviors

- Mints a short-lived service-account access token; the token is the suite's preferred Bifrost/governance credential and can expire, so this action is meant to run first in CI.
- Resolves team ID by calling `GET /me` with the minted token and reading the team field out of the response, walking a list of candidate paths (`credential-identity.ts`, memoized for the run).
- `account_type` for this producer is always `service` in suite telemetry.
- Outputs are masked before logging; the minted token never appears in clear in logs or artifacts.

## Gotchas

- `main.ts` holds the real token-exchange logic; `index.ts` is the GitHub Action shell and `cli.ts` the non-GitHub adapter. Wire any pre-output logic into both entries.
- esbuild bundles `--target=node24`; `dist/` is part of release integrity and is verified by `verify:dist` (CI + pre-push hook).

## CI

`.github/workflows/ci.yml` runs a single `gate` job that fans out lint, test, typecheck, dist, commitlint, and actionlint
as backgrounded shell processes on one runner: wall-clock is `max(gate)`, not
`sum`, setup runs once, and every gate prints its result under a `::group::`
block even when another fails.

See the workspace `docs/CI.md` for the shared rationale.
