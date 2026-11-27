// The hue test: whether hue earns a place beside ink. Eighteen short trials, half in ink as
// the page draws it and half with hues: for error, warning, added and removed in a log or a patch, and for code in its
// language's palette (find the string, find the call), each timed from the frame it is painted in to the right click and
// reported by what was read. It is an app page (app-page.ts), not a tab: it is no file. What it measures stays on it and
// is gone when it closes; nothing is written or sent.
import { openAppPage } from './app-page.ts';

const LOG_MESSAGES = ['http: GET /v1/files 200 12ms', 'http: POST /v1/refresh 200 31ms', 'cache: hit ratio 0.94 over 5m', 'http: GET /v1/notes 304 4ms', 'index: walked 3,812 files in 1.9s', 'http: PUT /v1/session 204 18ms', 'gc: pause 3.1ms', 'http: GET /healthz 200 1ms', 'journal: compacted 412 entries', 'http: GET /v1/search 200 88ms'];
const WARN_MESSAGES = ['auth: refresh re-issued X-Session with a cookie present', 'index: a file over 40 MB was read in parts', 'http: slow request 1,204ms /v1/search'];
const ERROR_MESSAGES = ['db: deadlock detected, transaction rolled back', 'index: journal checksum mismatch, rebuilding', 'http: upstream closed the connection mid-response'];

/** Hue must be this much faster, with no more misses, to earn its place (19's rule). */
const GAIN = 0.15;

type Cond = 'ink' | 'hue';
type What = 'log' | 'patch' | 'code';

interface Row {
  readonly cells: readonly (readonly [cls: string, text: string])[];
  /** A level or a patch line's kind, for the condition's colours. */
  readonly kind: string;
}

interface Trial {
  readonly cond: Cond;
  readonly task: string;
  readonly what: What;
  readonly rows: readonly Row[];
  readonly target: number;
  /** A code trial's language: the block carries it, so the palette and the shared roles colour it as they would a fence. */
  readonly lang?: string;
}

interface Result {
  readonly cond: Cond;
  readonly what: What;
  readonly ms: number;
  readonly misses: number;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const rnd = (n: number): number => Math.floor(Math.random() * n);

function logTrial(cond: Cond): Trial {
  const err = 3 + rnd(9);
  const warns = new Set([rnd(14), rnd(14)].filter((k) => k !== err));
  const rows = Array.from({ length: 14 }, (_, k): Row => {
    const level = k === err ? 'ERROR' : warns.has(k) ? 'WARN' : 'INFO';
    const message = level === 'ERROR' ? pick(ERROR_MESSAGES) : level === 'WARN' ? pick(WARN_MESSAGES) : pick(LOG_MESSAGES);
    const time = `09:14:${String(2 + k * 3).padStart(2, '0')}.${String(rnd(999)).padStart(3, '0')}`;
    return { kind: level.toLowerCase(), cells: [['marxy-hue-time', time], ['marxy-hue-level', level], ['marxy-hue-text', message]] };
  });
  return { cond, task: 'Click the ERROR line.', what: 'log', rows, target: err };
}

function patchTrial(cond: Cond): Trial {
  const context = ['\tsid, err := issue(r.Context(), user)', '\tif err != nil {', '\t\treturn', '\t}', '\tlog.Debug("refresh", "user", user.ID)', '\tdefer span.End()'];
  const removed = ['\thttp.SetCookie(w, cookie(sid))', '\tw.Header().Set("X-Session", sid)', '\tif r.Header.Get("X-Session") != "" {'];
  const added = ['\tw.Header().Del("X-Session")', '\tmetrics.Refresh.Inc()'];
  const lines: [string, string][] = [
    ...context.slice(0, 4).map((l): [string, string] => [' ', l]),
    ...removed.slice(0, 2 + rnd(2)).map((l): [string, string] => ['-', l]),
    ...added.map((l): [string, string] => ['+', l]),
    ['+', '\thttp.SetCookie(w, cookie(sid, cookieTTL))'],
    ['+', '\treturn'],
    ...context.slice(4).map((l): [string, string] => [' ', l]),
  ];
  const head: Row = { kind: 'head', cells: [['marxy-hue-text', '@@ -41,12 +41,12 @@ func Refresh(w http.ResponseWriter, r *http.Request) {']] };
  const rows = [head, ...lines.map(([mark, text]): Row => ({ kind: mark === '+' ? 'add' : mark === '-' ? 'del' : 'same', cells: [['marxy-hue-mark', mark], ['marxy-hue-text', text]] }))];
  return { cond, task: 'Click the added line that sets a cookie.', what: 'patch', rows, target: rows.findIndex((r) => r.cells[1]?.[1].includes('cookieTTL')) };
}

// Code for the code trials: lines with no string and no call, then the lines a trial hides one of: a string, or a call.
const CODE: Readonly<Record<string, { readonly keywords: readonly string[]; readonly lines: readonly string[]; readonly string: readonly string[]; readonly call: readonly string[] }>> = {
  rust: {
    keywords: ['let', 'mut', 'const', 'if', 'else', 'while', 'match', 'return', 'fn', 'pub', 'struct', 'impl', 'for', 'in'],
    lines: ['let mut total: u32 = 0;', 'let limit = 64;', 'if total > limit {', '    total -= limit;', '}', 'let ratio: f64 = 0.75;', 'while total < 12 {', '    total += 3;', 'let ready = true;', 'const MAX: usize = 4096;', 'let step = total * 2;', 'match ready {', '    true => total,', '    false => 0,', '};', 'let mask = step & 0xff;'],
    string: ['let name = "tidemark";', 'let path = "/var/log/tide";', 'let sep = ", ";'],
    call: ['let size = measure(total);', 'flush(step);', 'let next = advance(ratio);'],
  },
  python: {
    keywords: ['if', 'else', 'elif', 'while', 'for', 'in', 'return', 'def', 'class', 'and', 'or', 'not', 'pass'],
    lines: ['total = 0', 'limit = 64', 'if total > limit:', '    total -= limit', 'ratio = 0.75', 'while total < 12:', '    total += 3', 'ready = True', 'MAX = 4096', 'step = total * 2', 'else:', '    total = limit', 'mask = step & 0xff', 'done = not ready', 'pass'],
    string: ['name = "tidemark"', 'path = "/var/log/tide"', 'sep = ", "'],
    call: ['size = measure(total)', 'flush(step)', 'nxt = advance(ratio)'],
  },
  go: {
    keywords: ['var', 'const', 'if', 'else', 'for', 'return', 'func', 'range', 'type', 'struct'],
    lines: ['var total uint32 = 0', 'limit := 64', 'if total > limit {', '\ttotal -= limit', '}', 'ratio := 0.75', 'for total < 12 {', '\ttotal += 3', 'ready := true', 'const max = 4096', 'step := total * 2', '} else {', '\ttotal = limit', 'mask := step & 0xff'],
    string: ['name := "tidemark"', 'path := "/var/log/tide"', 'sep := ", "'],
    call: ['size := measure(total)', 'flush(step)', 'next := advance(ratio)'],
  },
  typescript: {
    keywords: ['let', 'const', 'if', 'else', 'while', 'for', 'return', 'function', 'type', 'interface', 'of', 'in'],
    lines: ['let total: number = 0;', 'const limit = 64;', 'if (total > limit) {', '  total -= limit;', '}', 'const ratio = 0.75;', 'while (total < 12) {', '  total += 3;', 'const ready = true;', 'const MAX = 4096;', 'const step = total * 2;', '} else {', '  total = limit;', 'const mask = step & 0xff;'],
    string: ['const name = "tidemark";', 'const path = "/var/log/tide";', 'const sep = ", ";'],
    call: ['const size = measure(total);', 'flush(step);', 'const next = advance(ratio);'],
  },
};
const CONSTANTS = new Set(['true', 'false', 'True', 'False', 'None', 'nil', 'null']);
const TYPES = new Set(['u32', 'f64', 'usize', 'uint32', 'number', 'string', 'bool']);

/** A line in the roles the highlighter would give it: enough for a trial, not a grammar. */
export function codeCells(line: string, keywords: readonly string[]): [string, string][] {
  const cells: [string, string][] = [];
  for (const m of line.matchAll(/("[^"]*")|(\b0x[0-9a-f]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|([=+\-*<>&!:]+)|(.)/g)) {
    const [text, str, num, word, space, op] = m;
    let role = '';
    if (str) role = 'string';
    else if (num) role = 'number';
    else if (word) {
      const after = line.slice(m.index + text.length).trimStart();
      if (keywords.includes(word)) role = 'keyword';
      else if (CONSTANTS.has(word) || /^[A-Z][A-Z_]+$/.test(word)) role = 'constant';
      else if (after.startsWith('(')) role = 'function';
      else if (TYPES.has(word) || /^[A-Z][a-z]/.test(word)) role = 'type';
      else role = 'variable';
    } else if (op) role = 'operator';
    else if (!space) role = 'punctuation';
    cells.push([role ? `marxy-tok-${role}` : '', text]);
  }
  return cells;
}

function codeTrial(cond: Cond, find: 'string' | 'call'): Trial {
  const lang = pick(Object.keys(CODE));
  const src = CODE[lang]!;
  const lines = [...src.lines].sort(() => Math.random() - 0.5).slice(0, 13);
  const target = 2 + rnd(lines.length - 3);
  lines.splice(target, 0, pick(find === 'string' ? src.string : src.call));
  const rows = lines.map((l): Row => ({ kind: 'code', cells: codeCells(l, src.keywords) }));
  return { cond, task: find === 'string' ? 'Click the line with a string in it.' : 'Click the line that calls a function.', what: 'code', rows, target, lang };
}

/** Six of each kind, three in ink and three with hue, in a random order; the code trials alternate the string and the call. */
export function newTrials(): Trial[] {
  const half = (): Cond[] => ['ink', 'ink', 'ink', 'hue', 'hue', 'hue'];
  const trials = [...half().map((c) => logTrial(c)), ...half().map((c) => patchTrial(c)), ...half().map((c, k) => codeTrial(c, k % 2 ? 'call' : 'string'))];
  return trials.sort(() => Math.random() - 0.5);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Opens the hue test over the page area; the one already open is left as it is. */
export function openHueTest(): void {
  const { column } = openAppPage('hue-test', 'The hue test');
  if (column.childElementCount > 0) return;
  let trials = newTrials();
  let at = -1;
  let results: Result[] = [];
  let misses = 0;
  let shownAt = 0;

  const button = (text: string, run: () => void, primary = false): HTMLButtonElement => {
    const b = el('button', 'marxy-btn', text);
    b.type = 'button';
    if (primary) b.dataset.marxyPrimary = '';
    b.addEventListener('click', run);
    return b;
  };

  function intro(): HTMLElement[] {
    return [
      el('h1', 'marxy-huetest-title', 'The hue test'),
      el('p', 'marxy-huetest-lead', 'Ink first holds unless hue earns its place. Eighteen short trials, half in ink and half with hue: find the error in a log, the added line in a patch, or the string or the call in code, coloured in its language’s palette. Each is timed from when it appears to the right click.'),
      el('p', 'marxy-huetest-lead', `The rule: hue earns a place only if it is at least ${GAIN * 100} per cent faster with no more misses. What this measures stays on this page, and is gone when it closes.`),
    ];
  }

  function draw(): void {
    column.replaceChildren();
    if (at < 0) {
      column.append(...intro(), row(button('Start', () => next(), true)));
      return;
    }
    if (at < trials.length) {
      const t = trials[at]!;
      const head = el('p', 'marxy-huetest-head');
      head.append(el('b', '', `Trial ${at + 1} of ${trials.length}`), ` · ${t.task}`);
      const said = el('p', 'marxy-huetest-said');
      const block = el('div', `marxy-hue-trial marxy-hue-${t.what}`);
      block.dataset.marxyCond = t.cond;
      if (t.lang) block.dataset.marxyLang = t.lang;
      t.rows.forEach((r, n) => {
        const line = el('div', 'marxy-hue-row');
        line.dataset.marxyKind = r.kind;
        line.dataset.n = String(n);
        for (const [cls, text] of r.cells) line.append(el('span', cls, text));
        block.append(line);
      });
      block.addEventListener('click', (e) => {
        const line = e.target instanceof Element ? e.target.closest<HTMLElement>('.marxy-hue-row') : null;
        if (!line) return;
        if (Number(line.dataset.n) !== t.target) {
          misses++;
          said.textContent = 'Not that one.';
          return;
        }
        results.push({ cond: t.cond, what: t.what, ms: performance.now() - shownAt, misses });
        next();
      });
      column.append(head, block, said);
      return;
    }
    column.append(...intro(), outcome(), row(button('Run it again', () => {
      trials = newTrials();
      results = [];
      at = -1;
      next();
    })));
  }

  const row = (...nodes: HTMLElement[]): HTMLElement => {
    const r = el('div', 'marxy-brow');
    r.append(...nodes);
    return r;
  };

  function outcome(): HTMLElement {
    const stat = (cond: Cond, what?: What): { n: number; mean: number; misses: number } => {
      const rs = results.filter((r) => r.cond === cond && (what === undefined || r.what === what));
      return { n: rs.length, mean: rs.reduce((s, r) => s + r.ms, 0) / Math.max(1, rs.length), misses: rs.reduce((s, r) => s + r.misses, 0) };
    };
    const ink = stat('ink');
    const hue = stat('hue');
    const gain = ink.mean ? (ink.mean - hue.mean) / ink.mean : 0;
    const earned = gain >= GAIN && hue.misses <= ink.misses;
    const box = el('div');
    const table = el('table', 'marxy-huetest-table');
    const headRow = el('tr');
    for (const h of ['', 'Trials', 'Mean time', 'Misses']) headRow.append(el('th', '', h));
    table.append(headRow);
    for (const [name, s] of [['Ink', ink], ['Hue', hue]] as const) {
      const tr = el('tr');
      for (const v of [name, String(s.n), `${(s.mean / 1000).toFixed(2)} s`, String(s.misses)]) tr.append(el('td', '', v));
      table.append(tr);
    }
    const verdict = el('p', 'marxy-huetest-lead');
    verdict.append(
      el('b', '', earned ? 'Hue earned its place here.' : 'Ink first holds.'),
      ` Hue was ${Math.abs(Math.round(gain * 100))} per cent ${gain >= 0 ? 'faster' : 'slower'}, with ${hue.misses} ${hue.misses === 1 ? 'miss' : 'misses'} against ink’s ${ink.misses}. One run is one person’s morning; the rule asks for five people.`,
    );
    // Beside the whole, each kind of reading on its own, so code's palette is measured as logs and patches are.
    const byWhat = el('table', 'marxy-huetest-table marxy-huetest-by');
    const byHead = el('tr');
    for (const h of ['', 'Ink', 'Hue', 'Hue against ink', 'Misses, ink and hue']) byHead.append(el('th', '', h));
    byWhat.append(byHead);
    for (const [what, name] of [['log', 'A log'], ['patch', 'A patch'], ['code', 'Code']] as const) {
      const i = stat('ink', what);
      const h = stat('hue', what);
      const g = i.mean && h.n ? (i.mean - h.mean) / i.mean : 0;
      const tr = el('tr');
      tr.dataset.marxyWhat = what;
      for (const v of [name, `${(i.mean / 1000).toFixed(2)} s`, `${(h.mean / 1000).toFixed(2)} s`, `${Math.abs(Math.round(g * 100))} per cent ${g >= 0 ? 'faster' : 'slower'}`, `${i.misses} and ${h.misses}`]) tr.append(el('td', '', v));
      byWhat.append(tr);
    }
    box.append(table, verdict, byWhat);
    return box;
  }

  function next(): void {
    at++;
    misses = 0;
    draw();
    // Timed from the frame the trial is painted in, not from the click that asked for it.
    requestAnimationFrame(() => requestAnimationFrame(() => (shownAt = performance.now())));
  }

  at = -1;
  draw();
  column.querySelector<HTMLElement>('[data-marxy-primary]')?.focus();
}
