// Folds docs/taste-review/queue.d/ fragments into docs/taste-review/queue.md's table, in key
// order, and deletes the fragments it folded in. Optional entries only: nothing requires one
// (MARXY-324). The format lives in scripts/lib/taste-queue.mjs.
// usage: node scripts/taste-queue.mjs --fold [--root DIR]
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fix } from './lib/repo.mjs';
import { QUEUE_DIR, QUEUE_FILE, queueFragmentPath, validQueueFragment, sortFragmentNames, foldRows } from './lib/taste-queue.mjs';

export function fold({ root = ROOT } = {}) {
  const dir = join(root, QUEUE_DIR);
  const names = existsSync(dir) ? sortFragmentNames(readdirSync(dir)) : [];
  const rows = names.map(n => {
    const key = n.replace(/\.md$/, '');
    const text = readFileSync(join(dir, n), 'utf8');
    if (!validQueueFragment(text, key)) {
      throw new Error(`${queueFragmentPath(key)} is not one queue table row for ${key}${fix('docs/taste-review/queue.d/README.md has the rule')}`);
    }
    return text.trim();
  });
  if (!rows.length) return { folded: 0, files: [] };
  const queuePath = join(root, QUEUE_FILE);
  writeFileSync(queuePath, foldRows(readFileSync(queuePath, 'utf8'), rows));
  for (const n of names) rmSync(join(dir, n));
  return { folded: names.length, files: names };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (!process.argv.includes('--fold')) {
    console.error(`usage: node scripts/taste-queue.mjs --fold${fix('folds queue.d/ fragments into queue.md')}`);
    process.exit(1);
  }
  try {
    const i = process.argv.indexOf('--root');
    const { folded } = fold(i >= 0 ? { root: process.argv[i + 1] } : {});
    console.log(`taste-queue ok: folded ${folded} fragment(s) into ${QUEUE_FILE}`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
