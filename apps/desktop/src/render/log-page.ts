// The log page: a log in Read set as a page of entries. A heading says the day and the zone the file writes its
// times in; each entry's time of day stands alone in a column, its level in another, and the pause before a slow step is
// marked ("+36 s"); an escape code is hidden and what it styles is drawn in the theme's tones (core's log/ansi.ts), with
// the account of it in the page's fold. Everything added is drawn by base.css from attributes set here, so the page's text stays the file's: a copy reads the bytes, find reads the
// file's words, and the level filter (kinds/log-view.ts) works over the same lines it always did. A piece is drawn in the
// task its lines are made (render/highlight.ts), so it is never painted undrawn.
import { LOG_ESC_CLASS, LOG_LEVEL_CLASS, LOG_TIME_CLASS, logHead, logRankOf } from '@marxy/core/src/highlight/index.ts';
import { inZone, zoneName } from '@marxy/core/src/log/summary.ts';
import { logStamp } from '@marxy/core/src/log/head.ts';
import { ansiAccount } from '@marxy/core/src/log/ansi.ts';
import { accountElement } from '../frame/account.ts';
import { sourceTextFromCode } from './invisibles-dom.ts';

/** On the article while its log's times are drawn in the reader's zone (proposals/log-zone.ts). */
export const LOG_ZONE = 'data-marxy-log-zone';
const HEADING = 'marxy-log-day';
const PIECE = 'pre.language-log.marxy-run';
/** The least pause between two entries that is marked: shorter ones are the rhythm of the log, not a step. */
const SLOW_MS = 5000;

interface Entry {
  /** What a pause is measured by: ms since the epoch, or since midnight for a time with no date. */
  readonly ms: number;
  /** The day as drawn, in the reader's zone when the page draws that; null for a time with no date. */
  readonly date: string | null;
  /** The time of day as drawn. */
  readonly clock: string;
}

const offsetAt = (ms: number): number => -new Date(Number.isFinite(ms) ? ms : Date.now()).getTimezoneOffset();

function entryOf(stamp: string, zone: boolean): Entry {
  const { date, clock, iso, ms } = logStamp(stamp);
  if (date === null || iso === null) return { ms, date: null, clock };
  const at = zone ? inZone(iso, offsetAt(ms)) : null;
  return at ? { ms, date: at.date, clock: at.time } : { ms, date, clock };
}

const longDay = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function pauseWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `+${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `+${min} min`;
  return min % 60 === 0 ? `+${Math.floor(min / 60)} h` : `+${Math.floor(min / 60)} h ${min % 60} min`;
}

/** The heading's words on the times: the zone the file writes them in, or the reader's zone they are drawn in. */
export function timesWords(stamp: string, zone: boolean): string {
  const written = /(?:Z|[+-]\d{2}:?\d{2})$/.exec(stamp)?.[0];
  if (written === undefined) return 'times as the file writes them, naming no zone';
  if (zone) {
    const at = written === 'Z' ? 'in UTC' : `at ${written.replace('-', '−')}`;
    return `times shown in your zone, ${zoneName(offsetAt(entryOf(stamp, false).ms))}; the file writes them ${at}, and Source keeps them so`;
  }
  if (written === 'Z') return 'times are UTC, as the file writes them (Z)';
  const minutes = (written[0] === '-' ? -1 : 1) * (Number(written.slice(1, 3)) * 60 + Number(written.slice(-2)));
  return `times are ${zoneName(minutes)}, as the file writes them (${written})`;
}

function set(el: HTMLElement, key: string, value: string | null): void {
  if (value === null) delete el.dataset[key];
  else if (el.dataset[key] !== value) el.dataset[key] = value;
}

/** A line's timestamp span: where its head's shape writes it, first in most, inside an access log's line. */
function timeOf(line: HTMLElement): HTMLElement | null {
  return (line.getElementsByClassName(LOG_TIME_CLASS)[0] as HTMLElement | undefined) ?? null;
}

/** The last entry of the pieces before `code`, read from their text: what the piece's first pause is measured from. */
function entryBefore(code: HTMLElement, zone: boolean): Entry | null {
  for (let pre = code.parentElement?.previousElementSibling; pre?.matches(PIECE); pre = pre.previousElementSibling) {
    const text = sourceTextFromCode(pre.firstElementChild as HTMLElement);
    for (let end = text.length; end > 0; ) {
      const start = text.lastIndexOf('\n', end - 1) + 1;
      const line = text.slice(start, end);
      const head = logHead(line);
      if (head?.time) return entryOf(line.slice(head.time[0], head.time[1]), zone);
      end = start - 1;
    }
  }
  return null;
}

/** The first timestamp of the log, from the pieces' text (the first piece need not have been lined). */
function firstStamp(first: Element): string | null {
  for (let pre: Element | null = first; pre?.matches(PIECE); pre = pre.nextElementSibling) {
    for (const line of sourceTextFromCode(pre.firstElementChild as HTMLElement).split('\n')) {
      const head = logHead(line);
      if (head?.time) return line.slice(head.time[0], head.time[1]);
    }
  }
  return null;
}

/** The escape sequences each drawn piece holds, as the file has them: the fold's account is made from them. */
const seenEscapes = new WeakMap<HTMLElement, readonly string[]>();
const accountWords = new WeakMap<HTMLElement, string>();
const ACCOUNT = 'marxy-log-account';

/** The fold under the log's first line ("How this is shown") when the log holds escape codes, saying what is drawn and what is hidden. */
function drawAccount(article: HTMLElement, drawing?: HTMLElement): void {
  // Once, when the last piece is drawn: made as pieces arrive it would be rebuilt above the page being read.
  for (const c of article.querySelectorAll<HTMLElement>(`${PIECE} > code:not([data-marxy-done])`)) if (c !== drawing) return;
  const seqs: string[] = [];
  // The piece being drawn is not marked done yet (render/highlight.ts marks it after), but its escapes are seen.
  for (const code of article.querySelectorAll<HTMLElement>(`${PIECE} > code`)) {
    if (code === drawing || code.hasAttribute('data-marxy-done')) for (const seq of seenEscapes.get(code) ?? []) seqs.push(seq);
  }
  const lines = ansiAccount(seqs);
  const held = article.querySelector<HTMLElement>(`.${ACCOUNT}`);
  const first = article.querySelector(PIECE);
  if (lines.length === 0 || first === null) {
    held?.remove();
    return;
  }
  const words = lines.join('\n');
  if (held && accountWords.get(held) === words) return;
  held?.remove();
  const box = accountElement(lines);
  if (box === null) return;
  box.classList.add(ACCOUNT);
  accountWords.set(box, words);
  const heading = first.previousElementSibling;
  (heading instanceof HTMLElement && heading.classList.contains(HEADING) ? heading : first).before(box);
}

const headingFor = new WeakMap<HTMLElement, { readonly first: Element; readonly zone: boolean }>();

/** The heading over the log's first piece: the first entry's day, and the zone its times are written or drawn in. */
function drawHeading(article: HTMLElement, zone: boolean): void {
  const first = article.querySelector(PIECE);
  if (first === null) return;
  let heading = first.previousElementSibling;
  if (!(heading instanceof HTMLElement && heading.classList.contains(HEADING))) {
    article.querySelector(`.${HEADING}`)?.remove();
    heading = document.createElement('p');
    heading.className = HEADING;
    first.before(heading);
  }
  const drawn = headingFor.get(heading as HTMLElement);
  if (drawn?.first === first && drawn.zone === zone) return;
  headingFor.set(heading as HTMLElement, { first, zone });
  const stamp = firstStamp(first);
  if (stamp === null) {
    heading.remove();
    // A log whose shape writes no time (.NET's console, Python's default) keeps no column for one.
    article.style.setProperty('--marxy-log-t', '0');
    return;
  }
  const entry = entryOf(stamp, zone);
  set(heading as HTMLElement, 'marxyDay', entry.date === null ? null : longDay(entry.date));
  set(heading as HTMLElement, 'marxyTimes', timesWords(stamp, zone));
  // The time column's width, in characters of the first time of day: base.css sets the column from it.
  article.style.setProperty('--marxy-log-t', String(entry.clock.length));
}

/** Draws one piece of a log page, its lines just made: times of day, levels, pauses, new days and escape notes. */
export function drawLogPiece(code: HTMLElement): void {
  const article = code.closest<HTMLElement>('.marxy-article');
  if (article === null) return;
  const zone = article.hasAttribute(LOG_ZONE);
  let before = entryBefore(code, zone);
  for (const line of code.querySelectorAll<HTMLElement>('.marxy-line')) {
    const time = timeOf(line);
    const level = line.getElementsByClassName(LOG_LEVEL_CLASS)[0];
    // A head has a time, a level or both: a shape may write only one of them.
    set(line, 'marxyRank', time === null && level === undefined ? null : String(logRankOf(level?.textContent ?? '') ?? 1));
    if (time === null) {
      set(line, 'marxyDay', null);
      set(line, 'marxyGap', null);
    } else {
      const entry = entryOf(time.textContent ?? '', zone);
      set(time, 'marxyShown', entry.clock);
      // A new day is said over its first entry, and stands for the pause before it.
      const day = before !== null && entry.date !== null && entry.date !== before.date ? entry.date : null;
      const pause = before !== null && day === null ? entry.ms - before.ms : 0;
      set(line, 'marxyDay', day === null ? null : longDay(day));
      set(line, 'marxyGap', pause >= SLOW_MS ? pauseWords(pause) : null);
      before = entry;
    }
  }
  seenEscapes.set(code, [...new Set([...code.getElementsByClassName(LOG_ESC_CLASS)].map((e) => sourceTextFromCode(e as HTMLElement)))]);
  drawHeading(article, zone);
  drawAccount(article, code);
}

/** Draws every lined piece of the article's log again, and its heading: the zone its times are drawn in changed. */
export function redrawLogPage(article: HTMLElement): void {
  for (const code of article.querySelectorAll<HTMLElement>(`${PIECE} > code[data-marxy-done]`)) drawLogPiece(code);
  drawHeading(article, article.hasAttribute(LOG_ZONE));
  drawAccount(article);
}
