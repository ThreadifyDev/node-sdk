import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const output = path.resolve('.release');
fs.mkdirSync(output, { recursive: true });
const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', output], { encoding: 'utf8' }));
const files = new Set(packed.files.map(file => file.path));
for (const required of ['src/index.js', 'dist/index.cjs', 'index.d.ts', 'README.md']) {
  assert.ok(files.has(required), `Package missing ${required}`);
}
for (const file of files) {
  assert.ok(!/^(tests|examples|\.github|\.release)\//.test(file), `Unexpected package file: ${file}`);
}
const archive = path.join(output, 'package.tgz');
fs.renameSync(path.join(output, packed.filename), archive);
const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'threadify-package-'));
try {
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], {cwd: consumer, stdio: 'inherit'});
  const checks = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { Threadify as esm } from '@threadify/sdk';
    const { Threadify: cjs } = createRequire(import.meta.url)('@threadify/sdk');
    assert.equal(typeof esm.connect, 'function');
    assert.equal(typeof cjs.connect, 'function');
  `;
  fs.writeFileSync(path.join(consumer, 'check.mjs'), checks);
  execFileSync(process.execPath, ['check.mjs'], {cwd: consumer, stdio: 'inherit'});
  console.log(`Verified packed ESM and CommonJS entry points: ${archive}`);
} finally {
  fs.rmSync(consumer, {recursive: true, force: true});
}
