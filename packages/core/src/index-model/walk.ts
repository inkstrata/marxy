// Host-injected walk: skip deny-listed directories, honour ignore files, never follow symlinks.

import { isDeniedName } from './deny.ts';
import { type IgnoreRule, isIgnored, parseIgnore } from './ignore.ts';
import type { IndexCandidate } from './entry.ts';
import { joinPath, pathUnder } from './paths.ts';
import { pushAll } from '../util/spread.ts';

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
  /**
   * The reader's deny globs (`collection.toml`), checked after the root's own ignore rules and
   * apart from them, so no `.gitignore` negation can bring a denied path back. The built-in deny
   * list still wins over everything.
   */
  readonly extraRules?: readonly IgnoreRule[];
  /**
   * Filled with each folder the ignore rules or the deny globs left out, outermost only (nothing is listed under
   * one), so the tree watch can leave the same folders out. Folders the built-in deny list skips are not added:
   * the shell skips those by name.
   */
  readonly ignoredDirs?: string[];
}

/**
 * Collect every file under `root`. Never descends into `node_modules` (or the rest of
 * the deny list), even when a `.gitignore` tries to un-ignore them.
 */
export function collectFiles(root: string, reader: DirectoryReader, options: WalkOptions = {}): IndexCandidate[] {
  const rules: IgnoreRule[] = [];
  loadIgnore(reader, root, '', rules);
  const extra = options.extraRules ?? [];
  const denied = (rel: string, isDir: boolean) =>
    isIgnored(rel, isDir, rules) || (extra.length > 0 && isIgnored(rel, isDir, extra));
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
      if (entry.isDir && isDeniedName(entry.name)) continue;
      // Any `.` or `..` segment is refused, as the watch path does: `foo/../../x.md` does not start with `../`.
      const rel = pathUnder(root, entry.path);
      if (rel === undefined) continue;
      if (entry.isDir) {
        loadIgnore(reader, entry.path, rel, rules);
        if (denied(rel, true)) {
          options.ignoredDirs?.push(entry.path);
          continue;
        }
        stack.push(entry.path);
        continue;
      }
      // Every file is listed but the index's own ignore rules, which are the walk's settings, not a document.
      if (entry.name === '.gitignore' || entry.name === '.ignore') continue;
      if (denied(rel, false)) continue;
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
    if (text !== undefined) pushAll(rules, parseIgnore(text, relDir));
  }
}
