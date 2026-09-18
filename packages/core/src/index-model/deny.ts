// Built-in deny list. Indexing `node_modules` once would destroy the speed claim (ADR-0012).

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

/** True when this path segment is a deny-listed directory name. */
export function isDeniedName(name: string): boolean {
  return denied.has(name);
}

/**
 * True when any segment of a root-relative path is deny-listed. Used as a last line after a
 * walk, so a host that failed to skip `node_modules` still cannot index it.
 */
export function isDeniedPath(relativePath: string): boolean {
  if (!relativePath) return false;
  return normalizeSegments(relativePath).some((segment) => denied.has(segment));
}

function normalizeSegments(relativePath: string): string[] {
  return relativePath.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
}
