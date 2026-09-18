// Host-injected walk: skip deny-listed directories, honour ignore files, never follow symlinks.

import { isDeniedName } from './deny.ts';
import { type IgnoreRule, isIgnored, parseIgnore } from './ignore.ts';
import type { IndexCandidate } from './entry.ts';
import { classify } from './kinds.ts';
import { joinPath, relativePath } from './paths.ts';

/** One directory listing. The host fills this from `readdir`; the model does not import `node:`. */
export interface WalkEntry {
  readonly name: string;
  readonly path: string;
  readonly isDir: boolean;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface DirectoryReader {
  readDir(absPath: string): readonly WalkEntry[];
  readText(absPath: string): string | undefined;
}

export interface WalkOptions {
  /** Soft cap used as a stop-early hint. Ceiling still runs on the result. */
  readonly limit?: number;
}

/**
 * Collect allow-listed files under `root`. Never descends into `node_modules` (or the rest of
 * the deny list), even when a `.gitignore` tries to un-ignore them.
 */
export function collectFiles(root: string, reader: DirectoryReader, options: WalkOptions = {}): IndexCandidate[] {
  const rules: IgnoreRule[] = [];
  loadIgnore(reader, root, '', rules);
  const out: IndexCandidate[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let listing: readonly WalkEntry[];
    try {
      listing = reader.readDir(dir);
    } catch {
      continue;
    }
    for (const entry of listing) {
      if (isDeniedName(entry.name)) continue;
      const rel = relativePath(root, entry.path);
      if (rel.startsWith('../')) continue;
      if (entry.isDir) {
        loadIgnore(reader, entry.path, rel, rules);
        if (isIgnored(rel, true, rules)) continue;
        stack.push(entry.path);
        continue;
      }
      if (!classify(entry.path) && !classify(rel)) continue;
      if (isIgnored(rel, false, rules)) continue;
      out.push({
        path: entry.path,
        relativePath: rel,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
      });
      if (options.limit !== undefined && out.length >= options.limit) return out;
    }
  }
  return out;
}

function loadIgnore(reader: DirectoryReader, absDir: string, relDir: string, rules: IgnoreRule[]): void {
  for (const name of ['.gitignore', '.ignore'] as const) {
    const text = reader.readText(joinPath(absDir, name));
    if (text !== undefined) rules.push(...parseIgnore(text, relDir));
  }
}
