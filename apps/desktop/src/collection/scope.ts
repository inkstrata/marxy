// The palette's scope (C-10, ADR-0053): the current repository first, then the folders declared in
// collection.toml in file order, then the twelve recent roots. One entry per path; the earliest root
// in scope wins, so a folder nested in a repository is not listed twice.
import type { IndexEntry } from '@marxy/core';
import type { RootRank } from '../palette/search.ts';

/**
 * Entries across the whole scope. A placeholder held in app code, not in `INDEX_LIMITS`, so no
 * contract changes (ADR-0053 §5); each root keeps its own 50,000 (`INDEX_LIMITS.entriesPerRoot`).
 */
export const SCOPE_ENTRY_CAP = 100_000;

export interface ScopeInput {
  /** The open document's repository root; none when nothing is open. */
  readonly current?: string;
  /** collection.toml's folders, in file order. */
  readonly declared: readonly string[];
  /** The recent roots, most recent first. */
  readonly recent: readonly string[];
}

/** The roots in scope, in order: current, declared, recent; each root once, at its first place. */
export function scopeRoots({ current, declared, recent }: ScopeInput): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (root: string | undefined) => {
    if (root === undefined || seen.has(root)) return;
    seen.add(root);
    out.push(root);
  };
  add(current);
  for (const root of declared) add(root);
  for (const root of recent) add(root);
  return out;
}

export interface ScopedEntries {
  readonly entries: readonly IndexEntry[];
  /** The palette's notice line when the cap left entries out. */
  readonly notice?: string;
}

/**
 * Entries grouped in scope order, one per path (the earliest root in scope wins), and at most `cap`
 * of them: past the cap, the roots at the end of the scope go first. A root the index holds that is
 * not in scope (one opened earlier and no longer recent) follows the scope rather than vanishing.
 */
export function scopedEntries(
  entries: readonly IndexEntry[],
  scope: readonly string[],
  cap: number = SCOPE_ENTRY_CAP,
): ScopedEntries {
  const byRoot = new Map<string, IndexEntry[]>();
  for (const root of scope) byRoot.set(root, []);
  for (const entry of entries) {
    let group = byRoot.get(entry.root);
    if (group === undefined) {
      group = [];
      byRoot.set(entry.root, group);
    }
    group.push(entry);
  }
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  let omitted = 0;
  for (const group of byRoot.values()) {
    for (const entry of group) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      if (out.length < cap) out.push(entry);
      else omitted++;
    }
  }
  if (omitted === 0) return { entries: out };
  return {
    entries: out,
    notice: `Searching the first ${cap.toLocaleString('en-US')} files in scope; ${omitted.toLocaleString('en-US')} in later folders left out.`,
  };
}

/** Each root's place in `scope`; a root outside it ranks after every root in it. */
export function rootRank(scope: readonly string[]): RootRank {
  const rank = new Map<string, number>();
  for (let i = 0; i < scope.length; i++) rank.set(scope[i]!, i);
  const outside = scope.length;
  return (root) => rank.get(root) ?? outside;
}
