import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(testDir, '..', 'vendor');

test('vendored bootstrap CLI matches its provenance manifest', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(vendorDir, 'postman-bootstrap-cli.manifest.json'), 'utf8')
  );
  const cli = await readFile(path.join(vendorDir, 'postman-bootstrap-cli.cjs'));

  assert.equal(manifest.package, '@postman-cse/onboarding-bootstrap');
  assert.equal(manifest.version, '2.9.9');
  assert.match(manifest.npmIntegrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(createHash('sha256').update(cli).digest('hex'), manifest.cliSha256);
});
