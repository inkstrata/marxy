// `[[capture]]` rules in collection.toml (ADR-0063): parse and validate. Nothing here copies, watches
// or writes a file (P-03). Shell-free: the host passes the home directory and its own folders.

import { isIgnored, parseIgnore } from './ignore.ts';
import { dirname, normalizePath, pathUnder } from './paths.ts';

/** One validated rule. `from` and `to` are absolute, `~` expanded; `fromBase` is the first fixed folder of `from`. */
export interface CaptureRule {
  readonly from: string;
  readonly to: string;
  readonly fromBase: string;
}

export interface ParseCapturesResult {
  readonly captures: readonly CaptureRule[];
  readonly warnings: readonly string[];
  readonly unknownKeys: readonly string[];
}

export interface CaptureContext {
  readonly home: string;
  /** Marxy's own config and data folders: a rule may never write into one. */
  readonly ownFolders: readonly string[];
  /** The reader's `[deny]` globs: a rule may never write into a folder they name. */
  readonly denyGlobs: readonly string[];
  /** Expands `~` the way roots are expanded; null when the path is not absolute and local. */
  readonly resolvePath: (raw: string, home: string) => string | null;
}

/** A placeholder ceiling on capture rules; more warn and are dropped. */
export const MAX_CAPTURES = 32;

const CAPTURE_KEYS = new Set(['from', 'to']);

/** ADR-0063 item 6, verbatim: the Privacy page's whole account of the action. */
export const CAPTURE_PRIVACY_LINE =
  'Marxy copies files matching your capture rules from `from` to `to` on this disk, while it is running.';

/** The Privacy line once per rule, with that rule's own paths in place of `from` and `to`. */
export function capturePrivacyLines(rules: readonly CaptureRule[]): string[] {
  return rules.map((r) =>
    CAPTURE_PRIVACY_LINE.replace('`from`', () => `\`${r.from}\``).replace('`to`', () => `\`${r.to}\``),
  );
}

/** The folder part of `from` before its first glob character, or its parent when it has none. */
function fixedFolder(from: string): string {
  const at = from.search(/[*?[{]/);
  if (at < 0) return dirname(from);
  const cut = from.slice(0, at);
  const slash = cut.lastIndexOf('/');
  return slash < 0 ? '' : normalizePath(cut.slice(0, slash + 1));
}

const isRoot = (p: string): boolean => p === '/' || /^[A-Za-z]:\/?$/.test(p);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates the raw `capture` value of collection.toml. A refused rule warns, naming itself, and is dropped. */
export function parseCaptures(rawCapture: unknown, ctx: CaptureContext): ParseCapturesResult {
  const warnings: string[] = [];
  const unknown = new Set<string>();
  const captures: CaptureRule[] = [];
  if (rawCapture === undefined) return { captures, warnings, unknownKeys: [] };
  if (!Array.isArray(rawCapture)) {
    return { captures, warnings: ['capture must be a list of [[capture]] tables; ignored'], unknownKeys: [] };
  }
  const home = normalizePath(ctx.home);
  const own = ctx.ownFolders.filter((d) => d !== '').map(normalizePath);
  const deny = parseIgnore(ctx.denyGlobs.join('\n'), '');

  for (const [i, entry] of rawCapture.entries()) {
    const label = `capture ${i + 1}`;
    if (!isRecord(entry)) {
      warnings.push(`${label} is not a table; skipped`);
      continue;
    }
    for (const k of Object.keys(entry)) if (!CAPTURE_KEYS.has(k)) unknown.add(`capture.${k}`);
    if (typeof entry.from !== 'string' || entry.from === '') {
      warnings.push(`${label} has no from; skipped`);
      continue;
    }
    if (typeof entry.to !== 'string' || entry.to === '') {
      warnings.push(`${label} (from "${entry.from}") has no to; skipped`);
      continue;
    }
    const named = `${label} (from "${entry.from}" to "${entry.to}")`;
    const from = ctx.resolvePath(entry.from, ctx.home);
    if (from === null) {
      warnings.push(`${named} from is not an absolute local path; skipped`);
      continue;
    }
    const to = ctx.resolvePath(entry.to, ctx.home);
    if (to === null) {
      warnings.push(`${named} to is not an absolute local folder; skipped`);
      continue;
    }
    const fromBase = fixedFolder(from);
    if (fromBase === '' || isRoot(fromBase)) {
      warnings.push(`${named} from has no fixed folder before its first glob; skipped`);
      continue;
    }
    if (isRoot(to) || to === home) {
      warnings.push(`${named} to is the filesystem root or the home folder itself; skipped`);
      continue;
    }
    if (pathUnder(fromBase, to) !== undefined || pathUnder(to, fromBase) !== undefined) {
      warnings.push(`${named} to and the fixed folder of from contain each other, which would copy in a loop; skipped`);
      continue;
    }
    if (own.some((dir) => pathUnder(dir, to) !== undefined)) {
      warnings.push(`${named} to is inside Marxy's own settings and state; skipped`);
      continue;
    }
    if (isIgnored(to.replace(/^\/+/, ''), true, deny)) {
      warnings.push(`${named} to matches a deny glob; skipped`);
      continue;
    }
    if (captures.length >= MAX_CAPTURES) {
      warnings.push(`more than ${MAX_CAPTURES} capture rules; ${named} dropped`);
      continue;
    }
    captures.push({ from, to, fromBase });
  }
  return { captures, warnings, unknownKeys: [...unknown] };
}
