# Release Policy

## Versioning

Releases use immutable `v1.x.y` tags and a rolling `v1` major tag. Pin `v1.x.y` for maximum reproducibility, or use `v1` to receive compatible fixes.

Git tags are the release source of truth. `package.json` versions are used for npm publishing metadata and do not replace release tags.

## Compatibility

The `v1` channel keeps action inputs and outputs compatible unless a security fix requires a narrower behavior. New optional inputs may be added in `v1` when they preserve existing workflows.

## Bundles

Published action tags include the compiled `dist/` bundle. Source changes that affect runtime behavior must pass `npm run check:dist` before release.

## npm

The CLI package is published as `@postman-cse/onboarding-resolve-service-token` with versions that match the GitHub release tag.

## Security Fixes

Security fixes are released on the latest `v1.x.y` tag and moved onto the rolling `v1` tag. Older immutable tags stay published for reproducibility.
