// The library's two checks (Q-06): near-duplicates (`is:dup`) and broken paths (`is:broken`). Run on request only, when
// a query or a sidebar built-in asks, never at index time; nothing is written to the index or its snapshot (ADR-0012: the
// index holds no contents) and nothing is written to the reader's files. What a check learns is kept in memory for the
// session, each file's facts with the stamp (mtime and size) of the file they came from, so a file is read again only when
// it changed.
//
// What is read, and how: only the files a check needs. Near-duplicates reads the candidates the index alone pairs (same name
// once copy marks are off, or same title, sizes within reach: core's `candidatePairs`); broken paths reads the Markdown and
// text files of the scope, since only reading says which paths a file names. Reads go through `shell.readHead` (at most
// 256 KB of a file, as the library's measures do), never `readFile`, which arms the stale-write guard: a check must never be
// able to make a later save of the reader's file refuse. Existence is asked with `shell.stat` only. Nothing leaves the
// machine. A run is held to `CONTENT_SEARCH_LIMITS.maxTotalBytes`; past it the files not reached are counted, not guessed.
//
// Off the main thread and off the redraw path: the reads are the shell's; cutting shingles and parsing for path mentions run in
// the checks' worker (checks.worker.ts, the page only where no worker can run); the rest (scores, stats, bookkeeping) runs in
// slices of about three milliseconds shared by the concurrent readers, yielding to the page between them (as the sidebar's
// counts do, Q-07), so the palette and the field keep answering while a check runs. A newer request aborts an older one.
import type { IndexEntry } from '@marxy/core';
import { CONTENT_SEARCH_LIMITS } from '@marxy/core/src/index-model/content-search.ts';
import { brokenPaths, type StatFn } from '@marxy/core/src/index-model/broken-paths.ts';
import {
  DEFAULT_DUP_THRESHOLD,
  fillBuckets,
  pairsOfBuckets,
  groupDuplicates,
  MAX_DUP_THRESHOLD,
  MIN_DUP_THRESHOLD,
  similarity,
  type DupGroup,
  type ScoredPair,
} from '@marxy/core/src/index-model/near-dup.ts';
import type { DupFacts } from '@marxy/core/src/index-model/query-eval.ts';
import type { AppHandle } from '../app.ts';
import { MEASURE_READ_BYTES, type ReadHead } from './measure.ts';
import { digestOnPage, workerDigest, type Digest } from './checks-digest.ts';

/** What the checks need of the app: a bounded read, a stat, the home folder, and where a file's paths are resolved. */
export interface ChecksDeps {
  readonly read: ReadHead;
  readonly stat: StatFn;
  /** The home folder for `~/` paths, or null when it is not known (those paths are then not checked). */
  home(): Promise<string | null>;
  /** The folder a file's paths are resolved against besides its own: the Links tab's (its repository root). */
  rootOf(entry: IndexEntry): string;
  /** The palette's folded-copy key (C-15): two worktree copies with the same key are one file, not near copies. */
  copyKey?(entry: IndexEntry): string | undefined;
  /** Where a file's bytes become shingles and path mentions: the checks' worker in the app, the page by default. */
  readonly digest?: Digest;
}

export interface CheckOptions {
  readonly signal?: AbortSignal;
  /** Called as files are read, with the counts so far. */
  readonly onProgress?: (done: number, of: number) => void;
  /** Bytes a run may read (default `CONTENT_SEARCH_LIMITS.maxTotalBytes`). */
  readonly budgetBytes?: number;
}

export interface BrokenOptions extends CheckOptions {
  /** Files the near-duplicate check will want too: their shingles are cut from the same read, so no file is read twice. */
  readonly alsoShingles?: ReadonlySet<string>;
}

/** What one run of the near-duplicate check found over a set of entries. */
export interface DupRun {
  readonly entries: readonly IndexEntry[];
  readonly scored: readonly ScoredPair[];
  /** Candidate files read (or already held) and scored. */
  readonly read: number;
  /** Candidate files. */
  readonly of: number;
  /** The read budget ran out before every candidate was read. */
  readonly overBudget: boolean;
  /** Candidates read only in part (their first 256 KB): their scores are of that part. */
  readonly cut: ReadonlySet<string>;
}

/** What one run of the broken-path check found. */
export interface BrokenRun {
  readonly entries: readonly IndexEntry[];
  /** The files that name a missing path, with those paths, in the order of `entries`. */
  readonly broken: ReadonlyMap<string, readonly string[]>;
  readonly checked: number;
  /** Markdown and text files asked about: the only ones that can name a path. */
  readonly of: number;
  readonly overBudget: boolean;
  /** The files actually checked (a run stopped by its budget leaves some out): what a later query may reuse. */
  readonly checkedPaths: ReadonlySet<string>;
  /** Files checked only in their first 256 KB: a path named after it is not seen. */
  readonly cut: ReadonlySet<string>;
}

/** The kinds of file whose prose can name a path (`pathMentions` is a Markdown rule). */
export const canNamePaths = (e: IndexEntry): boolean => e.kind === 'markdown' || e.kind === 'text';

const SLICE_MS = 3;
/** Entries put in buckets between two looks at the clock. */
const BUCKET_SLICE = 1000;
const CONCURRENCY = 6;

/**
 * One turn of the event loop for the page (input, paint) before the work goes on. One channel serves every turn: a new
 * MessageChannel per turn cost WebKit a pause of about 45 ms every few hundred turns, under load, to collect the ports.
 */
let turnChannel: MessageChannel | null = null;
const turnWaiters: Array<() => void> = [];
const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => {
    // Node (the tests) runs a port's messages back to back, ahead of its timers; its own turn is setImmediate.
    const immediate = (globalThis as { setImmediate?: (cb: () => void) => unknown }).setImmediate;
    if (immediate !== undefined) {
      immediate(resolve);
      return;
    }
    if (turnChannel === null) {
      turnChannel = new MessageChannel();
      turnChannel.port1.onmessage = () => {
        for (const wake of turnWaiters.splice(0)) wake();
      };
    }
    turnWaiters.push(resolve);
    if (turnWaiters.length === 1) turnChannel.port2.postMessage(0);
  });

/**
 * A clock for slices: `maybeYield` gives the page a turn once the current slice has held the thread for `SLICE_MS`. It is
 * shared by the concurrent readers of a run: while one turn is pending every reader waits for it before more work, so the
 * readers cannot each finish one more file before the page gets its turn (under load that stacked to 50 ms).
 */
class Slicer {
  private from = performance.now();
  private pending: Promise<void> | null = null;
  /** The longest stretch the thread was held between two turns (ms): what the measurements report. */
  longest = 0;
  async maybeYield(): Promise<void> {
    if (this.pending === null) {
      const held = performance.now() - this.from;
      if (held < SLICE_MS) return;
      this.longest = Math.max(this.longest, held);
      this.pending = yieldToUi().then(() => {
        this.from = performance.now();
        this.pending = null;
      });
    }
    await this.pending;
  }
  end(): void {
    this.longest = Math.max(this.longest, performance.now() - this.from);
  }
}

const stampOf = (e: IndexEntry): string => `${e.mtimeMs}:${e.size}`;

interface FileFacts {
  readonly stamp: string;
  /** Only the first `MEASURE_READ_BYTES` were read: the file is longer. */
  cut?: boolean;
  shingles?: Uint32Array;
  mentions?: readonly string[];
}

const EMPTY = new Uint8Array(0);

/** The checks for one app instance: what they learnt, file by file, and the reader's threshold for the session. */
export class LibraryChecks {
  private readonly deps: ChecksDeps;
  private readonly files = new Map<string, FileFacts>();
  private thresholdNow = DEFAULT_DUP_THRESHOLD;
  private readonly thresholdListeners = new Set<() => void>();
  private lastDup: DupRun | null = null;
  private lastBroken: BrokenRun | null = null;
  /** Every path asked of `read`, in order (tests and measurements). */
  readonly readLog: string[] = [];
  /** The longest the thread was held between two turns in the last run, in milliseconds. */
  longestSliceMs = 0;

  constructor(deps: ChecksDeps) {
    this.deps = deps;
  }

  /** The similarity at which two files are near copies, for the session (the banner moves it; a setting comes with W-12). */
  get threshold(): number {
    return this.thresholdNow;
  }

  set threshold(value: number) {
    const v = Math.max(MIN_DUP_THRESHOLD, Math.min(MAX_DUP_THRESHOLD, Math.round(value)));
    if (v === this.thresholdNow) return;
    this.thresholdNow = v;
    for (const cb of [...this.thresholdListeners]) cb();
  }

  onThreshold(cb: () => void): () => void {
    this.thresholdListeners.add(cb);
    return () => this.thresholdListeners.delete(cb);
  }

  /** The last near-duplicate run, if it was over exactly these entries (the same array). */
  dupFor(entries: readonly IndexEntry[]): DupRun | null {
    return this.lastDup?.entries === entries ? this.lastDup : null;
  }

  /** The last near-duplicate run over whatever entries, or null when none has run: the palette's preview chip (W-13) reads it and never starts one. */
  latestDup(): DupRun | null {
    return this.lastDup;
  }

  /** The last broken-path run, if it was over exactly these entries. */
  brokenFor(entries: readonly IndexEntry[]): BrokenRun | null {
    return this.lastBroken?.entries === entries ? this.lastBroken : null;
  }

  private facts(entry: IndexEntry): FileFacts | undefined {
    const f = this.files.get(entry.path);
    return f !== undefined && f.stamp === stampOf(entry) ? f : undefined;
  }

  /**
   * Reads what `need` asks of each entry not yet known, `CONCURRENCY` at a time, slicing the work between reads. Returns how
   * many have it now and whether the budget stopped the run. A file that cannot be read, or is binary, has empty facts.
   */
  private async learn(
    entries: readonly IndexEntry[],
    need: 'shingles' | 'mentions',
    slicer: Slicer,
    opts: BrokenOptions,
  ): Promise<{ readonly known: number; readonly overBudget: boolean }> {
    const budget = opts.budgetBytes ?? CONTENT_SEARCH_LIMITS.maxTotalBytes;
    // What is still to learn, sorted out in slices: 50,000 lookups at once are a frame on a loaded machine.
    const todo: IndexEntry[] = [];
    for (let at = 0; at < entries.length; at += BUCKET_SLICE) {
      for (const e of entries.slice(at, at + BUCKET_SLICE)) if (this.facts(e)?.[need] === undefined) todo.push(e);
      await slicer.maybeYield();
    }
    let known = entries.length - todo.length;
    let bytes = 0;
    let overBudget = false;
    let next = 0;
    const aborted = (): boolean => opts.signal?.aborted === true;
    opts.onProgress?.(known, entries.length);
    const worker = async (): Promise<void> => {
      while (!aborted()) {
        if (bytes >= budget) {
          overBudget = true;
          return;
        }
        const entry = todo[next++];
        if (entry === undefined) return;
        this.readLog.push(entry.path);
        let data: Uint8Array | null = null;
        try {
          data = await this.deps.read(entry.path, MEASURE_READ_BYTES);
        } catch {
          data = null;
        }
        if (aborted()) return;
        bytes += data?.length ?? 0;
        // The costly part (shingles, the parse for path mentions) is the digest's: the worker's in the app.
        const got = await (this.deps.digest ?? digestOnPage)(data ?? EMPTY, {
          shingles: need === 'shingles' || opts.alsoShingles?.has(entry.path) === true,
          mentions: need === 'mentions',
        });
        if (aborted()) return;
        await slicer.maybeYield();
        if (aborted()) return;
        const held = this.facts(entry) ?? { stamp: stampOf(entry) };
        held.cut = data !== null && data.length >= MEASURE_READ_BYTES && entry.size > data.length;
        if (got.shingles !== undefined) held.shingles = got.shingles;
        if (got.mentions !== undefined) held.mentions = got.mentions;
        this.files.set(entry.path, held);
        known++;
        opts.onProgress?.(known, entries.length);
        await slicer.maybeYield();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    return { known, overBudget };
  }

  /**
   * The pairs the index alone makes of `entries`, and the files in them: what the near-duplicate check reads. Made in slices
   * of `BUCKET_SLICE` entries (50,000 names at once held the thread for about 60 ms).
   */
  async dupCandidates(entries: readonly IndexEntry[], slicer: Slicer = new Slicer()): Promise<{ readonly pairs: Array<readonly [number, number]>; readonly files: IndexEntry[] }> {
    const buckets = new Map<string, number[]>();
    for (let at = 0; at < entries.length; at += BUCKET_SLICE) {
      fillBuckets(entries, buckets, at, Math.min(entries.length, at + BUCKET_SLICE));
      await slicer.maybeYield();
    }
    const pairs = pairsOfBuckets(entries, buckets, { copyKey: this.deps.copyKey });
    const wanted = new Set<number>();
    for (const [a, b] of pairs) {
      wanted.add(a);
      wanted.add(b);
    }
    return { pairs, files: [...wanted].sort((a, b) => a - b).map((i) => entries[i]!) };
  }

  /** The near-duplicate check over `entries`: the index pairs candidates, only they are read, every pair is scored. */
  async runDups(entries: readonly IndexEntry[], opts: CheckOptions = {}): Promise<DupRun | null> {
    const slicer = new Slicer();
    const { pairs, files: candidates } = await this.dupCandidates(entries, slicer);
    await slicer.maybeYield();
    const learnt = await this.learn(candidates, 'shingles', slicer, opts);
    if (opts.signal?.aborted) return null;
    const scored: ScoredPair[] = [];
    for (const [a, b] of pairs) {
      const sa = this.facts(entries[a]!)?.shingles;
      const sb = this.facts(entries[b]!)?.shingles;
      if (sa === undefined || sb === undefined) continue;
      scored.push({ a, b, similarity: similarity(sa, sb) });
      await slicer.maybeYield();
      if (opts.signal?.aborted) return null;
    }
    slicer.end();
    this.longestSliceMs = slicer.longest;
    const cut = new Set(candidates.filter((e) => this.facts(e)?.cut === true).map((e) => e.path));
    const run: DupRun = { entries, scored, read: learnt.known, of: candidates.length, overBudget: learnt.overBudget, cut };
    this.lastDup = run;
    return run;
  }

  /** The broken-path check over the Markdown and text files of `entries`. */
  async runBroken(entries: readonly IndexEntry[], opts: BrokenOptions = {}): Promise<BrokenRun | null> {
    const slicer = new Slicer();
    const named: IndexEntry[] = [];
    for (let at = 0; at < entries.length; at += BUCKET_SLICE) {
      for (const e of entries.slice(at, at + BUCKET_SLICE)) if (canNamePaths(e)) named.push(e);
      await slicer.maybeYield();
    }
    const learnt = await this.learn(named, 'mentions', slicer, opts);
    if (opts.signal?.aborted) return null;
    const home = await this.deps.home().catch(() => null);
    // One stat per path in a run: many files name the same folders.
    const asked = new Map<string, ReturnType<StatFn>>();
    // Each new stat gives the page its turn first if one is due: a file can name many paths.
    const stat: StatFn = (p) => {
      let held = asked.get(p);
      if (held === undefined) {
        held = slicer.maybeYield().then(() => this.deps.stat(p));
        asked.set(p, held);
      }
      return held;
    };
    const broken = new Map<string, readonly string[]>();
    const checkedPaths = new Set<string>();
    const cut = new Set<string>();
    let checked = 0;
    for (const e of named) {
      const facts = this.facts(e);
      const mentions = facts?.mentions;
      if (mentions === undefined) continue;
      checked++;
      checkedPaths.add(e.path);
      if (facts?.cut === true) cut.add(e.path);
      if (mentions.length === 0) continue;
      const result = await brokenPaths(mentions, e.path, this.deps.rootOf(e), home, stat);
      if (opts.signal?.aborted) return null;
      if (result.missing.length > 0) broken.set(e.path, result.missing);
      await slicer.maybeYield();
    }
    slicer.end();
    this.longestSliceMs = Math.max(this.longestSliceMs, slicer.longest);
    const run: BrokenRun = { entries, broken, checked, of: named.length, overBudget: learnt.overBudget, checkedPaths, cut };
    this.lastBroken = run;
    return run;
  }

  /** The scores of two entries of a run, from its pairs or, for two members reached through a chain, from their shingles. */
  private scorer(run: DupRun): (a: number, b: number) => number | undefined {
    const known = new Map<string, number>();
    for (const p of run.scored) known.set(`${Math.min(p.a, p.b)},${Math.max(p.a, p.b)}`, p.similarity);
    return (a, b) => {
      const id = `${Math.min(a, b)},${Math.max(a, b)}`;
      const held = known.get(id);
      if (held !== undefined) return held;
      const sa = this.facts(run.entries[a]!)?.shingles;
      const sb = this.facts(run.entries[b]!)?.shingles;
      if (sa === undefined || sb === undefined) return undefined;
      const s = similarity(sa, sb);
      known.set(id, s);
      return s;
    };
  }

  /** The groups of a run at the session's threshold (or `threshold`). */
  groups(run: DupRun, threshold: number = this.thresholdNow): DupGroup[] {
    return groupDuplicates(run.entries, run.scored, threshold, this.scorer(run));
  }

  /** What the evaluator is given for `is:dup`: each grouped file, its group and the others with their similarity to it. */
  dupFacts(run: DupRun, threshold: number = this.thresholdNow): Map<string, DupFacts> {
    const score = this.scorer(run);
    const index = new Map<IndexEntry, number>();
    run.entries.forEach((e, i) => index.set(e, i));
    const out = new Map<string, DupFacts>();
    for (const g of this.groups(run, threshold)) {
      const group = g.members[0]!.entry.path;
      for (const m of g.members) {
        const i = index.get(m.entry)!;
        out.set(m.entry.path, {
          group,
          copies: g.members.filter((o) => o !== m).map((o) => ({
            path: o.entry.path,
            similarity: score(i, index.get(o.entry)!) ?? null,
            partial: run.cut.has(m.entry.path) || run.cut.has(o.entry.path),
          })),
        });
      }
    }
    return out;
  }
}

/** How far a built-in's check got: all of its files, or `checked` of `of` (the read budget stopped the run). */
export interface BuiltinCount {
  readonly count: number;
  /** Null when every file was checked; otherwise the count is a floor ("at least"). */
  readonly partial: { readonly checked: number; readonly of: number } | null;
}

/**
 * The sidebar's two built-ins (Q-06): how many files have broken paths and how many groups of near copies the library
 * holds, made off the redraw path. `request` is cheap: it compares the entries with those of the last run and, when they
 * differ, runs both checks after a quiet moment (never later than `MAX_WAIT_MS` after the first request). Until a run lands,
 * the old counts show. A newer request aborts a run under way.
 *
 * A run its read budget stopped keeps that fact (the counts are floors, and the row says so) and is followed, after a quiet
 * moment, by another over the same entries: the files already read are not read again, so each run goes on from where the
 * last one stopped, until every file has been checked once and the counts are whole (commitment 4).
 */
export class BuiltinCounts {
  private readonly checks: LibraryChecks;
  private readonly onChange: () => void;
  private readonly budgetBytes: number | undefined;
  private doneFor: { entries: readonly IndexEntry[]; threshold: number } | null = null;
  private wanted: readonly IndexEntry[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAskedAt = 0;
  private abort: AbortController | null = null;
  private running: Promise<void> = Promise.resolve();
  private held: { readonly broken: BuiltinCount; readonly dupGroups: BuiltinCount } | null = null;
  /** Runs begun (tests): a request that changes nothing begins none. */
  runs = 0;
  static readonly QUIET_MS = 400;
  static readonly MAX_WAIT_MS = 3000;

  constructor(checks: LibraryChecks, onChange: () => void, opts: { readonly budgetBytes?: number } = {}) {
    this.checks = checks;
    this.onChange = onChange;
    this.budgetBytes = opts.budgetBytes;
  }

  /** The counts, or null before the first run lands. */
  get(): { readonly broken: BuiltinCount; readonly dupGroups: BuiltinCount } | null {
    return this.held;
  }

  /** Asks for counts over `entries`; null (the section is folded) drops what is waiting and keeps the counts. */
  request(entries: readonly IndexEntry[] | null): void {
    if (entries === null) {
      this.cancel();
      return;
    }
    const threshold = this.checks.threshold;
    if (this.doneFor?.entries === entries && this.doneFor.threshold === threshold) return;
    if (this.wanted === entries && this.timer !== null) return;
    this.wanted = entries;
    const at = Date.now();
    if (this.timer === null) this.firstAskedAt = at;
    else if (at - this.firstAskedAt < BuiltinCounts.MAX_WAIT_MS) clearTimeout(this.timer);
    else return;
    this.timer = setTimeout(() => this.start(), this.held === null ? 0 : BuiltinCounts.QUIET_MS);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.wanted = null;
    this.abort?.abort();
    this.abort = null;
  }

  /** Resolves when no run is under way or waiting (tests). */
  async settled(): Promise<void> {
    for (;;) {
      const run = this.running;
      await run;
      if (run === this.running && this.timer === null) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private start(): void {
    this.timer = null;
    const entries = this.wanted;
    if (entries === null) return;
    this.wanted = null;
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    this.runs++;
    const threshold = this.checks.threshold;
    const budget = this.budgetBytes === undefined ? {} : { budgetBytes: this.budgetBytes };
    this.running = (async () => {
      // One read per file: the near-duplicate candidates' shingles are cut while their paths are read.
      const alsoShingles = new Set((await this.checks.dupCandidates(entries)).files.map((e) => e.path));
      if (controller.signal.aborted) return;
      const broken = await this.checks.runBroken(entries, { signal: controller.signal, alsoShingles, ...budget });
      if (broken === null || controller.signal.aborted) return;
      const dups = await this.checks.runDups(entries, { signal: controller.signal, ...budget });
      if (dups === null || controller.signal.aborted) return;
      const next = {
        broken: { count: broken.broken.size, partial: broken.overBudget ? { checked: broken.checked, of: broken.of } : null },
        dupGroups: { count: this.checks.groups(dups, threshold).length, partial: dups.overBudget ? { checked: dups.read, of: dups.of } : null },
      };
      const whole = next.broken.partial === null && next.dupGroups.partial === null;
      if (whole) this.doneFor = { entries, threshold };
      if (JSON.stringify(this.held) !== JSON.stringify(next)) {
        this.held = next;
        this.onChange();
      }
      // Stopped by the budget: go on from there after a quiet moment, unless something newer was asked for.
      if (!whole && this.timer === null && this.abort === controller) {
        this.wanted = entries;
        this.firstAskedAt = Date.now();
        this.timer = setTimeout(() => this.start(), BuiltinCounts.QUIET_MS);
      }
    })().catch((error: unknown) => {
      console.warn('marxy: the library checks failed', error);
    });
  }
}

/** The checks for the running app, made on first use and again for a newer app instance. */
let current: { readonly handle: AppHandle; readonly checks: LibraryChecks } | null = null;

export function checksFor(handle: AppHandle): LibraryChecks {
  if (current?.handle === handle) return current.checks;
  let home: Promise<string | null> | null = null;
  const checks = new LibraryChecks({
    read: (path, max) => handle.shell.readHead(path, max),
    stat: (path) => handle.shell.stat(path),
    // The home folder as the Links tab finds it: from where the config lives.
    home: () =>
      (home ??= (handle.shell.configPaths?.() ?? Promise.resolve(null))
        .then(async (p) => (p ? (await import('../theme/user-theme.ts')).inferHomeFromConfig(p.config) : null))
        .catch(() => null)),
    rootOf: (entry) => handle.imageRoot(entry.path),
    digest: workerDigest(),
    copyKey: (entry) => {
      const key = handle.index.checkoutKey(entry.path);
      return key === undefined ? undefined : `${key.group}\0${key.rel}\0${entry.size}\0${entry.title}`;
    },
  });
  current = { handle, checks };
  return checks;
}
