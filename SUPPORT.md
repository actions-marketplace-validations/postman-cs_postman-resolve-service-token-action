# Support

## Where To Ask

- For setup questions, open a GitHub issue in this repository.
- For bugs, include the action version tag, runner type, `postman-region`, and the failing step output with secrets redacted.
- For account, service-account, or data-residency questions, use your normal Postman support channel.

## Before Opening An Issue

1. Confirm `postman-api-key` is a service-account PMAK, not a personal user key.
2. Confirm `postman-region` matches the target Postman team.
3. If you pass `postman-access-token`, confirm the external rotation path is still valid. The recommended path is minting from `postman-api-key`.
4. If `write-github-secret` is enabled, confirm `github-token` can write repository secrets. The default `GITHUB_TOKEN` cannot write repo secrets.

## Sensitive Information

Never paste PMAKs, access tokens, GitHub tokens, or unredacted workflow logs into issues. Rotate any credential that was exposed.

## Related Docs

- [Security policy](SECURITY.md)
- [Release policy](RELEASE_POLICY.md)
- [Postman API Onboarding action](https://github.com/postman-cs/postman-api-onboarding-action)
