// Path helpers that do not import `node:`. The model must run in a browser (ADR-0020).

/** Slash-normalised path without a trailing slash, except the filesystem root. */
export function normalizePath(path: string): string {
  const slash = path.replace(/\\/g, '/');
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
  if (child.startsWith('/') || /^[A-Za-z]:\//.test(child.replace(/\\/g, '/'))) return normalizePath(child);
  const left = normalizePath(base);
  if (left === '/') return normalizePath(`/${child}`);
  return normalizePath(`${left}/${child}`);
}

/** `to` relative to `from`, using `/`. Both must be absolute or the same kind of relative. */
export function relativePath(from: string, to: string): string {
  const a = normalizePath(from).split('/');
  const b = normalizePath(to).split('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const up = a.length - i;
  const down = b.slice(i);
  if (up === 0 && down.length === 0) return '';
  return [...Array<string>(up).fill('..'), ...down].join('/');
}
