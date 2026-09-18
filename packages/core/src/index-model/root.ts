// Nearest ancestor with `.git`, else the opened file's directory (ADR-0012).

import { dirname, normalizePath } from './paths.ts';

/** Probe the host uses to answer filesystem questions without the model importing `node:`. */
export interface RootProbe {
  /** True when `dir/.git` exists as a file or a directory (worktrees use a file). */
  hasGit(dir: string): boolean;
  /** True when `path` itself is a directory. */
  isDirectory(path: string): boolean;
}

/**
 * The indexed root for an opened path: the nearest ancestor that contains `.git`,
 * otherwise the file's own directory.
 */
export function detectIndexRoot(openedPath: string, probe: RootProbe): string {
  const normalized = normalizePath(openedPath);
  const startDir = probe.isDirectory(normalized) ? normalized : dirname(normalized);
  let dir = startDir;
  for (;;) {
    if (probe.hasGit(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
