// A log's ANSI escape codes, read as styling. One module for both log readings (the log page's runs and the Lines rows), so
// they draw the same colours. A colour is never drawn as written: it maps to one of the theme's own tones, so a log reads
// on any theme. Nothing is run: a cursor move or a window title is hidden and named, not obeyed. Style does not carry over
// a line break (a terminal's would): the lines of a big log are drawn on their own, a screen at a time.

/** The theme tones a colour code can map to; base.css sets each as a colour (`marxy-ansi-<tone>`). */
export type AnsiTone = 'warn' | 'err' | 'ok' | 'blue' | 'magenta' | 'cyan' | 'muted';

export interface AnsiStyle {
  readonly tone: AnsiTone | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

export const ANSI_BLANK: AnsiStyle = { tone: null, bold: false, dim: false, italic: false, underline: false };

/** An escape sequence hidden by the page: its class. A sequence that is cut short or garbled also carries `ANSI_BAD_CLASS`. */
export const ANSI_ESC_CLASS = 'marxy-log-esc';
export const ANSI_BAD_CLASS = 'marxy-log-esc-bad';

export interface AnsiRun {
  readonly text: string;
  /** Null for text; for an escape sequence what it is: SGR (styling), a control (cursor, clear, title), or SGR that cannot be read. */
  readonly esc: 'sgr' | 'control' | 'bad' | null;
  /** The style the text is drawn in; null for none, and for every escape sequence. */
  readonly style: AnsiStyle | null;
}

const COLOUR_WORDS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
/** The tone of each of the eight standard colours: black and white are the page's own ink, so they have none. */
const STANDARD: readonly (AnsiTone | null)[] = [null, 'err', 'ok', 'warn', 'blue', 'magenta', 'cyan', null];

/** What each tone is called in the page's account. */
export const TONE_WORDS: Readonly<Record<AnsiTone, string>> = {
  warn: 'warning tone',
  err: 'error tone',
  ok: 'string tone',
  blue: 'blue tone',
  magenta: 'magenta tone',
  cyan: 'cyan tone',
  muted: 'muted tone',
};

/** A reference colour for each hue the tones stand for; a colour code takes the nearest. */
const REFERENCE: readonly (readonly [AnsiTone, number, number, number])[] = [
  ['err', 205, 49, 49],
  ['ok', 13, 188, 121],
  ['warn', 229, 229, 16],
  ['blue', 36, 114, 200],
  ['magenta', 188, 63, 188],
  ['cyan', 17, 168, 205],
];

/** The tone nearest a written colour. A grey is the muted tone when it is mid-way, and the page's own ink otherwise. */
export function nearestTone(r: number, g: number, b: number): AnsiTone | null {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi - lo < 48) {
    const luma = (r + g + b) / 3;
    return luma >= 60 && luma <= 170 ? 'muted' : null;
  }
  let best: AnsiTone | null = null;
  let near = Infinity;
  for (const [tone, tr, tg, tb] of REFERENCE) {
    const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (d < near) {
      near = d;
      best = tone;
    }
  }
  return best;
}

const CUBE = [0, 95, 135, 175, 215, 255];

/** The tone of a 256-colour index. */
function toneOf256(n: number): AnsiTone | null {
  if (n < 8) return STANDARD[n]!;
  if (n < 16) return n === 8 ? 'muted' : STANDARD[n - 8]!;
  if (n < 232) {
    const c = n - 16;
    return nearestTone(CUBE[Math.floor(c / 36)]!, CUBE[Math.floor(c / 6) % 6]!, CUBE[c % 6]!);
  }
  const grey = 8 + (n - 232) * 10;
  return nearestTone(grey, grey, grey);
}

type Effect =
  | { readonly k: 'reset' }
  | { readonly k: 'bold' | 'dim' | 'italic' | 'underline'; readonly on: boolean }
  | { readonly k: 'tone'; readonly tone: AnsiTone | null; readonly written: string };

const isByte = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 255;
const num = (s: string | undefined): number => (s === undefined || !/^\d+$/.test(s) ? NaN : Number(s));

/**
 * What SGR parameters ask for, or null when they cannot be read: a number that is not one, or a 38 or 48 that does not end
 * in a colour. Backgrounds are read and dropped: a tone is drawn as text, never as a fill.
 */
function sgrEffects(params: string): Effect[] | null {
  const out: Effect[] = [];
  const parts = params === '' ? ['0'] : params.split(';');
  for (let i = 0; i < parts.length; i++) {
    const colon = parts[i]!.split(':');
    // `38:5:n` and `38:2:[space]:r:g:b`, the form that keeps its parameters together.
    const joined = colon.length > 1;
    const code = colon[0] === '' ? 0 : num(colon[0]);
    if (Number.isNaN(code)) return null;
    if (code === 38 || code === 48) {
      const mode = joined ? num(colon[1]) : num(parts[i + 1]);
      let rgb: number[] | null = null;
      let index = NaN;
      if (mode === 5) {
        index = joined ? num(colon[2]) : num(parts[i + 2]);
        if (!isByte(index)) return null;
        if (!joined) i += 2;
      } else if (mode === 2) {
        rgb = joined ? colon.slice(-3).map(num) : [num(parts[i + 2]), num(parts[i + 3]), num(parts[i + 4])];
        if (!rgb.every(isByte) || (joined && colon.length < 5)) return null;
        if (!joined) i += 4;
      } else return null;
      if (code === 38) {
        out.push(rgb ? { k: 'tone', tone: nearestTone(rgb[0]!, rgb[1]!, rgb[2]!), written: 'a truecolour code' } : { k: 'tone', tone: toneOf256(index), written: 'a 256-colour code' });
      }
      continue;
    }
    if (joined && colon.slice(1).some((p) => p !== '' && Number.isNaN(num(p)))) return null;
    if (code === 0) out.push({ k: 'reset' });
    else if (code === 1) out.push({ k: 'bold', on: true });
    else if (code === 2) out.push({ k: 'dim', on: true });
    else if (code === 3) out.push({ k: 'italic', on: true });
    else if (code === 4) out.push({ k: 'underline', on: true });
    else if (code === 22) out.push({ k: 'bold', on: false }, { k: 'dim', on: false });
    else if (code === 23) out.push({ k: 'italic', on: false });
    else if (code === 24) out.push({ k: 'underline', on: false });
    else if (code === 39) out.push({ k: 'tone', tone: null, written: '' });
    else if (code >= 30 && code <= 37) out.push({ k: 'tone', tone: STANDARD[code - 30]!, written: COLOUR_WORDS[code - 30]! });
    else if (code >= 90 && code <= 97) {
      out.push({ k: 'tone', tone: code === 90 ? 'muted' : STANDARD[code - 90]!, written: `bright ${COLOUR_WORDS[code - 90]}` });
    }
    // Everything else (blink, reverse, strike-through, backgrounds, fonts) is read and not drawn.
  }
  return out;
}

function applied(style: AnsiStyle, effects: readonly Effect[]): AnsiStyle {
  let s = style;
  for (const e of effects) {
    if (e.k === 'reset') s = ANSI_BLANK;
    else if (e.k === 'tone') s = { ...s, tone: e.tone };
    else s = { ...s, [e.k]: e.on };
  }
  return s;
}

const isBlank = (s: AnsiStyle): boolean => s.tone === null && !s.bold && !s.dim && !s.italic && !s.underline;

/** CSI (ESC `[`, parameters, intermediates, a final byte) and OSC (ESC `]`, a body, BEL or ESC `\`). */
const SEQUENCE = /\u001b(?:\[([0-?]*)([ -\/]*)([@-~])|\]([^\u0007\u001b]{0,256})(?:\u0007|\u001b\\))/g;

/**
 * `text` (one line) as runs: its escape sequences and the text between them with the style the sequences before it ask
 * for. A sequence that is not whole (no final byte, an OSC with no end) is not one: it stays in the text, as the file has it.
 */
export function ansiRuns(text: string): AnsiRun[] {
  if (text === '') return [];
  if (!text.includes('\u001b')) return [{ text, esc: null, style: null }];
  const runs: AnsiRun[] = [];
  let style = ANSI_BLANK;
  let at = 0;
  const plain = (to: number): void => {
    if (to > at) runs.push({ text: text.slice(at, to), esc: null, style: isBlank(style) ? null : style });
  };
  for (const m of text.matchAll(SEQUENCE)) {
    plain(m.index);
    let esc: AnsiRun['esc'] = 'control';
    if (m[3] === 'm' && m[2] === '' && /^[0-9;:]*$/.test(m[1]!)) {
      const effects = sgrEffects(m[1]!);
      if (effects === null) esc = 'bad';
      else {
        esc = 'sgr';
        style = applied(style, effects);
      }
    }
    runs.push({ text: m[0], esc, style: null });
    at = m.index + m[0].length;
  }
  plain(text.length);
  return runs;
}

/** The classes a styled run is drawn with; empty for none. */
export function ansiClasses(style: AnsiStyle): string {
  const out: string[] = [];
  if (style.tone !== null) out.push(`marxy-ansi-${style.tone}`);
  else if (style.dim) out.push('marxy-ansi-muted');
  if (style.bold) out.push('marxy-ansi-bold');
  if (style.italic) out.push('marxy-ansi-italic');
  if (style.underline) out.push('marxy-ansi-underline');
  return out.join(' ');
}

/** The classes an escape sequence is hidden with. */
export const ansiEscClasses = (esc: 'sgr' | 'control' | 'bad'): string => (esc === 'bad' ? `${ANSI_ESC_CLASS} ${ANSI_BAD_CLASS}` : ANSI_ESC_CLASS);

const CSI_WORDS: Readonly<Record<string, string>> = {
  A: 'cursor movement', B: 'cursor movement', C: 'cursor movement', D: 'cursor movement', E: 'cursor movement',
  F: 'cursor movement', G: 'cursor movement', H: 'cursor movement', f: 'cursor movement', J: 'clearing the screen',
  K: 'clearing the line', S: 'scrolling', T: 'scrolling',
};

/** What a control sequence asks the terminal for, in words. */
function controlWord(seq: string): string {
  if (seq[1] === ']') {
    const n = /^\u001b\](\d*)/.exec(seq)![1];
    return n === '0' || n === '1' || n === '2' ? 'a window title' : n === '8' ? 'a link address' : 'a terminal command';
  }
  return CSI_WORDS[seq.at(-1)!] ?? 'a terminal control';
}

const listed = (words: readonly string[]): string => (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * The sentences for the page's fold ("How this is shown") when a log holds escape sequences (`seqs`, each as the file has
 * it, repeats welcome): what is drawn, what is hidden and not run, and what is shown as written. Empty for none.
 */
export function ansiAccount(seqs: Iterable<string>): string[] {
  const drawn = new Set<string>();
  const controls = new Set<string>();
  let bad = 0;
  let any = false;
  const seen = new Set<string>();
  for (const seq of seqs) {
    if (seen.has(seq)) continue;
    seen.add(seq);
    any = true;
    const m = /^\u001b\[([0-?]*)([ -\/]*)m$/.exec(seq);
    if (m === null || m[2] !== '' || !/^[0-9;:]*$/.test(m[1]!)) {
      controls.add(controlWord(seq));
      continue;
    }
    const effects = sgrEffects(m[1]!);
    if (effects === null) {
      bad++;
      continue;
    }
    for (const e of effects) {
      if (e.k === 'tone' && e.tone !== null) drawn.add(`${e.written} as the ${TONE_WORDS[e.tone]}`);
      else if (e.k === 'bold' && e.on) drawn.add('bold as weight');
      else if (e.k === 'dim' && e.on) drawn.add('dim as the muted tone');
      else if (e.k === 'italic' && e.on) drawn.add('italics');
      else if (e.k === 'underline' && e.on) drawn.add('underlining');
    }
  }
  if (!any) return [];
  const lines: string[] = [];
  if (drawn.size > 0) {
    lines.push(
      `The file colours text with escape codes. Marxy hides them and draws the text in the theme's own tones, never the colour written: here ${listed([...drawn])}.`,
    );
  } else if (bad === 0 && controls.size === 0) lines.push('The file holds escape codes that only reset colour; Marxy hides them.');
  if (controls.size > 0) lines.push(`It also asks the terminal for ${listed([...controls])}. Those codes are hidden and not run.`);
  if (bad > 0) lines.push(`${bad === 1 ? 'One code is' : `${bad} codes are`} cut short or garbled and shown as written.`);
  lines.push('X-ray and Source show the bytes, escapes included.');
  return lines;
}
