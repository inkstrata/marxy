// Local versions (V-06, ADR-0072): byte-exact copies of a reader's file, kept as plain files in Marxy's data folder, and the
// manifest that names them. Pure over an injected read and write: nothing here knows the shell, the DOM or a document store.
//
// THE LAYOUT. One file's versions are `versions-<sha1(path)>.json` (the manifest: the path, and for each version its slot, the
// time it was kept, its size, its SHA-256 and its reason) and up to 20 slots, `versions-<sha1(path)>-01` to `-20`, each holding one version's
// bytes exactly. They sit flat in the data folder, beside `index-<sha1>.json`, because `writeFileAtomic` creates no folders (the
// index snapshot's precedent, `index/service.ts`); ADR-0072's `versions/<hash>/` folder is this, amended.
//
// THE RULES (ADR-0072 items 2, 3, 5).
// - Identical bytes are kept once: a version whose bytes equal the newest one's adds nothing, and one whose bytes equal an older
//   one's shares that one's slot (a second entry, no second copy).
// - At most 20 versions per file, none older than 30 days, 200 MB in all; the oldest is dropped first.
// - There is no delete (no new `shell-api` capability): a dropped version leaves the manifest first, and then its slot is
//   overwritten with zero bytes, so no dropped or cleared version's bytes stay readable through the store.
// - A slot is the version only while it hashes to the manifest's SHA-256 (ADR-0072 amendment 4): a same-size hand edit reads as changed.
// - A manifest this store cannot read as its own (not JSON, a wrong shape, another file's) is reported, never replaced by
//   keeping: the file's versions stop until the reader clears them. A newer Marxy's manifest is read and never written.
// - Every write is atomic (`writeFileAtomic`), and every path written is in the data folder: never beside a reader's file.
// - A file under a deny rule, one over the large-file limit, a scratch document and Marxy's own data are never copied
//   (`notKept`); the store asks the policy it was made with before anything else, and writes nothing when it refuses.
import { isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { denyRulesFor } from '@marxy/core/src/index-model/collection.ts';
import { isIgnored } from '@marxy/core/src/index-model/ignore.ts';

/** At most this many versions of one file (ADR-0072 item 3). */
export const VERSIONS_PER_FILE = 20;
/** None older than this (ADR-0072 item 3). */
export const VERSIONS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Every version's bytes together, across every file (ADR-0072 item 3). */
export const VERSIONS_TOTAL_BYTES = 200 * 1024 * 1024;
/** A manifest larger than this is not one Marxy wrote: 20 entries are a few hundred bytes each. */
export const MANIFEST_MAX_BYTES = 256 * 1024;
/** The data folder's file names this store owns start with this. */
export const VERSIONS_PREFIX = 'versions-';

/** Why a version was kept, as the manifest and the tab spell it. */
export type VersionReason = 'read' | 'before save' | 'before reload';
const REASONS: readonly VersionReason[] = ['read', 'before save', 'before reload'];

export interface VersionEntry {
  /** Unique within the file, growing: the order the versions were kept. */
  readonly id: number;
  /** 1 to 20: which slot file holds the bytes. Two entries share a slot when their bytes are identical. */
  readonly slot: number;
  /** When it was kept, epoch ms (written as an ISO time). */
  readonly time: number;
  readonly size: number;
  /** SHA-256 of the bytes, in hex: a slot is the version only while it hashes to this (a same-size hand edit is not). */
  readonly hash: string;
  readonly reason: VersionReason;
}

/** A listed version, with what the store found of its bytes: there, gone, or not the bytes the manifest says (another size or another hash). */
export interface ListedVersion extends VersionEntry {
  readonly bytes: 'ok' | 'missing' | 'changed';
}

export type Listing =
  /** No version of this file is kept. */
  | { readonly kind: 'none' }
  /** Newest first. */
  | {
      readonly kind: 'ok';
      readonly versions: readonly ListedVersion[];
      /** When Marxy last saved over the file (its bytes are not a version until something replaces them), or null. */
      readonly saved: number | null;
    }
  /** The manifest is there and is not one this store can read; `reason` says how. Nothing is kept over it. */
  | { readonly kind: 'damaged'; readonly reason: string }
  /** A newer Marxy wrote the manifest: it is not read or written here. */
  | { readonly kind: 'newer' }
  /** The manifest could not be read at all (a permission, a disk error). */
  | { readonly kind: 'unreadable'; readonly error: unknown };

export type KeepResult =
  | { readonly result: 'kept'; readonly entry: VersionEntry }
  /** The newest version already holds these bytes: nothing was written. */
  | { readonly result: 'same'; readonly entry: VersionEntry }
  /** Nothing was written, and `why` says why: the policy's (`notKept`), or a damaged, newer or another file's manifest. */
  | { readonly result: 'refused'; readonly why: string; readonly notKept?: NotKept }
  /** A write failed. The manifest still names only versions whose bytes are whole. */
  | { readonly result: 'failed'; readonly error: unknown };

export type ReadResult =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly entry: VersionEntry }
  /** No such version in the manifest (cleared, dropped, or never kept). */
  | { readonly kind: 'gone' }
  /** The manifest names it and its slot file is not there: removed from the data folder by something else. */
  | { readonly kind: 'missing'; readonly entry: VersionEntry }
  /** The slot holds other bytes than the version's (a different size, or the same size and another hash): changed outside Marxy. Never restorable. */
  | { readonly kind: 'changed'; readonly entry: VersionEntry }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/** What the store needs of the shell. The data folder is asked for each time, as every other state file does. */
export interface VersionsIo {
  dataDir(): Promise<string>;
  /** The manifest, bounded. Rejects `code: 'not-found'` when there is none. */
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
  /** A slot's bytes, whole. Rejects `code: 'not-found'` when it is not there. */
  readFile(path: string): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  /** The data folder's files, with their sizes. */
  readDir(dir: string): Promise<readonly { readonly path: string; readonly size: number; readonly isDir: boolean }[]>;
  now(): number;
}

export interface VersionLimits {
  readonly perFile: number;
  readonly maxAgeMs: number;
  readonly totalBytes: number;
}

export const VERSION_LIMITS: VersionLimits = { perFile: VERSIONS_PER_FILE, maxAgeMs: VERSIONS_MAX_AGE_MS, totalBytes: VERSIONS_TOTAL_BYTES };

/** Why a file gets no versions. The tab says it in words (`versions-tab.ts`). */
export type NotKept =
  /** `versions = false` in config.toml. */
  | { readonly kind: 'off' }
  /** Larger than the large-file limit. */
  | { readonly kind: 'large'; readonly limit: number }
  /** Under the built-in deny list (`rule` is the folder name) or a `[deny]` glob of collection.toml (`rule` is the glob). */
  | { readonly kind: 'denied'; readonly rule: string; readonly builtIn: boolean }
  /** A scratch document: there is no file. */
  | { readonly kind: 'scratch' }
  /** A file in Marxy's own data folder. */
  | { readonly kind: 'own' };

export interface PolicyInputs {
  readonly enabled: boolean;
  /** The reader's `[deny]` globs from collection.toml. */
  readonly denyGlobs: readonly string[];
  /** The folder the index walks for this file (its repository, else its folder), or null when unknown. */
  readonly root: string | null;
  readonly dataDir: string;
  readonly largeFileBytes: number;
  readonly untitled: boolean;
}

const under = (path: string, dir: string): string | null => {
  const base = trimDir(dir);
  return base !== '' && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
};

/**
 * Whether `path`, `size` bytes long, gets a version, or why not. The built-in deny list is applied to every folder of the
 * absolute path; the reader's globs to the path from its root and from `/` both, so a glob the index applies matches here
 * too and nothing is let through for want of a root. Pure.
 */
export function notKept(path: string, size: number, inputs: PolicyInputs): NotKept | null {
  if (inputs.untitled) return { kind: 'scratch' };
  if (!inputs.enabled) return { kind: 'off' };
  if (under(path, inputs.dataDir) !== null) return { kind: 'own' };
  const folders = path.split('/').filter(Boolean).slice(0, -1);
  const named = folders.find((f) => isDeniedName(f));
  if (named !== undefined) return { kind: 'denied', rule: named, builtIn: true };
  const rels = [inputs.root === null ? null : under(path, inputs.root), path.replace(/^\/+/, '')].filter((r): r is string => r !== null && r !== '');
  for (const glob of inputs.denyGlobs) {
    const rules = denyRulesFor([glob]);
    if (rels.some((rel) => isIgnored(rel, false, rules))) return { kind: 'denied', rule: glob, builtIn: false };
  }
  if (size > inputs.largeFileBytes) return { kind: 'large', limit: inputs.largeFileBytes };
  return null;
}

export interface VersionStore {
  list(path: string): Promise<Listing>;
  /** Keeps `bytes` as a version of `path` for `reason`, within the limits. Never throws: a failure is a result. */
  keep(path: string, bytes: Uint8Array, reason: VersionReason): Promise<KeepResult>;
  read(path: string, id: number): Promise<ReadResult>;
  /** Every version of `path` dropped: the manifest emptied, then every slot of the file overwritten with zero bytes. */
  clear(path: string): Promise<{ readonly cleared: number; readonly error?: unknown }>;
  /** `clear` for every file with versions, including one whose manifest is damaged. */
  clearAll(): Promise<{ readonly files: number; readonly cleared: number; readonly errors: readonly unknown[] }>;
  /** Drops every version older than 30 days, then the oldest across all files while the total is over 200 MB. */
  sweep(): Promise<{ readonly dropped: number; readonly errors: readonly unknown[] }>;
  /** Every version's bytes together, from the sizes of the slot files. */
  totalBytes(): Promise<number>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const EMPTY = new Uint8Array(0);

const codeOf = (error: unknown): unknown => (typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined);
const isNotFound = (error: unknown): boolean => codeOf(error) === 'not-found';

/** SHA-256 of `bytes` in hex: each version's, kept in the manifest and checked whenever its slot is read. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The file's key: SHA-1 of its path as UTF-8, in hex, the family of `index-<sha1(root)>.json`. */
export async function versionsKey(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', encoder.encode(path));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const trimDir = (dir: string): string => dir.replace(/\/+$/, '');
export const manifestPath = (data: string, key: string): string => `${trimDir(data)}/${VERSIONS_PREFIX}${key}.json`;
export const slotPath = (data: string, key: string, slot: number): string => `${trimDir(data)}/${VERSIONS_PREFIX}${key}-${String(slot).padStart(2, '0')}`;

/** `versions-<key>-NN` → [key, NN]; `versions-<key>.json` → [key, 0]; anything else null. */
export function ownName(name: string): { readonly key: string; readonly slot: number } | null {
  const m = /^versions-([0-9a-f]{40})(?:\.json|-(\d{2}))$/.exec(name);
  if (!m) return null;
  return { key: m[1]!, slot: m[2] === undefined ? 0 : Number(m[2]) };
}

interface Manifest {
  readonly path: string;
  readonly next: number;
  /** When Marxy last saved over the file, or null: a time, never bytes. */
  readonly saved: number | null;
  /** Oldest first. */
  readonly versions: readonly VersionEntry[];
}

type Parsed =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly manifest: Manifest }
  | { readonly kind: 'damaged'; readonly reason: string }
  | { readonly kind: 'newer' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The manifest's bytes read as this store's, or how they are not. Exported for the tests. */
export function parseManifest(bytes: Uint8Array, limits: VersionLimits = VERSION_LIMITS): Parsed {
  if (bytes.length >= MANIFEST_MAX_BYTES) return { kind: 'damaged', reason: 'it is larger than any Marxy writes' };
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes));
  } catch {
    return { kind: 'damaged', reason: 'it is not valid JSON' };
  }
  if (!isRecord(raw)) return { kind: 'damaged', reason: 'it is not a JSON object' };
  if (typeof raw.version === 'number' && raw.version > 1) return { kind: 'newer' };
  if (raw.version !== 1) return { kind: 'damaged', reason: 'it has no "version": 1' };
  if (typeof raw.path !== 'string') return { kind: 'damaged', reason: 'it names no path' };
  if (!isCount(raw.next)) return { kind: 'damaged', reason: 'its "next" is not a count' };
  if (!Array.isArray(raw.versions)) return { kind: 'damaged', reason: 'its "versions" is not a list' };
  const versions: VersionEntry[] = [];
  const ids = new Set<number>();
  for (const [i, v] of raw.versions.entries()) {
    const where = `version ${i + 1}`;
    if (!isRecord(v)) return { kind: 'damaged', reason: `${where} is not an object` };
    const time = typeof v.time === 'string' ? Date.parse(v.time) : Number.NaN;
    if (!isCount(v.id) || ids.has(v.id) || v.id >= raw.next) return { kind: 'damaged', reason: `${where} has no unique id` };
    if (!isCount(v.slot) || v.slot < 1 || v.slot > limits.perFile) return { kind: 'damaged', reason: `${where} names no slot` };
    if (!Number.isFinite(time)) return { kind: 'damaged', reason: `${where} has no time` };
    if (!isCount(v.size)) return { kind: 'damaged', reason: `${where} has no size` };
    if (typeof v.hash !== 'string' || !/^[0-9a-f]{64}$/.test(v.hash)) return { kind: 'damaged', reason: `${where} has no hash` };
    if (typeof v.reason !== 'string' || !REASONS.includes(v.reason as VersionReason)) return { kind: 'damaged', reason: `${where} has no reason Marxy knows` };
    ids.add(v.id);
    versions.push({ id: v.id, slot: v.slot, time, size: v.size, hash: v.hash, reason: v.reason as VersionReason });
  }
  // Two entries on one slot must be the same bytes, so the same size and the same hash.
  const held = new Map<number, VersionEntry>();
  for (const v of versions) {
    const seen = held.get(v.slot);
    if (seen !== undefined && (seen.size !== v.size || seen.hash !== v.hash)) return { kind: 'damaged', reason: `two different versions share slot ${v.slot}` };
    held.set(v.slot, v);
  }
  versions.sort((a, b) => a.id - b.id);
  let saved: number | null = null;
  if (raw.saved !== undefined && raw.saved !== null) {
    saved = typeof raw.saved === 'string' ? Date.parse(raw.saved) : Number.NaN;
    if (!Number.isFinite(saved)) return { kind: 'damaged', reason: 'its "saved" is not a time' };
  }
  return { kind: 'ok', manifest: { path: raw.path, next: raw.next, saved, versions } };
}

/** The manifest as written: two-space JSON, times as ISO strings, a final newline, so a person can read it. */
export function formatManifest(m: Manifest): Uint8Array {
  const body = {
    version: 1,
    path: m.path,
    next: m.next,
    saved: m.saved === null ? null : new Date(m.saved).toISOString(),
    versions: m.versions.map((v) => ({ id: v.id, slot: v.slot, time: new Date(v.time).toISOString(), size: v.size, hash: v.hash, reason: v.reason })),
  };
  return encoder.encode(`${JSON.stringify(body, null, 2)}\n`);
}

/** The slots `versions` refer to. */
const slotsOf = (versions: readonly VersionEntry[]): Set<number> => new Set(versions.map((v) => v.slot));

export interface VersionStoreOptions {
  readonly limits?: VersionLimits;
  /** Asked before every keep: a reason not to keep this file, or null. A refusal writes nothing. */
  readonly policy?: (path: string, bytes: Uint8Array) => Promise<NotKept | null>;
}

export function createVersionStore(io: VersionsIo, opts: VersionStoreOptions = {}): VersionStore {
  const limits = opts.limits ?? VERSION_LIMITS;
  /** One change at a time across every file: a manifest is read, changed and written without another change between. */
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function readManifest(data: string, key: string): Promise<Parsed> {
    let bytes: Uint8Array;
    try {
      bytes = await io.readHead(manifestPath(data, key), MANIFEST_MAX_BYTES);
    } catch (error) {
      return isNotFound(error) ? { kind: 'absent' } : { kind: 'unreadable', error };
    }
    return parseManifest(bytes, limits);
  }

  /** The data folder's files this store owns, by key: each slot's size, and whether the manifest is there. */
  async function ownFiles(data: string): Promise<Map<string, { manifest: boolean; slots: Map<number, number> }>> {
    const out = new Map<string, { manifest: boolean; slots: Map<number, number> }>();
    for (const file of await io.readDir(data)) {
      if (file.isDir) continue;
      const own = ownName(file.path.slice(file.path.lastIndexOf('/') + 1));
      if (!own) continue;
      let entry = out.get(own.key);
      if (!entry) out.set(own.key, (entry = { manifest: false, slots: new Map() }));
      if (own.slot === 0) entry.manifest = true;
      else entry.slots.set(own.slot, file.size);
    }
    return out;
  }

  /**
   * Writes `next` in place of `before`: the manifest first, without anything dropped, so it never names a slot being
   * overwritten; then each dropped slot that nothing still names is emptied. A failure stops at that step.
   */
  async function commitDrop(data: string, key: string, before: Manifest, next: Manifest): Promise<void> {
    await io.writeFileAtomic(manifestPath(data, key), formatManifest(next));
    const kept = slotsOf(next.versions);
    for (const slot of slotsOf(before.versions)) if (!kept.has(slot)) await io.writeFileAtomic(slotPath(data, key, slot), EMPTY);
  }

  /** The version's bytes as the slot holds them now, or what is wrong with them. */
  async function readSlot(data: string, key: string, entry: VersionEntry): Promise<ReadResult> {
    let bytes: Uint8Array;
    try {
      bytes = await io.readFile(slotPath(data, key, entry.slot));
    } catch (error) {
      return isNotFound(error) ? { kind: 'missing', entry } : { kind: 'unreadable', error };
    }
    if (bytes.length !== entry.size || (await hashBytes(bytes)) !== entry.hash) return { kind: 'changed', entry };
    return { kind: 'bytes', bytes, entry };
  }

  const refusalFor = (parsed: Exclude<Parsed, { kind: 'ok' } | { kind: 'absent' }>): string => {
    switch (parsed.kind) {
      case 'damaged':
        return `the record of its versions could not be read (${parsed.reason})`;
      case 'newer':
        return 'a newer Marxy keeps its versions';
      case 'unreadable':
        return `the record of its versions could not be read (${String((parsed.error as { message?: unknown })?.message ?? parsed.error)})`;
    }
  };

  /** Drops what is over the per-file limits from `versions` (oldest first), leaving room for `room` more. */
  function withinLimits(versions: readonly VersionEntry[], now: number, room: number): VersionEntry[] {
    const fresh = versions.filter((v) => now - v.time <= limits.maxAgeMs);
    return fresh.slice(Math.max(0, fresh.length - (limits.perFile - room)));
  }

  async function sweepLocked(): Promise<{ dropped: number; errors: unknown[] }> {
    const data = await io.dataDir();
    const now = io.now();
    const errors: unknown[] = [];
    let dropped = 0;
    const files = await ownFiles(data);
    const held: { key: string; manifest: Manifest }[] = [];
    for (const [key, f] of files) {
      if (!f.manifest) continue;
      const parsed = await readManifest(data, key);
      if (parsed.kind !== 'ok') continue; // reported by the tab for its own file; never rewritten here
      let manifest = parsed.manifest;
      const fresh = withinLimits(manifest.versions, now, 0);
      if (fresh.length !== manifest.versions.length) {
        const next = { ...manifest, versions: fresh };
        try {
          await commitDrop(data, key, manifest, next);
          dropped += manifest.versions.length - fresh.length;
          manifest = next;
        } catch (error) {
          errors.push(error);
        }
      }
      held.push({ key, manifest });
    }
    // The total, from what the manifests name (a slot shared by two entries counts once).
    const sizeOf = (m: Manifest): number => {
      const bySlot = new Map<number, number>();
      for (const v of m.versions) bySlot.set(v.slot, v.size);
      let n = 0;
      for (const s of bySlot.values()) n += s;
      return n;
    };
    let total = held.reduce((n, h) => n + sizeOf(h.manifest), 0);
    if (total <= limits.totalBytes) return { dropped, errors };
    // Oldest first across every file, until the total is within the limit.
    const all = held.flatMap((h) => h.manifest.versions.map((v) => ({ h, v }))).sort((a, b) => a.v.time - b.v.time || a.v.id - b.v.id);
    const drop = new Map<string, Set<number>>();
    const after = new Map(held.map((h) => [h.key, h.manifest]));
    for (const { h, v } of all) {
      if (total <= limits.totalBytes) break;
      const ids = drop.get(h.key) ?? new Set<number>();
      ids.add(v.id);
      drop.set(h.key, ids);
      const before = after.get(h.key)!;
      const next = { ...before, versions: before.versions.filter((x) => !ids.has(x.id)) };
      total -= sizeOf(before) - sizeOf(next);
      after.set(h.key, next);
    }
    for (const h of held) {
      const next = after.get(h.key)!;
      if (next.versions.length === h.manifest.versions.length) continue;
      try {
        await commitDrop(data, h.key, h.manifest, next);
        dropped += h.manifest.versions.length - next.versions.length;
      } catch (error) {
        errors.push(error);
      }
    }
    return { dropped, errors };
  }

  async function clearKey(data: string, key: string, path: string | null, slots: Iterable<number>, count: number): Promise<number> {
    // The manifest first: once it names nothing, no slot is a version any more, even if emptying one fails.
    await io.writeFileAtomic(manifestPath(data, key), formatManifest({ path: path ?? '', next: 1, saved: null, versions: [] }));
    for (const slot of slots) await io.writeFileAtomic(slotPath(data, key, slot), EMPTY);
    return count;
  }

  return {
    async list(path) {
      const data = await io.dataDir();
      const key = await versionsKey(path);
      const parsed = await readManifest(data, key);
      if (parsed.kind === 'absent') return { kind: 'none' };
      if (parsed.kind !== 'ok') return parsed;
      const m = parsed.manifest;
      if (m.versions.length === 0) return { kind: 'none' };
      if (m.path !== path) return { kind: 'damaged', reason: `it belongs to another file (${m.path})` };
      // Every version's slot is read and hashed (a slot is the version only while its bytes are the ones the manifest hashed), once
      // per slot however many versions share it; a listing of the data folder first tells a slot that is not there.
      let slots: Map<number, number> | null = null;
      try {
        slots = (await ownFiles(data)).get(key)?.slots ?? new Map();
      } catch {
        slots = null; // cannot tell: each slot is read below
      }
      const checked = new Map<string, ListedVersion['bytes']>();
      const versions: ListedVersion[] = [];
      for (const v of [...m.versions].reverse()) {
        const size = slots?.get(v.slot);
        const cache = `${v.slot}:${v.hash}`;
        let bytes = checked.get(cache);
        if (bytes === undefined) {
          if (slots !== null && size === undefined) bytes = 'missing';
          else if (slots !== null && size !== v.size) bytes = 'changed';
          else {
            const r = await readSlot(data, key, v);
            bytes = r.kind === 'bytes' ? 'ok' : r.kind === 'changed' ? 'changed' : 'missing';
          }
          checked.set(cache, bytes);
        }
        versions.push({ ...v, bytes });
      }
      return { kind: 'ok', versions, saved: m.saved };
    },

    keep(path, bytes, reason) {
      return serially(async (): Promise<KeepResult> => {
        try {
          const no = (await opts.policy?.(path, bytes)) ?? null;
          if (no !== null) return { result: 'refused', why: no.kind, notKept: no };
        } catch (error) {
          return { result: 'failed', error };
        }
        let data: string;
        let key: string;
        let parsed: Parsed;
        try {
          data = await io.dataDir();
          key = await versionsKey(path);
          parsed = await readManifest(data, key);
        } catch (error) {
          return { result: 'failed', error };
        }
        let before: Manifest;
        if (parsed.kind === 'absent') before = { path, next: 1, saved: null, versions: [] };
        else if (parsed.kind === 'ok') before = parsed.manifest;
        else return { result: 'refused', why: refusalFor(parsed) };
        // An emptied manifest (cleared) is anyone's; one that names another file's versions is not ours to change.
        if (before.path !== path) {
          if (before.versions.length > 0) return { result: 'refused', why: `the record of its versions names another file (${before.path})` };
          before = { ...before, path };
        }
        const now = io.now();
        const hash = await hashBytes(bytes);
        // Before a save: the manifest says when, so the next open knows the reader wrote what it finds (a time, no bytes).
        const saved = reason === 'before save' ? now : before.saved;
        try {
          // Identical to the newest version: nothing new to keep (the time of a save is still noted).
          const newest = before.versions.at(-1);
          if (newest && newest.hash === hash && now - newest.time <= limits.maxAgeMs) {
            const held = await readSlot(data, key, newest);
            if (held.kind === 'bytes' && sameBytes(held.bytes, bytes)) {
              if (saved !== before.saved) await io.writeFileAtomic(manifestPath(data, key), formatManifest({ ...before, saved }));
              return { result: 'same', entry: newest };
            }
          }
          const kept = withinLimits(before.versions, now, 1);
          // Identical to an older version still kept: share its slot, so the bytes are on disk once.
          let shared: number | null = null;
          for (const v of [...kept].reverse()) {
            if (v.hash !== hash) continue;
            const held = await readSlot(data, key, v);
            if (held.kind === 'bytes' && sameBytes(held.bytes, bytes)) {
              shared = v.slot;
              break;
            }
          }
          const used = slotsOf(kept);
          let slot = shared;
          if (slot === null) {
            for (let s = 1; s <= limits.perFile; s++) {
              if (!used.has(s)) {
                slot = s;
                break;
              }
            }
          }
          if (slot === null) throw new Error('no free slot'); // unreachable: `kept` leaves one entry's room
          const entry: VersionEntry = { id: before.next, slot, time: now, size: bytes.length, hash, reason };
          const pruned: Manifest = { path, next: before.next, saved: before.saved, versions: kept };
          // A dropped version's slot taken for the new bytes: the manifest stops naming it before it is written again.
          if (shared === null && slotsOf(before.versions).has(slot)) {
            await io.writeFileAtomic(manifestPath(data, key), formatManifest(pruned));
          }
          if (shared === null) await io.writeFileAtomic(slotPath(data, key, slot), bytes);
          const next: Manifest = { path, next: before.next + 1, saved, versions: [...kept, entry] };
          try {
            await io.writeFileAtomic(manifestPath(data, key), formatManifest(next));
          } catch (error) {
            // The new bytes are in a slot no entry names: emptied, if the disk lets it be.
            if (shared === null) await io.writeFileAtomic(slotPath(data, key, slot), EMPTY).catch(() => undefined);
            throw error;
          }
          // Slots that only dropped versions named are emptied, once the manifest no longer names them.
          const still = slotsOf(next.versions);
          for (const s of slotsOf(before.versions)) if (!still.has(s)) await io.writeFileAtomic(slotPath(data, key, s), EMPTY);
          return { result: 'kept', entry };
        } catch (error) {
          return { result: 'failed', error };
        }
      });
    },

    async read(path, id) {
      try {
        const data = await io.dataDir();
        const key = await versionsKey(path);
        const parsed = await readManifest(data, key);
        if (parsed.kind === 'unreadable') return { kind: 'unreadable', error: parsed.error };
        if (parsed.kind !== 'ok' || parsed.manifest.path !== path) return { kind: 'gone' };
        const entry = parsed.manifest.versions.find((v) => v.id === id);
        if (!entry) return { kind: 'gone' };
        return await readSlot(data, key, entry);
      } catch (error) {
        return { kind: 'unreadable', error };
      }
    },

    clear(path) {
      return serially(async () => {
        try {
          const data = await io.dataDir();
          const key = await versionsKey(path);
          const parsed = await readManifest(data, key);
          const count = parsed.kind === 'ok' && parsed.manifest.path === path ? parsed.manifest.versions.length : 0;
          // Every slot file of the key, whatever the manifest says (a damaged one names none it can be trusted for).
          const slots = new Set<number>((await ownFiles(data)).get(key)?.slots.keys() ?? []);
          if (parsed.kind === 'ok') for (const v of parsed.manifest.versions) slots.add(v.slot);
          if (parsed.kind === 'absent' && slots.size === 0) return { cleared: 0 };
          return { cleared: await clearKey(data, key, path, [...slots].sort((a, b) => a - b), count) };
        } catch (error) {
          return { cleared: 0, error };
        }
      });
    },

    clearAll() {
      return serially(async () => {
        const errors: unknown[] = [];
        let files = 0;
        let cleared = 0;
        try {
          const data = await io.dataDir();
          for (const [key, f] of await ownFiles(data)) {
            const parsed = f.manifest ? await readManifest(data, key) : ({ kind: 'absent' } as const);
            const count = parsed.kind === 'ok' ? parsed.manifest.versions.length : 0;
            const slots = new Set<number>(f.slots.keys());
            if (parsed.kind === 'ok') for (const v of parsed.manifest.versions) slots.add(v.slot);
            const nonEmpty = [...f.slots.values()].some((size) => size > 0);
            if (count === 0 && !nonEmpty && parsed.kind !== 'damaged') continue;
            try {
              cleared += await clearKey(data, key, parsed.kind === 'ok' ? parsed.manifest.path : null, [...slots].sort((a, b) => a - b), count);
              files++;
            } catch (error) {
              errors.push(error);
            }
          }
        } catch (error) {
          errors.push(error);
        }
        return { files, cleared, errors };
      });
    },

    sweep() {
      return serially(async () => {
        try {
          return await sweepLocked();
        } catch (error) {
          return { dropped: 0, errors: [error] };
        }
      });
    },

    async totalBytes() {
      const data = await io.dataDir();
      let n = 0;
      for (const f of (await ownFiles(data)).values()) for (const size of f.slots.values()) n += size;
      return n;
    },
  };
}
