# Release Policy

## Source of truth

Git tags and GitHub releases are the public release identifiers for this action. `package.json` versions support npm packaging, but consumers should select action versions by Git tag. The committed `dist/` bundle is part of the released artifact because GitHub Actions runs it verbatim from the tag.

## Tag policy

- Immutable releases use the exact `v<version>` tag matching `package.json`, and also `vN.M` when the package patch is zero.
- The rolling `vN` alias for the current major moves only to the latest compatible immutable release and never regresses to an older target.
- Existing immutable release tags are never force-pushed or rewritten.
- Every immutable release tag has a GitHub release with generated notes.

## Release checks

Run the package validators from this directory before pushing an immutable tag:

1. Confirm the working tree is clean.
2. `npm test`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run build`
6. `npm run verify:dist:assert` after one build (do not rebuild again for verification)
7. `npm run docs:tables` when `action.yml` changes, then confirm the `README.md` tables still match.
8. Confirm `SECURITY.md`, `SUPPORT.md`, and this file still describe the release surface.

## npm package

The CLI publishes as `@postman-cse/onboarding-resolve-service-token` with versions that match the immutable GitHub release tag. npm package identity is verified before the GitHub Release is created. The rolling `vN` alias updates the action channel and skips npm publishing.

## Compatibility

The current-major `vN` channel keeps action inputs and outputs compatible unless a security fix requires narrower behavior. New optional inputs can be added under `vN` when they preserve existing workflows.

## Security fixes

Security fixes ship on the latest immutable tag for the current major and move onto the rolling `vN` alias. Older immutable tags stay published for reproducibility. See [Security Policy](SECURITY.md).
