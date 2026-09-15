import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`, 'Release tag must be v<package.json version>');
assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version must match package.json');
const prerelease = pkg.version.split('+')[0].includes('-');
assert.equal(process.env.IS_PRERELEASE, String(prerelease), 'GitHub prerelease flag must match the package version');
const tag = prerelease ? 'next' : 'latest';
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `npm-tag=${tag}\n`);
console.log(`Validated ${pkg.name}@${pkg.version} for npm tag ${tag}`);
