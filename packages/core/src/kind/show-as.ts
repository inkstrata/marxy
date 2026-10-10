// *Show as* (ADR-0060 item 9, K-04): the kind a reader chose for one file, kept in `kinds.json` in Marxy's
// data directory beside `positions.json`, and the one function that feeds a file's choices to `detectKind`.
//
// `kinds.json` holds a kind and nothing else: path -> kind, under a version. It is the reader's choice, never
// an observation of the document, so it holds no front-matter value and no name of a tool. Unlike positions it
// is never evicted: at its cap a new choice is refused with a notice that names the cap, and no earlier choice
// is dropped. Version guard and quarantine of a corrupt file are positions.json's (storage.ts), not new ones.
//
// Pure: no DOM, no Node built-ins, no I/O. The shell reads and writes the bytes.

import { KINDS } from '../contracts/kinds.ts';
import type { Kind } from '../contracts/kinds.ts';
import { basename, normalizePath } from '../index-model/paths.ts';
import { detectKind } from './detect.ts';
import type { DetectInput, DetectResult, KindRule } from './detect.ts';

export const KINDS_FILE_VERSION = 1;
/** *Show as* choices kept. A new one beyond it is refused; none is ever dropped to make room. */
export const KINDS_CAP = 5000;

export interface KindsEnvelope {
  readonly version: number;
  readonly kinds: Record<string, Kind>;
}

export type LoadKindsResult =
  | { readonly kind: 'ok'; readonly envelope: KindsEnvelope; readonly newerVersion: boolean }
  | { readonly kind: 'quarantined'; readonly envelope: KindsEnvelope; readonly quarantineBytes: Uint8Array };

const isKind = (value: unknown): value is Kind => typeof value === 'string' && (KINDS as readonly string[]).includes(value);

export function emptyKindsEnvelope(): KindsEnvelope {
  return { version: KINDS_FILE_VERSION, kinds: {} };
}

/**
 * Lexically resolves `.`, `..` and empty segments (`/a//b/./../c` is `/a/c`); null when a `..` would climb
 * above the root. The way P-02 resolves a capture path, so one path has one spelling.
 */
function resolveDots(path: string): string | null {
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? '';
  const out: string[] = [];
  for (const seg of path.slice(drive.length).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.pop() === undefined) return null;
      continue;
    }
    out.push(seg);
  }
  return `${drive}/${out.join('/')}`;
}

/**
 * The key a path is kept and matched under: slashes normalised, `.`, `..` and `//` resolved, Unicode composed
 * (NFC) and lower-cased, on every platform (P-02's `fold`): macOS and Windows volumes ignore case and an
 * accent may be composed or not, so one file must not have two keys. A path that climbs above its root is
 * kept as normalised, never guessed at.
 */
export function kindPathKey(path: string): string {
  const slash = normalizePath(path);
  return (resolveDots(slash) ?? slash).normalize('NFC').toLowerCase();
}

/** The kind chosen for `path`, or undefined. */
export function showAsFor(envelope: KindsEnvelope, path: string): Kind | undefined {
  return envelope.kinds[kindPathKey(path)];
}

/**
 * Parses `kinds.json`. A file that is not UTF-8, not JSON, not an object or without a numeric version is
 * quarantined (the caller writes the bytes aside and starts empty). A newer version is read and not written
 * back (`newerVersion`). An entry whose value is not a kind (a later Marxy's kind, a typo) is ignored, its
 * value listed in `ignored` for a notice naming it, never guessed at.
 */
export function parseKindsFile(bytes: Uint8Array): LoadKindsResult & { readonly ignored?: readonly string[] } {
  const fresh = emptyKindsEnvelope();
  const quarantine = { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() } as const;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return quarantine;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return quarantine;
  const { version, kinds: raw } = parsed as { version?: unknown; kinds?: unknown };
  if (typeof version !== 'number') return quarantine;
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) return quarantine;
  const kinds: Record<string, Kind> = {};
  const ignored: string[] = [];
  for (const [path, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (isKind(value)) kinds[kindPathKey(path)] = value;
    else ignored.push(typeof value === 'string' ? value : String(value));
  }
  return {
    kind: 'ok',
    envelope: { version: Math.max(version, KINDS_FILE_VERSION), kinds },
    newerVersion: version > KINDS_FILE_VERSION,
    ...(ignored.length > 0 ? { ignored } : {}),
  };
}

/** The bytes of `kinds.json`: a version and path -> kind, nothing else. */
export function serializeKindsFile(envelope: KindsEnvelope): Uint8Array {
  const kinds: Record<string, Kind> = {};
  for (const key of Object.keys(envelope.kinds).sort()) kinds[key] = envelope.kinds[key]!;
  return new TextEncoder().encode(`${JSON.stringify({ version: envelope.version, kinds }, null, 2)}\n`);
}

export function quarantinePathFor(kindsPath: string, nowMs = Date.now()): string {
  return `${kindsPath}.bad-${nowMs}`;
}

export type SetShowAsResult =
  | { readonly ok: true; readonly envelope: KindsEnvelope }
  | { readonly ok: false; readonly notice: string };

/**
 * Records *show as* for one file. Replacing a file's own earlier choice is always allowed; a choice for a
 * new file at the cap is refused with a notice naming the cap, and nothing is removed.
 */
export function setShowAs(envelope: KindsEnvelope, path: string, kind: Kind): SetShowAsResult {
  if (!isKind(kind)) return { ok: false, notice: `"${String(kind)}" is not one of the kinds, so nothing was changed.` };
  const key = kindPathKey(path);
  const known = Object.hasOwn(envelope.kinds, key);
  if (!known && Object.keys(envelope.kinds).length >= KINDS_CAP) {
    return {
      ok: false,
      notice: `Marxy keeps at most ${KINDS_CAP} files shown as a chosen kind, and that many are kept. Choose a file's kind again to change it, or write a [[kind]] rule in config.toml for a folder.`,
    };
  }
  return { ok: true, envelope: { ...envelope, kinds: { ...envelope.kinds, [key]: kind } } };
}

/** Forgets the choice for one file; the matching rule's kind, or detection, applies again. */
export function clearShowAs(envelope: KindsEnvelope, path: string): KindsEnvelope {
  const key = kindPathKey(path);
  if (!Object.hasOwn(envelope.kinds, key)) return envelope;
  const kinds = { ...envelope.kinds };
  delete kinds[key];
  return { ...envelope, kinds };
}

/** The glob of an "Always open this folder as" rule: the folder's whole tree, the home folder written as `~`. */
export function folderKindGlob(folder: string, home: string): string {
  const dir = normalizePath(folder);
  const h = normalizePath(home);
  let written = dir;
  if (dir === h) written = '~';
  else if (h !== '/' && dir.startsWith(`${h}/`)) written = `~${dir.slice(h.length)}`;
  return written === '/' ? '/**' : `${written}/**`;
}

export interface FileKindInput extends Omit<DetectInput, 'showAs' | 'rules'> {
  /** The reader's rules, `KindRule[]` from config.toml, in file order. */
  readonly rules?: readonly KindRule[];
  /** `kinds.json`'s content; this file's choice, if any, is read from it. */
  readonly choices?: KindsEnvelope;
}

/**
 * What a file is read as, from everything the reader decided (item 9): the file's own *show as* beats a
 * rule, a rule beats detection, always. Rules match the way P-02's paths are compared: `.`, `..` and `//`
 * resolved, Unicode composed, case ignored, so `~/Notes/**` matches `~/notes/a.md`. `detectKind` matches
 * case-sensitively, so it is handed the folded path and folded globs; the reasons it returns are mapped back
 * to the reader's own spelling of the path and the rule's glob.
 */
export function detectFileKind(input: FileKindInput): DetectResult {
  const rules = input.rules ?? [];
  const showAs = input.choices === undefined ? undefined : showAsFor(input.choices, input.path);
  const folded = kindPathKey(input.path);
  const foldedRules = rules.map((r) => ({ ...r, glob: r.glob.normalize('NFC').toLowerCase() }));
  const { choices: _choices, ...rest } = input;
  const result = detectKind({ ...rest, path: folded, rules: foldedRules, ...(showAs === undefined ? {} : { showAs }) });
  const spelled = new Map<string, string>([[folded, normalizePath(input.path)], [basename(folded), basename(input.path)]]);
  for (const r of rules) {
    const key = r.glob.normalize('NFC').toLowerCase();
    if (!spelled.has(key)) spelled.set(key, r.glob);
  }
  return {
    kind: result.kind,
    reasons: result.reasons.map((reason) => ({ ...reason, at: spelled.get(reason.at) ?? reason.at })),
  };
}
