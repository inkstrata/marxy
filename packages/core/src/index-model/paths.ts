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
  const windows = isWindowsPath(base);
  const kid = windows ? child.replace(/\\/g, '/') : child;
  if (kid.startsWith('/') || /^[A-Za-z]:\//.test(kid) || isWindowsPath(child)) return normalizePath(child);
  const left = normalizePath(base);
  if (left === '/') return normalizePath(`/${kid}`);
  return normalizePath(`${left}/${kid}`);
}

/** True when `child` is `parent` or a strict descendant path (segment-safe, after normalisation). */
function isPathUnder(child: string, parent: string): boolean {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  if (p === '/') return c.startsWith('/');
  return c === p || c.startsWith(`${p}/`);
}

/**
 * `to` relative to `from`, using `/`. Both must be absolute or the same kind of relative.
 * `from` must be a directory path; if a document path is passed by mistake, it is resolved via
 * `dirname(from)` when `to` lies under that directory but not under the mistaken path.
 */
export function relativePath(from: string, to: string): string {
  const normFrom = normalizePath(from);
  const normTo = normalizePath(to);
  let fromDir = normFrom;
  if (!isPathUnder(normTo, normFrom) && normTo !== normFrom) {
    const parent = dirname(normFrom);
    // Only a path that reads as a file (its last segment has an extension) is taken as a mistaken
    // file path; `/a/docs` and `/a/docs2/x.md` are siblings, and the second is outside the first.
    const looksLikeFile = /.\.[^./]+$/.test(basename(normFrom));
    if (looksLikeFile && (isPathUnder(normTo, parent) || normTo === parent)) fromDir = parent;
  }
  const a = fromDir === '/' ? [''] : fromDir.split('/');
  const b = normTo.split('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const up = a.length - i;
  const down = b.slice(i);
  if (up === 0 && down.length === 0) return '';
  return [...Array<string>(up).fill('..'), ...down].join('/');
}
