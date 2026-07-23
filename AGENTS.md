# postman-resolve-service-token-action

Credential producer for onboarding suite. Mints fresh service-account access token + resolves team ID in CI, ready to hand to onboarding action or store as repo secrets. Dual entry: GitHub Action (`dist/index.cjs`) + CLI (`dist/cli.cjs`, bin `postman-resolve-service-token`).

## Structure

```
src/
  index.ts                # Action entry: reads inputs, mints token, sets outputs
  cli.ts                  # CLI adapter; writes JSON/dotenv
  main.ts                 # Core: SA token exchange + team-ID resolution
  credential-identity.ts  # Session identity derivation (iapub + access token)
tests/
```

## Commands

```bash
npm ci && npm test && npm run typecheck && npm run lint
npm run verify:bundle  # build + runtime-shape check
```

## Key Behaviors

- Mints short-lived service-account access token; token = suite's preferred Bifrost/governance credential, can expire, so this action runs first in CI.
- Resolves team ID by calling `GET /me` w/ minted token, reading team field, walking candidate paths (`credential-identity.ts`, memoized for run).
- `account_type` for this producer always `service` in suite telemetry.
- Outputs masked before logging; minted token never appears clear in logs or artifacts.

## Gotchas

- `main.ts` holds real token-exchange logic; `index.ts` = Action shell, `cli.ts` = non-GitHub adapter. Wire any pre-output logic into both entries.
- esbuild bundles `--target=node24`; `dist/` is gitignored build output and is never committed on branches. `npm run bundle` chmods `dist/cli.cjs` executable.
- Release tags carry `dist/` on tag-only commit parented on reviewed main SHA; main never carries bundled bytes.

## CI

`.github/workflows/ci.yml` runs one `gate` job. It builds fresh, validates runtime shape with `scripts/verify-dist-artifact.mjs`, and queues checks on one runner. Every check prints `::group::` result even on failure.

See workspace-root `../../docs/CI.md` for shared rationale.

## Anti-Patterns

- Never hardcode secrets, tokens, or absolute paths in durable memory
