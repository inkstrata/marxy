// Which words of a changed line changed. In a run of removed lines followed by added lines, each added line is paired
// with the removed line most like it, and the words the two do not share are the ones to mark. A line with no likely
// partner is left whole: a rewrite is not a word change. Pure; no DOM.

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** Words, runs of space, and each other character on its own. It stops after `limit` tokens, so a long line costs the limit. */
export function wordTokens(text: string, limit = Infinity): string[] {
  const out: string[] = [];
  const re = new RegExp(TOKEN.source, TOKEN.flags);
  // Every alternative matches at least one character, so the loop always advances.
  while (out.length < limit) {
    const m = re.exec(text);
    if (m === null) break;
    out.push(m[0]);
  }
  return out;
}

export interface WordPair {
  /** Indices into the removed and the added lines. */
  readonly del: number;
  readonly add: number;
  readonly delTokens: readonly string[];
  readonly addTokens: readonly string[];
  /** Per token: true where it is not in the other line. */
  readonly delChanged: readonly boolean[];
  readonly addChanged: readonly boolean[];
}

/** Past these, a run or a line is left whole: pairing is quadratic and a very long line is not read word by word. */
const MAX_RUN = 40;
const MAX_TOKENS = 400;
/** A pair shares at least this share of its words, or it is two different lines. */
const LIKE = 0.4;

const isSpace = (t: string): boolean => /^\s+$/u.test(t);

function common(a: readonly string[], b: readonly string[]): { keepA: boolean[]; keepB: boolean[]; sameWords: number } {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const table = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
    }
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let sameWords = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      keepA[i] = keepB[j] = true;
      if (!isSpace(a[i]!)) sameWords++;
      i++;
      j++;
    } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) i++;
    else j++;
  }
  return { keepA, keepB, sameWords };
}

/** The pairs to mark between a run of removed lines and the run of added lines after it (marker characters left off). */
export function pairChangedLines(dels: readonly string[], adds: readonly string[]): WordPair[] {
  if (dels.length === 0 || adds.length === 0 || dels.length > MAX_RUN || adds.length > MAX_RUN) return [];
  // One token past the cap is enough to know a line is too long to read word by word.
  const delTokens = dels.map((line) => wordTokens(line, MAX_TOKENS + 1));
  const addTokens = adds.map((line) => wordTokens(line, MAX_TOKENS + 1));
  const words = (ts: readonly string[]): number => ts.filter((t) => !isSpace(t)).length;
  const used = new Set<number>();
  const pairs: WordPair[] = [];
  for (let add = 0; add < addTokens.length; add++) {
    const at = addTokens[add]!;
    if (at.length > MAX_TOKENS) continue;
    let best = -1;
    let bestScore = 0;
    let bestKeep: ReturnType<typeof common> | null = null;
    for (let del = 0; del < delTokens.length; del++) {
      const dt = delTokens[del]!;
      if (used.has(del) || dt.length > MAX_TOKENS) continue;
      const r = common(dt, at);
      const score = r.sameWords / Math.max(words(dt), words(at), 1);
      if (score > bestScore) [best, bestScore, bestKeep] = [del, score, r];
    }
    if (best < 0 || !bestKeep || bestScore < LIKE) continue;
    const keep = bestKeep;
    const delChanged = delTokens[best]!.map((t, k) => !keep.keepA[k] && !isSpace(t));
    const addChanged = at.map((t, k) => !keep.keepB[k] && !isSpace(t));
    // Lines that differ only in space are left whole too: nothing word-sized changed.
    if (!delChanged.includes(true) && !addChanged.includes(true)) continue;
    used.add(best);
    pairs.push({ del: best, add, delTokens: delTokens[best]!, addTokens: at, delChanged, addChanged });
  }
  return pairs;
}
