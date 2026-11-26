// What opens a log line: its time, its level, or both, in the shapes the common writers use. Detection, the page's runs,
// the level filter, the panel's counts and the parse's pieces all ask `logHead`, so one set of shapes says what a log
// line is. Pure.

/** A level's rank: 0 trace and debug, 1 info and notice, 2 warn, 3 error, fatal, critical, severe, alert and emergency. */
export type LogRank = 0 | 1 | 2 | 3;

/**
 * A line that opens as a log's lines do: its rank and where its time and its level sit (UTF-16 offsets). A shape that
 * writes no level (syslog as a file, most of WindowsUpdate.log) has a time and no level, and its line ranks as info; one
 * that writes no time (Python's default, .NET's console) has a level and no time.
 */
export interface LogHead {
  readonly rank: LogRank;
  readonly time: readonly [number, number] | null;
  readonly level: readonly [number, number] | null;
}

/** A head and how its line is laid out: `columns` when the time opens the line and the level follows it, as the log page sets them. */
export interface LogHeadParts {
  readonly head: LogHead;
  readonly columns: boolean;
}

/** The most of a line any shape reads: an IIS line's status sits near its end, past a user agent. */
export const LOG_HEAD_CHARS = 4096;

const RANK_OF_WORD: Readonly<Record<string, LogRank>> = {
  trace: 0, trce: 0, debug: 0, dbug: 0, dbg: 0, verbose: 0, vrb: 0,
  info: 1, inf: 1, notice: 1, perf: 1,
  warn: 2, warning: 2, wrn: 2,
  error: 3, err: 3, fail: 3, failed: 3, fatal: 3, ftl: 3, critical: 3, crit: 3, severe: 3, alert: 3, emerg: 3, emergency: 3,
};

/**
 * A level token's rank: a level word (`ERROR`, Serilog's `ERR`, .NET's `fail`), a syslog priority (`<34>`, its severity
 * the remainder by 8), or an HTTP status (5xx an error, 4xx a warning). Undefined for a token that is none of them.
 */
export function logRankOf(token: string): LogRank | undefined {
  const word = token.toLowerCase();
  const pri = /^<(\d{1,3})>$/.exec(word);
  if (pri) {
    const severity = Number(pri[1]) % 8;
    return severity <= 3 ? 3 : severity === 4 ? 2 : severity === 7 ? 0 : 1;
  }
  if (/^[1-5]\d\d$/.test(word)) return word[0] === '5' ? 3 : word[0] === '4' ? 2 : 1;
  if (/^trace[1-8]$/.test(word)) return 0;
  return Object.prototype.hasOwnProperty.call(RANK_OF_WORD, word) ? RANK_OF_WORD[word] : undefined;
}

const DATE_TIME = String.raw`\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?: ?(?:Z|[+-]\d{2}:?\d{2}))?`;
const TIME = String.raw`\d{2}:\d{2}:\d{2}(?:[.,]\d+)?`;
const LEVEL_WORDS = 'TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|CRIT|SEVERE|ALERT|EMERG|EMERGENCY|VERBOSE|VRB|DBG|INF|WRN|FTL|PERF';
const MONTH = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const METHOD = 'GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE|PROPFIND|PROPPATCH|MKCOL|COPY|MOVE|LOCK|UNLOCK|RPC_IN_DATA|RPC_OUT_DATA';

interface Shape {
  readonly re: RegExp;
  readonly columns: boolean;
}

/**
 * The shapes, tried in order; `t` is the time and `l` the level. Each is anchored at the line's start and says enough of
 * its format (a level word where the format puts one, a host and a tag, a method and a status) that a dated note is none.
 */
const SHAPES: readonly Shape[] = [
  // A time, then a level word, with what writers put between: a closing bracket, spaces, a comma (CBS and DISM), a
  // `[thread]` (log4j), a `local.` (Laravel), a `name - ` (Python's asctime format). Also nginx's error log and Serilog.
  // At most four fields, and no two kinds of field read the same text (a `name.` only right before the level word): a
  // repeat of fields that overlap is exponential on a line such as `x.y - x.y - …` with no level after it.
  {
    re: new RegExp(String.raw`^\[?(?<t>${DATE_TIME}|${TIME})\]?[\s|,\-[]*(?:\[[^\]\r\n]{1,64}\][\s|\-]*|[\w.]{1,64} - |[A-Za-z][\w-]{0,31}\.(?=(?:${LEVEL_WORDS})\b)){0,4}(?<l>${LEVEL_WORDS})\b`, 'id'),
    columns: true,
  },
  // .NET's console logger: `fail: Category[event]`, after a time when the host asks for one.
  { re: new RegExp(String.raw`^(?:\[?(?<t>(?:\d{4}-\d{2}-\d{2}[T ])?${TIME})\]? )?(?<l>trce|dbug|info|warn|fail|crit): (?=\S+\[\d+\])`, 'd'), columns: true },
  // Python's logging with its default format: `WARNING:root:message`.
  { re: /^(?<l>CRITICAL|ERROR|WARNING|INFO|DEBUG):(?=[^\s:]+:)/d, columns: true },
  // WindowsUpdate.log as Windows 7 to 8.1 wrote it, and as Get-WindowsUpdateLog decodes it: time, process, thread,
  // component, and a level word only where the line is a warning or a failure.
  { re: /^(?<t>\d{4}-\d{2}-\d{2}\t\d{2}:\d{2}:\d{2}:\d{3})\t *\d+\t[0-9A-Fa-f]+\t[^\t]+\t(?:(?<l>WARNING|FATAL|ERROR|FAILED)(?=:))?/d, columns: true },
  { re: /^(?<t>\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d{7}) +\d+ +\d+ +\S+ +(?:(?<l>WARNING|FATAL|ERROR|FAILED)(?=:))?/d, columns: true },
  // IIS in W3C's default fields: the status, substatus, Win32 status and time taken close the line.
  { re: new RegExp(String.raw`^(?<t>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (?:\S+ ){0,3}?(?:${METHOD}) \S+ .*? (?<l>[1-5]\d\d) \d+ \d+ \d+\r?$`, 'd'), columns: false },
  // nginx's and Apache's access logs (common and combined): the time in brackets after the client, the status after the request.
  { re: /^\S+ \S+ \S+ \[(?<t>\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "[^"\r\n]*" (?<l>[1-5]\d\d) (?:\d+|-)/d, columns: false },
  // Apache's error log: `[Fri Mar 01 12:00:00.123456 2024] [core:error] [pid 123] …`, and 2.2's `[error]` with no module.
  { re: new RegExp(String.raw`^\[(?<t>(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:${MONTH}) [ \d]\d \d{2}:\d{2}:\d{2}(?:\.\d{1,6})? \d{4})\] \[(?:[\w-]{1,32}:)?(?<l>emerg|alert|crit|error|warn|notice|info|debug|trace[1-8])\]`, 'd'), columns: true },
  // Syslog, RFC 5424: priority, version 1, time, host, app, process, message id.
  { re: /^(?<l><\d{1,3}>)1 (?<t>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})) \S+ \S+ \S+ \S+ /d, columns: false },
  // Syslog, RFC 3164, with its priority or as a file has it without: time, host, tag and a colon.
  { re: new RegExp(String.raw`^(?<l><\d{1,3}>)?(?<t>(?:${MONTH}) [ \d]\d \d{2}:\d{2}:\d{2}) \S+ [^\s:[\]]+(?:\[\d+\])?: `, 'd'), columns: false },
  // Syslog as rsyslog writes it today: a time to the microsecond with its zone, host, tag and a colon.
  { re: /^(?<t>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}(?:Z|[+-]\d{2}:\d{2})) \S+ [^\s:[\]]+(?:\[\d+\])?: /d, columns: false },
];

/** A head opens with a bracket, a digit, a `<` or a letter: a stack frame, a wrapped message or a blank line is rejected here. */
function mayOpen(c: number): boolean {
  return c === 0x5b || c === 0x3c || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** `line` as a log head with its layout, or null for a continuation line. */
export function logHeadParts(line: string): LogHeadParts | null {
  if (line === '' || !mayOpen(line.charCodeAt(0))) return null;
  const text = line.length > LOG_HEAD_CHARS ? line.slice(0, LOG_HEAD_CHARS) : line;
  for (const shape of SHAPES) {
    const m = shape.re.exec(text);
    if (m === null) continue;
    const at = m.indices!.groups!;
    const time = at.t ? ([at.t[0], at.t[1]] as const) : null;
    const level = at.l ? ([at.l[0], at.l[1]] as const) : null;
    if (time === null && level === null) continue;
    const rank = level === null ? 1 : (logRankOf(line.slice(level[0], level[1])) ?? 1);
    return { head: { rank, time, level }, columns: shape.columns && time !== null && level !== null };
  }
  return null;
}

/** `line` as a log head, or null for a continuation line. */
export function logHead(line: string): LogHead | null {
  return logHeadParts(line)?.head ?? null;
}

const MONTHS = MONTH.split('|');
/** A zone as ISO 8601 writes it, `+00:00`: not every engine's Date.parse reads `+0000`. */
const zoneOf = (zone: string | undefined): string => (zone === undefined ? '' : zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2'));

/**
 * A head's time as the page reads it: the day when the time names one (`YYYY-MM-DD`), the time of day as the file writes
 * it, the instant as ISO 8601 when it has a day (its zone kept, its fraction as written), and what a pause is measured by:
 * ms since the epoch, or since midnight for a time with no day.
 */
export function logStamp(stamp: string): { readonly date: string | null; readonly clock: string; readonly iso: string | null; readonly ms: number } {
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})[T \t](\d{2}:\d{2}:\d{2})(?:[.,:](\d+))? ?(Z|[+-]\d{2}:?\d{2})?$/.exec(stamp);
  const web = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/.exec(stamp);
  const apache = /^[A-Za-z]{3} ([A-Za-z]{3}) ([ \d]\d) (\d{2}:\d{2}:\d{2})(?:\.(\d+))? (\d{4})$/.exec(stamp);
  const clock = (iso ? stamp.slice(11) : web ? `${web[4]}` : (/\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/.exec(stamp)?.[0] ?? stamp)).replace(/ ?(?:Z|[+-]\d{2}:?\d{2})$/, '');
  const monthOf = (name: string): string | null => {
    const n = MONTHS.indexOf(name[0]!.toUpperCase() + name.slice(1).toLowerCase()) + 1;
    return n > 0 ? String(n).padStart(2, '0') : null;
  };
  let date: string | null = null;
  let full: string | null = null;
  if (iso) {
    date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    full = `${date}T${iso[4]}${iso[5] ? `.${iso[5]}` : ''}${zoneOf(iso[6])}`;
  } else if (web) {
    const month = monthOf(web[2]!);
    if (month !== null) {
      date = `${web[3]}-${month}-${web[1]}`;
      full = `${date}T${web[4]}${zoneOf(web[5])}`;
    }
  } else if (apache) {
    const month = monthOf(apache[1]!);
    if (month !== null) {
      date = `${apache[5]}-${month}-${apache[2]!.trim().padStart(2, '0')}`;
      full = `${date}T${apache[3]}${apache[4] ? `.${apache[4]}` : ''}`;
    }
  }
  if (full !== null) {
    // Date.parse takes a dot and three digits of a second; a file may write more.
    const ms = Date.parse(full.replace(/(\.\d{3})\d+/, '$1'));
    if (Number.isFinite(ms)) return { date, clock, iso: full, ms };
  }
  const [h, m, s] = (/(\d{2}):(\d{2}):(\d{2}(?:[.,]\d+)?)/.exec(clock)?.slice(1) ?? ['0', '0', '0']).map((n) => Number(n.replace(',', '.')));
  return { date: null, clock, iso: null, ms: ((h! * 60 + m!) * 60 + s!) * 1000 };
}
