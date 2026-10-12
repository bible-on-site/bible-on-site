import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mobileNpmDependencyHash } from './mobile-npm-cache-key.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mobile-npm-key-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['devops', 'app/mobile-e2e']) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'devops/package-lock.json'), 'devops');
  writeFileSync(join(root, 'app/mobile-e2e/package-lock.json'), 'mobile');
  return root;
}

for (const path of ['devops/package-lock.json', 'app/mobile-e2e/package-lock.json']) {
  test('invalidates the key when ' + path + ' changes', t => {
    const root = fixture(t);
    const original = mobileNpmDependencyHash(root);
    writeFileSync(join(root, path), 'changed');
    assert.notEqual(mobileNpmDependencyHash(root), original);
  });
}

test('ignores unrelated generated artifacts', t => {
  const root = fixture(t);
  const original = mobileNpmDependencyHash(root);
  mkdirSync(join(root, 'app/.artifacts'), { recursive: true });
  writeFileSync(join(root, 'app/.artifacts/unrelated'), 'generated output');
  assert.equal(mobileNpmDependencyHash(root), original);
});
