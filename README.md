# Postman Service Token Resolver

[![CI](https://github.com/postman-cs/postman-resolve-service-token-action/actions/workflows/ci.yml/badge.svg)](https://github.com/postman-cs/postman-resolve-service-token-action/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/postman-cs/postman-resolve-service-token-action?sort=semver)](https://github.com/postman-cs/postman-resolve-service-token-action/releases) [![npm](https://img.shields.io/npm/v/%40postman-cse%2Fonboarding-resolve-service-token)](https://www.npmjs.com/package/@postman-cse/onboarding-resolve-service-token) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Mints a Postman service-account access token and team ID in CI, ready to hand to the Postman onboarding actions or store as repo secrets.

## Usage

```yaml
jobs:
  resolve-token:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - id: postman_token
        uses: postman-cs/postman-resolve-service-token-action@v1
        with:
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
```

The step emits `outputs.token` and `outputs.team-id` for downstream steps. `postman-api-key` must be a **service-account** PMAK; the underlying `/service-account-tokens` endpoint rejects personal user keys.

## Examples

### Mint and hand off to the onboarding action

Replace the inline mint snippet in [`postman-cs/postman-service-account-onboarding-sample`](https://github.com/postman-cs/postman-service-account-onboarding-sample) with a single `uses:` call that feeds the onboarding action directly:

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
        uses: postman-cs/postman-resolve-service-token-action@v1
        with:
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}

      - uses: postman-cs/postman-api-onboarding-action@v1
        with:
          project-name: my-service
          spec-url: https://raw.githubusercontent.com/my-org/my-service/main/openapi.yaml
          spec-path: openapi.yaml
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
          postman-access-token: ${{ steps.postman_token.outputs.token }}
          postman-team-id: ${{ steps.postman_token.outputs.team-id }}
```

### Scheduled secret refresh

Run on a schedule with `write-github-secret: 'true'` to rotate `POSTMAN_ACCESS_TOKEN` for downstream workflows that read it from `secrets`:

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
      - uses: postman-cs/postman-resolve-service-token-action@v1
        with:
          postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
          write-github-secret: 'true'
          github-token: ${{ secrets.SECRETS_WRITE_PAT }}
```

Writing repo secrets requires `github-token` to be a PAT or GitHub App installation token with secrets write permission on the target repo; the workflow `GITHUB_TOKEN` cannot write repo secrets and will fail. Recommended: a fine-grained PAT scoped to the target repo with **Secrets: Read and write** plus **Metadata: Read**, stored as a separate secret such as `SECRETS_WRITE_PAT`. If your org restricts fine-grained PATs, a short-lived classic PAT with the `repo` scope works as a fallback.

### Pass through an existing token

Workflows that already store `POSTMAN_ACCESS_TOKEN` as a repo secret can adopt the action with no behavior change. When `postman-access-token` is provided the mint step is skipped and the value is returned verbatim; `postman-team-id` likewise skips the `/me` lookup:

```yaml
- id: postman_token
  uses: postman-cs/postman-resolve-service-token-action@v1
  with:
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-access-token: ${{ secrets.POSTMAN_ACCESS_TOKEN }}   # skip mint
    postman-team-id: ${{ secrets.POSTMAN_TEAM_ID }}             # skip /me
```

When both inputs are provided the action is effectively a passthrough with `outputs.skipped == 'true'`. Removing the input values switches the workflow back to fresh minting on every run.

### npm CLI

The same token resolution is available outside GitHub Actions:

```bash
npx @postman-cse/onboarding-resolve-service-token \
  --postman-api-key "$POSTMAN_API_KEY"
```

The CLI prints the action outputs as JSON:

```json
{
  "token": "pma_at_...",
  "team-id": "123456",
  "skipped": "false"
}
```

Flags match the action inputs:

```bash
postman-resolve-service-token \
  --postman-access-token "$POSTMAN_ACCESS_TOKEN" \
  --postman-team-id "$POSTMAN_TEAM_ID" \
  --write-github-secret false
```

Secret persistence via `--write-github-secret true` is GitHub-repo specific and requires `gh`, `GITHUB_REPOSITORY`, and `--github-token`.

### Beta stack

| `postman-stack` | API host |
| --- | --- |
| `prod` (default) | `https://api.getpostman.com` |
| `beta` | `https://api.getpostman-beta.com` |

`api.getpostman-beta.com` sits behind Postman Access. GitHub-hosted runners cannot reach it; use a self-hosted runner inside the Access perimeter for the `beta` stack. See [`postman-service-account-onboarding-sample`](https://github.com/postman-cs/postman-service-account-onboarding-sample) for the full beta runner setup.

## Inputs

<!-- inputs-table:start -->
| Name | Description | Required | Default |
| --- | --- | --- | --- |
| `postman-api-key` | Postman API key (PMAK) used to mint the service-account access token. Required when postman-access-token is not provided. | no |  |
| `postman-access-token` | Optional pre-existing Postman access token. When provided, the mint step is skipped and this value is returned via outputs.token. Use this to preserve compatibility with workflows that already manage the token externally. | no |  |
| `postman-team-id` | Optional pre-known Postman team ID. When provided, the team ID lookup is skipped and this value is returned via outputs.team-id. | no |  |
| `postman-stack` | Postman stack profile. One of: prod (api.getpostman.com) or beta (api.getpostman-beta.com). | no | `prod` |
| `write-github-secret` | When 'true', writes the resolved token and team ID to repo secrets named by access-token-secret-name and team-id-secret-name. Requires github-token to be a PAT (or GitHub App installation token) with secrets write permission on the target repo. The default GITHUB_TOKEN cannot write repo secrets. | no | `false` |
| `access-token-secret-name` | Repo secret name to receive the resolved access token. Used only when write-github-secret is 'true'. | no | `POSTMAN_ACCESS_TOKEN` |
| `team-id-secret-name` | Repo secret name to receive the resolved team ID. Used only when write-github-secret is 'true'. | no | `POSTMAN_TEAM_ID` |
| `github-token` | GitHub PAT or App installation token with secrets write permission on the target repo. Required when write-github-secret is 'true'. | no |  |
<!-- inputs-table:end -->

## Outputs

<!-- outputs-table:start -->
| Name | Description |
| --- | --- |
| `token` | Resolved Postman access token. Either minted or passed through from the postman-access-token input. |
| `team-id` | Resolved Postman team ID. Either looked up via /me or passed through from the postman-team-id input. |
| `skipped` | 'true' when the mint step was skipped because postman-access-token was provided as input. |
<!-- outputs-table:end -->

## How it works

This action is the producer side of the programmatic token flow that replaces the manual session-token extraction step described in [`postman-cs/postman-api-onboarding-action`](https://github.com/postman-cs/postman-api-onboarding-action). It calls the Postman `/service-account-tokens` endpoint with the service-account PMAK to mint a fresh access token, resolves the team ID via `/me`, and masks the token in logs.

Both lookups honor explicit overrides: a provided `postman-access-token` or `postman-team-id` is returned verbatim and the corresponding API call is skipped, so existing workflows that manage the token externally can adopt the action incrementally.

With `write-github-secret: 'true'` the resolved values are also written back to repo secrets (names configurable via `access-token-secret-name` and `team-id-secret-name`), which lets a scheduled run keep secrets fresh for every other workflow in the repo.

Releases follow the customer preview channel: immutable `v1.x.y` tags for reproducible pins, a rolling `v1` alias for the latest preview, and npm publishes with matching versions and provenance.

## Resources

- [postman-api-onboarding-action](https://github.com/postman-cs/postman-api-onboarding-action): composite action that orchestrates the onboarding pipeline
- [postman-bootstrap-action](https://github.com/postman-cs/postman-bootstrap-action): workspace, spec upload, collections, governance
- [postman-smoke-flow-action](https://github.com/postman-cs/postman-smoke-flow-action): applies a curated flow.yaml to the Smoke collection
- [postman-repo-sync-action](https://github.com/postman-cs/postman-repo-sync-action): artifact sync, environments, mocks, monitors
- [postman-insights-onboarding-action](https://github.com/postman-cs/postman-insights-onboarding-action): Insights-to-workspace linking
- [postman-aws-spec-discovery-action](https://github.com/postman-cs/postman-aws-spec-discovery-action): AWS API and spec discovery
- [@postman-cse/onboarding-resolve-service-token on npm](https://www.npmjs.com/package/@postman-cse/onboarding-resolve-service-token)
- [postman-service-account-onboarding-sample](https://github.com/postman-cs/postman-service-account-onboarding-sample): end-to-end sample workflows

## License

[MIT](LICENSE)
