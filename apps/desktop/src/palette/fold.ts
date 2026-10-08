// One hit for a document that several checkouts of one repository each hold (C-15).
// A worktree is a full copy of the repository, so `AGENTS.md` is in the collection once per
// checkout. Copies that are the same file as far as the index can tell (same repository, same path
// inside it, same size and title) fold to one hit; a copy that differs in either stays in the list,
// so nothing the reader would want is hidden. Mtime is not compared: every checkout has its own.
// Run once on the assembled result of a typed query, never on the empty state.
import type { IndexHit } from '@marxy/core';

/** Where a path sits: its repository, its path inside its checkout, and the checkout itself. */
export interface CheckoutKey {
  /** `gitGroupKey`: the same for every checkout of one repository. */
  readonly group: string;
  /** The path relative to its checkout. */
  readonly rel: string;
  /** The checkout's directory. */
  readonly checkout: string;
}

/**
 * Folded hits keep the order of the list; each bucket takes the place of its first member.
 * `named` holds the folder names a query spelled out (`b/agents`): a copy in such a checkout is
 * listed as it is, never folded, so a folded copy is always one query away. `dropped[i]` is how many
 * copies folded into `hits[i]`.
 */
export function foldHitsCounted(
  hits: readonly IndexHit[],
  keyOf: (path: string) => CheckoutKey | undefined,
  currentCheckout: string | undefined,
  named: ReadonlySet<string> = new Set(),
): { hits: IndexHit[]; dropped: number[] } {
  const winner = new Map<string, { hit: IndexHit; dropped: number }>();
  const slots: (IndexHit | string)[] = [];
  for (const hit of hits) {
    const key = keyOf(hit.entry.path);
    if (key === undefined || named.has(key.checkout.slice(key.checkout.lastIndexOf('/') + 1).toLowerCase())) {
      slots.push(hit);
      continue;
    }
    const bucket = `${key.group}\0${key.rel}\0${hit.entry.size}\0${hit.entry.title}`;
    const held = winner.get(bucket);
    if (held === undefined) {
      winner.set(bucket, { hit, dropped: 0 });
      slots.push(bucket);
      continue;
    }
    held.dropped++;
    if (beats(hit, held.hit, keyOf, currentCheckout)) held.hit = hit;
  }
  const out: IndexHit[] = [];
  const dropped: number[] = [];
  for (const slot of slots) {
    if (typeof slot === 'string') {
      const w = winner.get(slot)!;
      out.push(w.hit);
      dropped.push(w.dropped);
    } else {
      out.push(slot);
      dropped.push(0);
    }
  }
  return { hits: out, dropped };
}

export function foldHits(
  hits: readonly IndexHit[],
  keyOf: (path: string) => CheckoutKey | undefined,
  currentCheckout: string | undefined,
  named?: ReadonlySet<string>,
): IndexHit[] {
  return foldHitsCounted(hits, keyOf, currentCheckout, named).hits;
}

/** The current checkout's copy, else the better score, else the newer file. */
function beats(
  a: IndexHit,
  b: IndexHit,
  keyOf: (path: string) => CheckoutKey | undefined,
  currentCheckout: string | undefined,
): boolean {
  if (currentCheckout !== undefined) {
    const aHere = keyOf(a.entry.path)?.checkout === currentCheckout;
    const bHere = keyOf(b.entry.path)?.checkout === currentCheckout;
    if (aHere !== bHere) return aHere;
  }
  if (a.score !== b.score) return a.score > b.score;
  return a.entry.mtimeMs > b.entry.mtimeMs;
}
