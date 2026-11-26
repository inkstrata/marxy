// What a log holds, for the panel: how many entries at each level, the warnings and errors with their times, the first
// and last time, how many escape codes it carries, and whether its times name a zone (so they can be shown in the
// reader's). Read from the text alone with the one log-head pattern the page uses (`logHead`). Pure.
import { logHeadParts, type LogHead, type LogRank } from './head.ts';

export const LEVEL_NAMES: readonly string[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export interface LogEntry {
  readonly rank: LogRank;
  readonly level: string;
  /** The entry's time as the file writes it; empty for a shape that writes none. */
  readonly time: string;
  /** The message: the head line after the level word. */
  readonly text: string;
  /** UTF-16 offset of the entry's line. */
  readonly at: number;
}

export interface LogSummary {
  /** Entries at each rank, DEBUG to ERROR. */
  readonly counts: readonly [number, number, number, number];
  /** Warnings and errors in file order, the first `NOTABLE_MAX`. */
  readonly notable: readonly LogEntry[];
  readonly notableTotal: number;
  readonly first: string | null;
  readonly last: string | null;
  /** Every timestamp names its zone (`Z` or an offset): they can be shown in another. */
  readonly zoned: boolean;
  readonly escapes: number;
}

const NOTABLE_MAX = 40;
const ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * A summary made a line at a time: `line` takes a line and its place (`at`, whatever unit the caller counts in) and
 * returns its head, `done` the summary. One pass, the same whether the lines come from a string or from a file's bytes.
 */
export function logSummariser(): { line(line: string, at: number): LogHead | null; done(escapes: number): LogSummary } {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  const notable: LogEntry[] = [];
  let notableTotal = 0;
  let first: string | null = null;
  let last: string | null = null;
  let zoned = true;
  let heads = 0;
  return {
    line(line, at) {
      const parts = logHeadParts(line);
      if (!parts) return null;
      const { head } = parts;
      counts[head.rank]++;
      const time = head.time ? line.slice(head.time[0], head.time[1]) : '';
      if (head.time) {
        heads++;
        first ??= time;
        last = time;
        if (!ZONE.test(time)) zoned = false;
      }
      if (head.rank >= 2) {
        notableTotal++;
        if (notable.length < NOTABLE_MAX) {
          const word = head.level ? line.slice(head.level[0], head.level[1]) : '';
          // The message follows the head; a status inside the line (an access log's) leaves the line after its time.
          const from = parts.columns || head.level?.[0] === 0 ? Math.max(head.time?.[1] ?? 0, head.level?.[1] ?? 0) : (head.time?.[1] ?? 0);
          const level = /^[A-Za-z]+$/.test(word) ? word.toUpperCase() : LEVEL_NAMES[head.rank]!;
          notable.push({ rank: head.rank, level, time, text: line.slice(from).replace(/^[\]\s:-]+/, '').trim(), at });
        }
      }
      return head;
    },
    done: (escapes) => ({ counts, notable, notableTotal, first, last, zoned: zoned && heads > 0, escapes }),
  };
}

export function summariseLog(text: string): LogSummary {
  const sum = logSummariser();
  let at = 0;
  for (const line of text.split('\n')) {
    sum.line(line, at);
    at += line.length + 1;
  }
  return sum.done((text.match(/\u001b/g) ?? []).length);
}

/** A zone's offset from UTC said as the page says it: "UTC", "UTC−04:00", "UTC+05:30". */
export function zoneName(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes > 0 ? '+' : '−';
  const m = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * An ISO timestamp that names its zone, as the same instant in a zone `offsetMinutes` east of UTC: the date and the time
 * of day, with the fraction of a second kept to the digits the file wrote. Null for a time that names no zone.
 */
export function inZone(iso: string, offsetMinutes: number): { readonly date: string; readonly time: string } | null {
  if (!ZONE.test(iso)) return null;
  const ms = Date.parse(iso.replace(' ', 'T'));
  if (!Number.isFinite(ms)) return null;
  const fraction = /[.,](\d+)/.exec(iso)?.[1] ?? '';
  const d = new Date(ms + offsetMinutes * 60_000);
  const two = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const frac = fraction ? `.${String(d.getUTCMilliseconds()).padStart(3, '0').slice(0, Math.min(3, fraction.length))}${fraction.slice(3)}` : '';
  return { date, time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}${frac}` };
}
