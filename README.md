# postman-resolve-service-token-action

Public open-alpha composite GitHub Action that mints a Postman service-account access token, resolves the team ID, and optionally writes both back to repo secrets.

This action is the producer side of the new programmatic token flow that replaces the manual session-token extraction step described in [`postman-cs/postman-api-onboarding-action`](https://github.com/postman-cs/postman-api-onboarding-action). Mint a fresh access token in CI, hand it to the onboarding action by output, or persist it as a repo secret for other workflows to consume.

## When to use

- **Inline minting per run.** Replace the inline mint snippet in [`postman-cs/postman-service-account-onboarding-sample`](https://github.com/postman-cs/postman-service-account-onboarding-sample) with a single `uses:` call that emits `outputs.token` and `outputs.team-id` for the next step.
- **Scheduled refresh.** Run this action on a schedule with `write-github-secret: true` to rotate `POSTMAN_ACCESS_TOKEN` for downstream workflows that read it from `secrets`.
- **Backward compatibility.** Pass an existing token through `postman-access-token` to skip the mint step entirely. The action returns the value verbatim, so workflows that already manage the token can adopt the action with no behavior change.

## Quick start

### Inline (mint, hand off to onboarding action)

```yaml
jobs:
  onboarding:
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: write
    steps:
      - uses: actions/checkout@v5

      - id: postman_token
        uses: postman-cs/postman-resolve-service-token-action@v0
        with:
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}

      - uses: postman-cs/postman-api-onboarding-action@v0
        with:
          project-name: my-service
          spec-path: openapi.yaml
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
          postman-access-token: ${{ steps.postman_token.outputs.token }}
          postman-team-id: ${{ steps.postman_token.outputs.team-id }}
```

### Scheduled refresh (write `POSTMAN_ACCESS_TOKEN` for other workflows)

```yaml
name: Refresh Postman service-account token

on:
  schedule:
    - cron: '0 6 * * *'   # daily at 06:00 UTC
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: postman-cs/postman-resolve-service-token-action@v0
        with:
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
          write-github-secret: 'true'
          github-token: ${{ secrets.SECRETS_WRITE_PAT }}
```

## Inputs

| Input | Default | Notes |
| --- | --- | --- |
| `postman-api-key` | | Postman API key (PMAK) used to mint the access token. Required when `postman-access-token` is not provided. |
| `postman-access-token` | | Optional pre-existing access token. When set, the mint step is skipped and the value is returned verbatim. Use this to preserve existing workflows that manage the token externally. |
| `postman-team-id` | | Optional pre-known team ID. When set, the `/me` lookup is skipped and the value is returned verbatim. |
| `postman-stack` | `prod` | One of `prod` (`api.getpostman.com`) or `beta` (`api.getpostman-beta.com`). |
| `write-github-secret` | `'false'` | When `'true'`, writes the resolved token and team ID to repo secrets. |
| `access-token-secret-name` | `POSTMAN_ACCESS_TOKEN` | Secret name to receive the access token. Used only when `write-github-secret` is `'true'`. |
| `team-id-secret-name` | `POSTMAN_TEAM_ID` | Secret name to receive the team ID. Used only when `write-github-secret` is `'true'`. |
| `github-token` | | PAT or GitHub App installation token with secrets write permission on the target repo. Required when `write-github-secret` is `'true'`. The default `GITHUB_TOKEN` cannot write repo secrets. |

## Outputs

| Output | Description |
| --- | --- |
| `token` | Resolved Postman access token (masked in logs). Either freshly minted or the passed-through value of `postman-access-token`. |
| `team-id` | Resolved Postman team ID. Either looked up via `/me` or the passed-through value of `postman-team-id`. |
| `skipped` | `'true'` when the mint step was skipped because `postman-access-token` was provided. |

## Permissions and secrets

### Minting only (default)

The default mode requires only `postman-api-key`. No GitHub permissions beyond what your job already has.

### Writing repo secrets

`write-github-secret: 'true'` requires `github-token` to be a PAT or GitHub App installation token with **secrets write** permission on the target repo. The workflow `GITHUB_TOKEN` cannot write repo secrets and will fail.

**Recommended:** create a fine-grained PAT scoped to the target repo with the **Secrets: Read and write** permission, store it as a separate secret (for example `SECRETS_WRITE_PAT`), and pass it via `github-token`.

## Backward compatibility

Workflows that already store `POSTMAN_ACCESS_TOKEN` as a repo secret and pass it directly to downstream actions can adopt this action without disruption:

```yaml
- id: postman_token
  uses: postman-cs/postman-resolve-service-token-action@v0
  with:
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-access-token: ${{ secrets.POSTMAN_ACCESS_TOKEN }}   # skip mint
    postman-team-id: ${{ secrets.POSTMAN_TEAM_ID }}             # skip /me
```

When both inputs are provided, the action is effectively a passthrough with `outputs.skipped == 'true'`. Removing the input values switches the workflow to fresh minting on every run.

## Stack selection

| `postman-stack` | API host |
| --- | --- |
| `prod` (default) | `https://api.getpostman.com` |
| `beta` | `https://api.getpostman-beta.com` |

`api.getpostman-beta.com` sits behind Postman Access. GitHub-hosted runners cannot reach it; use a self-hosted runner inside the Access perimeter for the `beta` stack. See [`postman-service-account-onboarding-sample`](https://github.com/postman-cs/postman-service-account-onboarding-sample) for the full beta runner setup.

## Open-alpha release strategy

- Open-alpha channel tags use `v0.x.y`.
- Pin immutable tags such as `v0.1.0` for reproducibility.
- Moving tag `v0` is the rolling open-alpha channel.

## License

[MIT](LICENSE)
