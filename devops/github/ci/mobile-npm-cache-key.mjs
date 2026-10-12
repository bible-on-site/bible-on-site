// Read only the two dependency inputs. A glob traversal competes with cold
// simulator startup and once consumed the runner's full hashFiles deadline.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function mobileNpmDependencyHash(root) {
  const hash = createHash('sha256');
  for (const path of ['devops/package-lock.json', 'app/mobile-e2e/package-lock.json']) {
    hash.update(path + '\0');
    hash.update(readFileSync(resolve(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hash = mobileNpmDependencyHash(fileURLToPath(new URL('../../../', import.meta.url)));
  appendFileSync(process.env.GITHUB_OUTPUT, 'hash=' + hash + '\n');
  console.log('Mobile npm dependency hash: ' + hash);
}
