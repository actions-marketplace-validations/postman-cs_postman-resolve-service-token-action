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
npm ci && npm test && npm run typecheck && npm run build
npm run verify:dist         # rebuild + git diff + artifact assert
npm run verify:dist:assert  # read-only dist contract (CI after one build)
```

## Key Behaviors

- Mints short-lived service-account access token; token = suite's preferred Bifrost/governance credential, can expire, so this action runs first in CI.
- Resolves team ID by calling `GET /me` w/ minted token, reading team field, walking candidate paths (`credential-identity.ts`, memoized for run).
- `account_type` for this producer always `service` in suite telemetry.
- Outputs masked before logging; minted token never appears clear in logs or artifacts.

## Gotchas

- `main.ts` holds real token-exchange logic; `index.ts` = Action shell, `cli.ts` = non-GitHub adapter. Wire any pre-output logic into both entries.
- esbuild bundles `--target=node24`; `dist/` part of release integrity, verified by `verify:dist`/`verify:dist:assert` (CI + pre-push hook).
- `dist/cli.cjs` must stay executable in git index (`100755`); `npm run bundle` chmods it.

## CI

`.github/workflows/ci.yml` runs one `gate` job. Bundles once, queues at most two checks on one runner. Typecheck once. Dist read-only `verify:dist:assert`; no pack race. Every check prints `::group::` result even on failure.

See workspace-root `../../docs/CI.md` for shared rationale.

## Anti-Patterns

- Never hardcode secrets, tokens, or absolute paths in durable memory
