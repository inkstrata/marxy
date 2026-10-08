// Path helpers that do not import `node:`. The model must run in a browser (ADR-0020).

/**
 * True for a Windows path: a drive (`C:\` or `C:/`) or a UNC share (`\\host`). Core takes no platform
 * from Node, so the path says which separator rule applies: a backslash separates only in a Windows
 * path, and is an ordinary file-name character in every other (macOS and Linux) path.
 */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** Slash-normalised path without a trailing slash, except the filesystem root. */
export function normalizePath(path: string): string {
  const slash = isWindowsPath(path) ? path.replace(/\\/g, '/') : path;
  if (slash === '/' || slash === '') return '/';
  return slash.replace(/\/+$/, '') || '/';
}

/** Parent directory of `path`, or the path itself when it is already the root. */
export function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  const i = normalized.lastIndexOf('/');
  if (i < 0) return normalized;
  if (i === 0) return '/';
  return normalized.slice(0, i);
}

/** Final segment of `path`. */
export function basename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';
  const i = normalized.lastIndexOf('/');
  return i < 0 ? normalized : normalized.slice(i + 1);
}

/** Join `base` and `child`, keeping an absolute base absolute. */
export function joinPath(base: string, child: string): string {
  if (!child) return normalizePath(base);
  // Mixed platforms: a base that is a Windows path makes the child's backslashes separators; otherwise they are name characters.
  const windows = isWindowsPath(base);
  const kid = windows ? child.replace(/\\/g, '/') : child;
  if (kid.startsWith('/') || /^[A-Za-z]:\//.test(kid) || isWindowsPath(child)) return normalizePath(child);
  const left = normalizePath(base);
  if (left === '/') return normalizePath(`/${kid}`);
  return normalizePath(`${left}/${kid}`);
}

/**
 * `path` relative to `root` when `path` is `root` itself (`''`) or lies under it, else undefined.
 * Strict and lexical: after normalising, `path` must equal `root` or start with `root + '/'`, and a
 * `path` with a `.` or `..` segment is never under anything (it could climb out). A root is always a
 * folder, whatever its name looks like (`notes.d`, `site.v2`). The one test of containment for the
 * index: a walk, a watch event and a snapshot all ask it.
 */
export function pathUnder(root: string, path: string): string | undefined {
  const r = normalizePath(root);
  const p = normalizePath(path);
  if (p.split('/').some((segment) => segment === '..' || segment === '.')) return undefined;
  if (p === r) return '';
  const prefix = r === '/' ? '/' : `${r}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : undefined;
}

/** `path` is `root` or lies under it, by `pathUnder`'s rule. */
export function isUnderRoot(path: string, root: string): boolean {
  return pathUnder(root, path) !== undefined;
}

/**
 * `to` relative to the folder `from`, using `/`; `..` segments climb out of it. Lexical: `from` is
 * always taken as a folder, never guessed to be a file from its name.
 */
export function relativePath(from: string, to: string): string {
  const fromDir = normalizePath(from);
  const normTo = normalizePath(to);
  const a = fromDir === '/' ? [''] : fromDir.split('/');
  const b = normTo.split('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const up = a.length - i;
  const down = b.slice(i);
  if (up === 0 && down.length === 0) return '';
  return [...Array<string>(up).fill('..'), ...down].join('/');
}
