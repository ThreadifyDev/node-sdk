# npm releases

These workflows belong to `ThreadifyDev/node-sdk` (the SDK repository root),
not the parent Engine repository.

Pull requests and pushes to `main` run `.github/workflows/ci.yml` on Node 22 and
24. The checks install locked dependencies, build CommonJS, run the SDK tests,
and install an actual npm tarball into a temporary project to verify ESM and
CommonJS imports. They do not require a running Threadify engine.

Publishing a GitHub release triggers `.github/workflows/npm-publish.yml`.
Its verification job requires the release tag to equal `v<package.json version>`
and the lockfile to contain that same version. It runs tests and package checks,
then uploads the tested tarball. The separate publishing job publishes that exact
tarball with npm provenance. Stable releases use `latest`; prerelease versions
such as `0.2.0-beta.1` require the GitHub prerelease flag and use `next`.

## One-time configuration

In the npm settings for `@threadify/sdk`, add a GitHub Actions trusted publisher:

- Organization: `ThreadifyDev`
- Repository: `node-sdk`
- Workflow filename: `npm-publish.yml`
- Environment: `npm`
- Allow direct publishing with `npm publish`.

Create the GitHub environment `npm` to match. This workflow uses GitHub-hosted
runners and Node 24, with a compatible bundled npm CLI (11.5.1 or later).
Authentication uses OIDC; no `NPM_TOKEN` secret is required.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Release a version

1. Run `npm version <version> --no-git-tag-version` to update both manifests.
2. Update the changelog, commit the SDK changes, and push them to GitHub.
3. Publish a GitHub release with tag `v<version>` pointing at that commit.
4. Confirm the Publish npm package workflow succeeds.

For local verification, run `npm ci`, `npm test`, and `npm run test:package`.
The final command writes `.release/package.tgz`. Nothing is published locally.
A version already published to npm cannot be overwritten; use a new version for
new package contents. The workflow does not automatically bump versions.
