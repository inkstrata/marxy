// Every changelog.d/ fragment is one line ending in (ID), and ID is the file name's key, case
// included: `u-05.md` holding a line that ends `(U-05)` makes `changelog.mjs --release` throw (F-62).
// usage: node scripts/check-changelog.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, fix } from './lib/repo.mjs';
import { FRAGMENT_DIR, fragmentProblem } from './lib/changelog.mjs';

export function problems(root = ROOT) {
  const dir = join(root, FRAGMENT_DIR);
  return readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => fragmentProblem(`${FRAGMENT_DIR}/${f}`, readFileSync(join(dir, f), 'utf8')))
    .filter(Boolean);
}

if (import.meta.main) {
  const bad = problems();
  if (fail(bad)) { console.error(fix('git mv the file to the id its line ends in (changelog.d/README.md has the rule)')); process.exit(1); }
  console.log('check-changelog ok');
}
