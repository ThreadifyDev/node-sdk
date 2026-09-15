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
tarball directly with npm provenance. Stable releases use `latest`; prerelease versions
such as `0.2.0-beta.1` require the GitHub prerelease flag and use `next`.

## One-time configuration

In the npm settings for `@threadify/sdk`, add a GitHub Actions trusted publisher:

- Organization: `ThreadifyDev`
- Repository: `node-sdk`
- Workflow filename: `npm-publish.yml`
- Environment: leave blank.
- Allow direct publishing with `npm publish`.

No GitHub environment is configured for this workflow. It uses GitHub-hosted
runners, Node 24, and npm 11.19.0, which supports trusted publishing.
Authentication uses OIDC; no `NPM_TOKEN` secret is required.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Release a version

1. Run `npm version <version> --no-git-tag-version` to update both manifests.
2. Update the changelog, commit the SDK changes, and push them to GitHub.
3. Publish a GitHub release with tag `v<version>` pointing at that commit.
4. Confirm the Publish npm package workflow succeeds and the version appears on npm.

No manual staging approval is needed. Pushing a commit or tag alone does not
publish; the trigger is a published GitHub release.

For local verification, run `npm ci`, `npm test`, and `npm run test:package`.
The final command writes `.release/package.tgz`. Nothing is published locally.
A staged version also reserves its version number. Review an existing staged
version before retrying its release. A version already published to npm cannot be
overwritten; use a new version for new package contents. The workflow does not
automatically bump versions.
