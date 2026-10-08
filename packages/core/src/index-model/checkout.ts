// Which checkout a file belongs to, and which repository that checkout is a copy of (C-15).
// A repository can be checked out many times (`git worktree`): every copy holds the same documents.
// These two functions name the checkout and the repository; the palette folds copies by them.
// Pure and host-injected, like the rest of the index model: the host says where `.git` is.

import { dirname, isWindowsPath, joinPath, normalizePath, pathUnder } from './paths.ts';

/**
 * The checkout that holds `path`: the nearest ancestor directory, `root` included and nothing above
 * it, whose listing has a `.git` (a directory in a main checkout, a file in a worktree). `root`
 * itself when none does. A path outside `root` belongs to `root`'s checkout as far as this goes.
 */
export function checkoutOf(path: string, root: string, hasDotGit: (dir: string) => boolean): string {
  const top = normalizePath(root);
  let dir = dirname(path);
  // Strict containment, not a string prefix: `/rx/a.md` is not under `/r`.
  if (pathUnder(top, dir) === undefined) return top;
  for (;;) {
    if (hasDotGit(dir)) return dir;
    if (dir === top) return top;
    const parent = dirname(dir);
    if (parent === dir) return top;
    dir = parent;
  }
}

/** `a/b/../c` as `a/c`: the dots a `.git` file's relative `gitdir:` carries. Lexical, as everything here. */
function collapseDots(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') {
      if (out.length > 1 || (out.length === 1 && out[0] !== '')) out.pop();
    } else if (part !== '.' && !(part === '' && out.length > 0)) out.push(part);
  }
  const joined = out.join('/');
  return joined === '' ? '/' : joined;
}

/**
 * The key shared by every checkout of one repository. A `.git` directory is its own repository's
 * key, `<checkout>/.git`. A `.git` file reads `gitdir: X` (relative to the checkout when it is not
 * absolute); the key is `X` with a trailing `/worktrees/<name>` removed, so a worktree and its main
 * checkout agree. Text with no `gitdir:` line keys the checkout alone.
 */
export function gitGroupKey(checkoutDir: string, dotGitFileText: string | undefined): string {
  const own = `${normalizePath(checkoutDir)}/.git`.replace(/^\/\//, '/');
  if (dotGitFileText === undefined) return own;
  const line = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(dotGitFileText.replace(/\r/g, ''));
  if (line === null) return own;
  const target = line[1]!;
  const absolute = target.startsWith('/') || isWindowsPath(target);
  const full = collapseDots(absolute ? normalizePath(target) : joinPath(checkoutDir, target));
  return full.replace(/\/worktrees\/[^/]+$/, '');
}
