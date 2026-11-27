// The summoned finder with nothing typed: Pinned, then Recent. Pure and shell-free, so the order and the cap are
// tested without a DOM. Nothing here reports what changed since a file was read.
import type { IndexEntry, IndexHit } from '@marxy/core';
import type { AppContext, Command } from '../commands/registry.ts';
import { emptyQueryPaths, type PaletteSession } from './session.ts';

export type EmptySectionKind = 'pinned' | 'recent';

export interface EmptySection {
  readonly kind: EmptySectionKind;
  readonly hits: readonly IndexHit[];
}

export interface EmptyStateInput {
  readonly entriesByPath: ReadonlyMap<string, IndexEntry>;
  readonly session: PaletteSession;
  readonly nowMs: number;
  /** Rows in all. Default 12. */
  readonly limit?: number;
}

export const EMPTY_STATE_LIMIT = 12;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `now`, `4m`, `3h`, `2d`, `5w`, `1y`: whole units, rounded down. A future time reads `now`; no real time reads ``. */
export function relativeAge(nowMs: number, rawThenMs: number | undefined): string {
  const thenMs = rawThenMs;
  if (typeof thenMs !== 'number' || !(thenMs > 0)) return '';
  const delta = nowMs - thenMs;
  if (!(delta >= MINUTE)) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  const days = Math.floor(delta / DAY);
  if (days < 14) return `${days}d`;
  if (days < 7 * 52) return `${Math.floor(days / 7)}w`;
  return `${Math.max(1, Math.floor(days / 365))}y`;
}

const SPOKEN_UNITS: Record<string, string> = { m: 'minute', h: 'hour', d: 'day', w: 'week', y: 'year' };

/** An age from `relativeAge` as words for a screen reader: `4m` is "4 minutes ago"; `now` is "just now". */
export function spokenAge(age: string): string {
  if (age === '') return '';
  if (age === 'now') return 'just now';
  const count = Number.parseInt(age, 10);
  const unit = SPOKEN_UNITS[age.slice(-1)];
  return unit === undefined ? age : `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** The entry as the reader's session knows it: its read time over the index's own. */
function withRead(entry: IndexEntry, session: PaletteSession): IndexEntry {
  const read = session.readAt[entry.path];
  return read === undefined ? entry : { ...entry, lastReadMs: read };
}

export function emptyStateSections(input: EmptyStateInput): readonly EmptySection[] {
  const { entriesByPath, session } = input;
  const limit = input.limit ?? EMPTY_STATE_LIMIT;
  const taken = new Set<string>();
  const hit = (entry: IndexEntry): IndexHit => ({ entry, score: 0 });

  const pinnedSet = new Set(session.pinned);
  const pinned: IndexHit[] = [];
  const order = emptyQueryPaths(session);
  for (const path of order) {
    if (!pinnedSet.has(path) || pinned.length >= limit) continue;
    const entry = entriesByPath.get(path);
    if (entry === undefined) continue;
    pinned.push(hit(withRead(entry, session)));
    taken.add(path);
  }

  const recent: IndexHit[] = [];
  for (const path of order) {
    if (pinned.length + recent.length >= limit) break;
    if (taken.has(path)) continue;
    const entry = entriesByPath.get(path);
    if (entry === undefined) continue;
    recent.push(hit(withRead(entry, session)));
  }

  const sections: EmptySection[] = [];
  if (pinned.length > 0) sections.push({ kind: 'pinned', hits: pinned });
  if (recent.length > 0) sections.push({ kind: 'recent', hits: recent });
  return sections;
}

/** The commands the empty palette suggests, in this order: the ones a reader reaches for from a closed book. */
export const SUGGESTED_COMMAND_IDS: readonly string[] = ['view.find', 'view.open-beside', 'view.toggle-mode'];

/** The suggested commands that apply now. Pure; the palette asks once per summons, never per keystroke. */
export function suggestedCommands(all: readonly Command[], ctx: AppContext): readonly Command[] {
  const out: Command[] = [];
  for (const id of SUGGESTED_COMMAND_IDS) {
    const cmd = all.find((c) => c.id === id);
    if (cmd !== undefined && cmd.listed !== false && cmd.when(ctx)) out.push(cmd);
  }
  return out;
}
