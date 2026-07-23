# Release Policy

## Source of truth

Git tags and GitHub releases are the public release identifiers for this action. `package.json` versions support npm packaging, but consumers should select action versions by Git tag. `dist/` is gitignored build output and is never committed on branches or main. Release tags carry the bundle because GitHub Actions runs it verbatim from the tag.

## Tag policy

- Immutable releases use the exact `v<version>` tag matching `package.json`, and also `vN.M` when the package patch is zero.
- The rolling `vN` alias for the current major moves only to the latest compatible immutable release and never regresses to an older target.
- Existing immutable release tags are never force-pushed or rewritten.
- Every immutable release tag has a GitHub release with generated notes.

## Release checks

Cut an immutable release with the Release workflow's `workflow_dispatch` event and its `version` input. The workflow:

1. Checks out the reviewed main SHA and runs `npm ci`, `npm run bundle`, and the package gates.
2. Commits `dist/` onto a tag-only commit whose parent is that main SHA; main remains untouched.
3. Creates annotated tag `v<version>` on that commit and pushes only the tag.
4. Checks out the tag in `verify-package` (ubuntu) and `verify-package-windows` (windows-latest); both consume committed tag bytes with no rebuild. Windows asserts dist present and untouched before and after `node --run test`.
5. Publish runs only when both verify jobs succeed, then publishes npm with provenance and advances the rolling `v1` alias.

The parent relationship is the audit link to reviewed source. The release bytes reproduce with `npm ci && npm run bundle` at the tag commit's parent. A bare tag without committed `dist/` fails artifact verification.

## npm package

The CLI publishes as `@postman-cse/onboarding-resolve-service-token` with versions that match the immutable GitHub release tag. npm package identity is verified before the GitHub Release is created. The rolling `vN` alias updates the action channel and skips npm publishing.

## Compatibility

The current-major `vN` channel keeps action inputs and outputs compatible unless a security fix requires narrower behavior. New optional inputs can be added under `vN` when they preserve existing workflows.

## Security fixes

Security fixes ship on the latest immutable tag for the current major and move onto the rolling `vN` alias. Older immutable tags stay published for reproducibility. See [Security Policy](SECURITY.md).
