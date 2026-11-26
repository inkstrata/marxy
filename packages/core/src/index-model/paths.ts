// Path helpers that do not import `node:`. The model must run in a browser.

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

/**
 * `path` normalised, with Windows' verbatim prefix dropped (`\\?\UNC\s\share\x` as `//s/share/x`, `\\?\C:\x` as `C:/x`),
 * to compare by. The watch canonicalises a share or a long path to its verbatim spelling, while a path from the open
 * dialog or a drop is plain, so the two name one file. Only for comparing: a path handed to the shell keeps its spelling.
 */
export function comparablePath(path: string): string {
  const p = normalizePath(path);
  if (p.startsWith('//?/UNC/')) return `//${p.slice('//?/UNC/'.length)}`;
  if (/^\/\/\?\/[A-Za-z]:(\/|$)/.test(p)) return p.slice('//?/'.length);
  return p;
}

/**
 * The one key every spelling of a file shares, for maps and comparisons keyed by file; never a path to hand the shell.
 *
 * A Windows path: slashes and the verbatim prefix as `comparablePath`, empty and `.` segments dropped and `..` taken back
 * a segment (Windows resolves them by spelling, never through a link, and not above the drive or share), and letters
 * folded to one case. A letter folds only when its upper case is one unit that comes back to it (`é`/`É`); one that
 * would merge with another letter (`ı`, `ſ`) or grow (`ß`) stays exact, so two files are never taken for one.
 *
 * Any other absolute path: empty and `.` segments dropped; the case and `..` (which a link can send elsewhere) are kept.
 * Anything else is its own key.
 */
export function fileKey(path: string): string {
  if (!isWindowsPath(path)) {
    if (!path.startsWith('/')) return path;
    return `/${path.split('/').filter((s) => s !== '' && s !== '.').join('/')}`;
  }
  const p = comparablePath(path);
  let root: string;
  let rest: string[];
  if (p.startsWith('//')) {
    const [server = '', share = '', ...tail] = p.slice(2).split('/');
    root = `//${server}/${share}`;
    rest = tail;
  } else {
    const [drive = '', ...tail] = p.split('/');
    root = drive;
    rest = tail;
  }
  const kept: string[] = [];
  for (const segment of rest) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') kept.pop();
    else kept.push(segment);
  }
  return foldUnits(`${root}/${kept.join('/')}`);
}

/** Whether `a` and `b` name one file by their spelling (`fileKey`). */
export function sameFilePath(a: string, b: string): boolean {
  return a === b || fileKey(a) === fileKey(b);
}

function foldUnits(path: string): string {
  let out = '';
  for (let i = 0; i < path.length; i++) {
    const unit = path[i]!;
    const upper = unit.toUpperCase();
    out += upper.length === 1 && upper.toLowerCase() === unit.toLowerCase() ? upper : unit;
  }
  return out;
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
 * `path` with a `.` or `..` segment is never under anything (it could climb out), nor is one with an
 * empty segment below the root (`/a//b`: no walk lists such a path, and it names no entry). A root is always a
 * folder, whatever its name looks like (`notes.d`, `site.v2`). The one test of containment for the
 * index: a walk, a watch event and a snapshot all ask it.
 */
export function pathUnder(root: string, path: string): string | undefined {
  const r = normalizePath(root);
  const p = normalizePath(path);
  if (p.split('/').some((segment) => segment === '..' || segment === '.')) return undefined;
  if (p === r) return '';
  const prefix = r === '/' ? '/' : `${r}/`;
  if (!p.startsWith(prefix)) return undefined;
  const rel = p.slice(prefix.length);
  return rel.split('/').some((segment) => segment === '') ? undefined : rel;
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
