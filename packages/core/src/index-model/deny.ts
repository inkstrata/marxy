// Built-in deny list. Indexing `node_modules` once would destroy the speed claim.

/** Directory names the walker never descends into. A gitignore `!` cannot undo these. */
export const DENY_DIRECTORY_NAMES: readonly string[] = [
  'node_modules',
  'target',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  '.git',
  '__pycache__',
  '.next',
  '.turbo',
  'coverage',
];

const denied = new Set(DENY_DIRECTORY_NAMES);

/**
 * True when this name is a deny-listed directory name, in any (ASCII) case: on a case-insensitive volume `Build` is
 * `build`, and the desktop shell's copies (`commands/fs.rs` and the rest) match it so. Ask it of a folder only: a file
 * named `build` or `out` is a file.
 */
export function isDeniedName(name: string): boolean {
  return denied.has(name.replace(/[A-Z]+/g, (c) => c.toLowerCase()));
}

/**
 * True when a folder of a root-relative path is deny-listed: every segment but the last, and the last too when the
 * path is itself a directory (`isDir`). Used as a last line after a walk, so a host that failed to skip `node_modules`
 * still cannot index it.
 */
export function isDeniedPath(relativePath: string, isDir = false): boolean {
  if (!relativePath) return false;
  const segments = normalizeSegments(relativePath);
  const folders = isDir ? segments : segments.slice(0, -1);
  return folders.some(isDeniedName);
}

function normalizeSegments(relativePath: string): string[] {
  return relativePath.split('/').filter((segment) => segment.length > 0);
}
