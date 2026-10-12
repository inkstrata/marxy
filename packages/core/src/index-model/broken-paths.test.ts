// Broken paths (Q-06): the paths a text names, and which of them are missing, through an injected `stat`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokenPaths, mentionsOf, resolveMention, type StatFn } from './broken-paths.ts';

/** A filesystem of folders and files; a name in `hidden` answers null as a symlink or a deny-listed folder does. */
function fs(files: readonly string[], hidden: readonly string[] = []): { stat: StatFn; asked: string[] } {
  const dirs = new Set<string>(['/']);
  for (const f of files) for (let at = f.lastIndexOf('/'); at > 0; at = f.lastIndexOf('/', at - 1)) dirs.add(f.slice(0, at));
  const asked: string[] = [];
  const stat: StatFn = async (path) => {
    asked.push(path);
    if (hidden.some((h) => path === h || path.startsWith(`${h}/`))) return null;
    if (files.includes(path)) return {};
    if (dirs.has(path)) return { isDir: true };
    return null;
  };
  return { stat, asked };
}

const FILES = ['/r/plans/plan.md', '/r/src/app.ts', '/r/docs/guide.md', '/r/vendor/lib/x.ts', '/home/me/notes/n.md'];

test('a missing file under a listed folder is broken; one under an unlisted folder is not checked, never broken', async () => {
  const { stat } = fs(FILES);
  assert.equal(await resolveMention('src/app.ts', '/r/plans/plan.md', '/r', null, stat), 'found', 'found in the repository root');
  assert.equal(await resolveMention('../docs/guide.md', '/r/plans/plan.md', '/r', null, stat), 'found', 'found beside the file');
  assert.equal(await resolveMention('src/gone.ts', '/r/README.md', '/r', null, stat), 'not-found', 'src is listed: missing');
  assert.equal(await resolveMention('plans/gone.md', '/r/plans/plan.md', '/r', null, stat), 'not-checked', 'looked for beside the file too, where plans/plans is not a folder: nothing is claimed');
  assert.equal(await resolveMention('../src/gone.ts', '/r/plans/plan.md', '/r', null, stat), 'not-checked', 'from the root it climbs out');
  assert.equal(await resolveMention('nowhere/gone.ts', '/r/plans/plan.md', '/r', null, stat), 'not-checked', 'nowhere is not a folder: nothing is claimed');
  // A folder `stat` hides (a symlink, a deny-listed name) is not listed: what is under it is not checked.
  const hidden = fs(FILES, ['/r/vendor']);
  assert.equal(await resolveMention('vendor/lib/gone.ts', '/r/plans/plan.md', '/r', null, hidden.stat), 'not-checked');
});

test('~/ paths need a home; a path that climbs out of its root is not checked', async () => {
  const { stat } = fs(FILES);
  assert.equal(await resolveMention('~/notes/n.md', '/r/plans/plan.md', '/r', null, stat), 'not-checked', 'no known home');
  assert.equal(await resolveMention('~/notes/n.md', '/r/plans/plan.md', '/r', '/home/me', stat), 'found');
  assert.equal(await resolveMention('~/notes/gone.md', '/r/plans/plan.md', '/r', '/home/me', stat), 'not-found');
  assert.equal(await resolveMention('../../etc/passwd.txt', '/r/plans/plan.md', '/r', null, stat), 'not-checked');
});

test('mentionsOf reads backticked paths in the prose only, LF or CRLF', () => {
  const text = '# Plan\r\n\r\nSee `src/app.ts` and `src/gone.ts`, and `src/app.ts` again.\r\n\r\n```\n`src/in-code.ts`\n```\r\n\r\nA bare src/bare.ts is not a mention.\r\n';
  assert.deepEqual(mentionsOf(text), ['src/app.ts', 'src/gone.ts']);
  assert.deepEqual(mentionsOf('no backticks/here.md at all'), []);
});

test('brokenPaths lists the missing paths in order, and counts what it could not check', async () => {
  const { stat } = fs(FILES);
  const result = await brokenPaths(['src/app.ts', 'src/gone.ts', 'nowhere/x.ts', 'docs/old.md'], '/r/README.md', '/r', null, stat);
  assert.deepEqual(result, { missing: ['src/gone.ts', 'docs/old.md'], notChecked: 1, mentioned: 4 });
  const throwing: StatFn = async () => {
    throw new Error('io');
  };
  assert.deepEqual(await brokenPaths(['src/app.ts'], '/r/README.md', '/r', null, throwing), { missing: [], notChecked: 1, mentioned: 1 }, 'a stat that fails claims nothing');
});
