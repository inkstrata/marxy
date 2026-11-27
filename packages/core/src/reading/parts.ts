// The fenced parts of a Markdown page, each read as its own kind: a data fence as its format's reading, a
// session as a terminal session, a patch with its word marks, a log as a log. The fence's language decides; a fence that
// names none is read from its text, and says so. Pure: it reads the parse and the bytes, and writes nothing.
import type { CodeBlock, Document, Node } from '../contracts/ast.ts';
import { isTerminalLang } from '../highlight/terminal-lines.ts';
import { PROMPT } from '../kind/detect.ts';
import { logHead } from '../log/head.ts';
import { readingOf, type Reading } from './index.ts';
import { own as ownEntry } from '../util/text.ts';

/** How a part can be read. `written` is the fence as the page sets any code fence: its text, coloured by its language. */
export type PartReading = 'data' | 'table' | 'session' | 'patch' | 'log' | 'diagram' | 'written';

export interface Part {
  /** The fence's bytes, its fence lines included (the code block's `src`). */
  readonly start: number;
  readonly end: number;
  /** The bytes between the fence lines. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** 1-based: the opening fence's line and the closing one's (or the last line, for a fence left open). */
  readonly firstLine: number;
  readonly lastLine: number;
  /** The fence's language, lower case; '' when it names none. */
  readonly lang: string;
  /** How the page reads it unless the reader chooses otherwise. */
  readonly guess: PartReading;
  /** What decided: the fence's language, or (a fence naming none, or `text`) what is in it. */
  readonly from: 'fence' | 'text';
  readonly reasons: readonly string[];
  /** Every way it can be read, the guess first. One way means there is no other. */
  readonly ways: readonly PartReading[];
  /** Why a data fence is set as written: what did not read, at which line of the file. */
  readonly note: string | null;
  /** What a choice is kept by: its first line of content and how many parts before it start the same, so twins differ. */
  readonly key: string;
}

/** How the Reading card and the block menu say each reading: a word in the card's list, a phrase in a menu. */
export const PART_WORDS: Readonly<Record<PartReading, { readonly short: string; readonly long: string }>> = {
  data: { short: 'data', long: 'a data tree' },
  table: { short: 'table', long: 'a table' },
  session: { short: 'session', long: 'terminal session' },
  patch: { short: 'patch', long: 'a patch' },
  log: { short: 'log', long: 'a log' },
  diagram: { short: 'diagram', long: 'a diagram' },
  written: { short: 'as written', long: 'as written' },
};

/** The fence languages read as data, and the name their reading takes them by. */
const DATA_FENCES: Readonly<Record<string, string>> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  csv: 'csv',
  tsv: 'tsv',
};
const SHELL_FENCES: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'shell']);
const PATCH_FENCES: ReadonlySet<string> = new Set(['diff', 'patch']);
/** A fence that names these names nothing: its text decides. */
const PLAIN_FENCES: ReadonlySet<string> = new Set(['', 'text', 'txt', 'plain', 'plaintext']);

/** The language the page's highlighter is given for a part read as a session, a patch or a log. */
export const PART_LANGUAGE: Readonly<Partial<Record<PartReading, string>>> = { session: 'console', patch: 'diff', log: 'log' };

/** Whether a fence's own language is one of the readings: set as written, such a fence is not coloured as that reading. */
export const isReadingLanguage = (lang: string): boolean => isTerminalLang(lang) || PATCH_FENCES.has(lang) || lang === 'log';

function codeBlocks(doc: Document): CodeBlock[] {
  const out: CodeBlock[] = [];
  const walk = (node: Node): void => {
    // A piece of a code file read as code is the whole file, not a part of a page.
    if (node.type === 'codeBlock') {
      if (!(node as CodeBlock).run) out.push(node as CodeBlock);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc);
  return out;
}

/**
 * The content bytes, when they are the block's text and nothing else: inside a quote or a list item they also hold the
 * container's marks and indentation, and a reading of those would put its rows at the wrong bytes.
 */
function ownText(block: CodeBlock, bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes.subarray(block.content.start, block.content.end));
  const v = block.value;
  return text === v || text === `${v}\n` || text === `${v}\r\n` || text === `${v}\r` ? v : null;
}

const lines = (text: string): string[] => text.split(/\r\n|\r|\n/);
const lineList = (ns: readonly number[]): string =>
  ns.length === 1 ? `Line ${ns[0]}` : ns.length === 2 ? `Lines ${ns[0]} and ${ns[1]}` : `Lines ${ns[0]}, ${ns[1]} and ${ns.length - 2} more`;

/** The lines that open with a prompt, by the prompt detection reads, when the first line that is not blank is one. */
function promptLines(rows: readonly string[], first: number): number[] | null {
  const opening = rows.find((l) => l.trim() !== '');
  if (opening === undefined || !PROMPT.test(opening)) return null;
  const out: number[] = [];
  rows.forEach((l, i) => {
    if (PROMPT.test(l)) out.push(first + i);
  });
  return out;
}

function looksLikePatch(rows: readonly string[]): boolean {
  if (rows.some((l) => l.startsWith('@@ ') || l.startsWith('diff --git '))) return true;
  return rows.some((l, i) => l.startsWith('--- ') && (rows[i + 1] ?? '').startsWith('+++ '));
}

function logLines(rows: readonly string[], first: number): number[] | null {
  const full = rows.filter((l) => l.trim() !== '');
  const timed: number[] = [];
  rows.forEach((l, i) => {
    if (logHead(l) !== null) timed.push(first + i);
  });
  return timed.length >= 2 && timed.length >= 0.6 * full.length ? timed : null;
}

const code = (s: string): string => `\`${s}\``;

// ---- the data reading of a part -------------------------------------------------------------------------------------

const readings = new WeakMap<Uint8Array, Map<number, Reading | null>>();

/** `html` with every byte range moved by `by`: a reading of the content's bytes, set at the content's place in the file. */
const shiftRanges = (html: string, by: number): string =>
  html.replace(/ data-marxy-(s|e)="(\d+)"/g, (_, which: string, n: string) => ` data-marxy-${which}="${Number(n) + by}"`);

/**
 * The reading of a data part's content, as the format's reading of a file of those bytes would be, with every
 * `data-marxy-s` / `data-marxy-e` (and every contents row) at the file's bytes. Null when it does not read.
 */
export function partReading(part: Pick<Part, 'contentStart' | 'contentEnd' | 'lang'>, bytes: Uint8Array): Reading | null {
  const format = ownEntry(DATA_FENCES, part.lang);
  if (format === undefined) return null;
  let byStart = readings.get(bytes);
  if (!byStart) readings.set(bytes, (byStart = new Map()));
  const held = byStart.get(part.contentStart);
  if (held !== undefined) return held;
  const raw = readingOf(`part.${format}`, bytes.subarray(part.contentStart, part.contentEnd), 'data');
  const by = part.contentStart;
  const made: Reading | null =
    raw === null
      ? raw
      : raw.failed !== null
        ? // A fence has no Lines page to mount a windowed body in: a fence that does not read is as written however long.
          { ...raw, id: 'written', name: 'written' }
        : {
          ...raw,
          html: shiftRanges(raw.html, by),
          contents: raw.contents ? { title: raw.contents.title, items: raw.contents.items.map((i) => ({ ...i, byte: i.byte + by })) } : null,
        };
  byStart.set(part.contentStart, made);
  return made;
}

/** Reads `text` as JSON the way a `json` fence is read, for a fence that names no language. */
function readsAsJson(block: CodeBlock, bytes: Uint8Array): boolean {
  const head = block.value.trimStart()[0];
  if (head !== '{' && head !== '[') return false;
  const r = partReading({ contentStart: block.content.start, contentEnd: block.content.end, lang: 'json' }, bytes);
  return r !== null && r.id === 'tree';
}

// ---- the parts -----------------------------------------------------------------------------------------------------

interface Decided {
  readonly guess: PartReading;
  readonly from: 'fence' | 'text';
  readonly reasons: string[];
  readonly ways: PartReading[];
  readonly note: string | null;
}

function decide(block: CodeBlock, bytes: Uint8Array, lang: string, firstContentLine: number): Decided {
  const own = ownText(block, bytes);
  const rows = lines(block.value);
  const says = `The fence says ${code(lang)}.`;
  if (ownEntry(DATA_FENCES, lang) !== undefined) {
    const kind: PartReading = lang === 'csv' || lang === 'tsv' ? 'table' : 'data';
    if (own === null) return { guess: 'written', from: 'fence', reasons: [says, 'It sits in a list or a quote: its lines are not the file’s lines as they stand, so it is set as written.'], ways: ['written'], note: null };
    const r = partReading({ contentStart: block.content.start, contentEnd: block.content.end, lang }, bytes);
    if (r === null || r.failed !== null || r.id === 'written') {
      const at = r?.failed ? ` at line ${firstContentLine + r.failed.line - 1}, ${r.failed.why}` : '';
      const what = r?.failed ? `${r.format} that does not read${at}` : `${r?.format ?? lang.toUpperCase()} with too little in it to read`;
      return { guess: 'written', from: 'fence', reasons: [says, `${what}: set as written.`], ways: ['written'], note: what };
    }
    return { guess: kind, from: 'fence', reasons: [says, `It reads as ${r.format}: ${r.name}.`], ways: [kind, 'written'], note: null };
  }
  if (lang === 'mermaid') {
    return { guess: 'diagram', from: 'fence', reasons: [says, 'It is drawn as a diagram, its source a click away.'], ways: ['diagram', 'written'], note: null };
  }
  if (isTerminalLang(lang)) return { guess: 'session', from: 'fence', reasons: [says], ways: ['session', 'written'], note: null };
  if (PATCH_FENCES.has(lang)) return { guess: 'patch', from: 'fence', reasons: [says], ways: ['patch', 'written'], note: null };
  if (lang === 'log') return { guess: 'log', from: 'fence', reasons: [says], ways: ['log', 'written'], note: null };
  if (SHELL_FENCES.has(lang)) {
    const prompts = promptLines(rows, firstContentLine);
    if (prompts) {
      return { guess: 'session', from: 'fence', reasons: [`The fence says ${code(lang)}, and ${lineList(prompts).toLowerCase()} begin with a prompt.`], ways: ['session', 'written'], note: null };
    }
    return { guess: 'written', from: 'fence', reasons: [`The fence says ${code(lang)} and no line begins with a prompt: a script, as written.`], ways: ['written'], note: null };
  }
  if (!PLAIN_FENCES.has(lang)) return { guess: 'written', from: 'fence', reasons: [`The fence says ${code(lang)}: code, as written.`], ways: ['written'], note: null };

  const named = lang === '' ? 'The fence names no language, so its text decided.' : `The fence says ${code(lang)}, which names no language, so its text decided.`;
  const prompts = promptLines(rows, firstContentLine);
  if (prompts) {
    return { guess: 'session', from: 'text', reasons: [`${lineList(prompts)} begin with a prompt, and output follows.`, named], ways: ['session', 'written'], note: null };
  }
  if (looksLikePatch(rows)) return { guess: 'patch', from: 'text', reasons: ['It holds diff headers.', named], ways: ['patch', 'written'], note: null };
  const logs = logLines(rows, firstContentLine);
  if (logs) return { guess: 'log', from: 'text', reasons: [`${lineList(logs)} open as a log's lines do.`, named], ways: ['log', 'written'], note: null };
  if (own !== null && readsAsJson(block, bytes)) {
    return { guess: 'data', from: 'text', reasons: ['It reads as JSON.', named], ways: ['data', 'written'], note: null };
  }
  return { guess: 'written', from: 'text', reasons: ['Nothing in it reads as a session, a patch, a log or JSON.', named], ways: ['written'], note: null };
}

const memo = new WeakMap<Document, { readonly bytes: Uint8Array; readonly parts: readonly Part[] }>();

/**
 * Every fenced or indented code block of a Markdown page, in the order written, with how it reads. A code file's
 * pieces are not parts. `bytes` are the bytes `doc` was parsed from.
 */
export function partsOf(doc: Document, bytes: Uint8Array): readonly Part[] {
  const held = memo.get(doc);
  if (held && held.bytes === bytes) return held.parts;
  const blocks = codeBlocks(doc);
  const parts: Part[] = [];
  const seen = new Map<string, number>();
  let line = 1;
  let at = 0;
  const lineOf = (byte: number): number => {
    for (; at < byte && at < bytes.length; at++) if (bytes[at] === 0x0a) line++;
    return line;
  };
  for (const block of blocks) {
    const firstLine = lineOf(block.src.start);
    const contentLine = block.content.start > block.src.start ? lineOf(block.content.start) : firstLine;
    // The closing fence's line: the last byte of the block is its line ending, or the last character of a file with none.
    const lastLine = lineOf(Math.max(block.src.start, block.src.end - 1));
    const lang = (block.lang ?? '').trim().toLowerCase();
    const decided = decide(block, bytes, lang, contentLine);
    const first = lines(block.value).find((l) => l.trim() !== '')?.trim() ?? '';
    const n = seen.get(first) ?? 0;
    seen.set(first, n + 1);
    parts.push({
      start: block.src.start,
      end: block.src.end,
      contentStart: block.content.start,
      contentEnd: block.content.end,
      firstLine,
      lastLine,
      lang,
      ...decided,
      key: `${first}\u0000${n}`,
    });
  }
  memo.set(doc, { bytes, parts });
  return parts;
}

/** What a part is read as: the reader's choice when it is one of its ways, else the guess. */
export const readingOfPart = (part: Part, choice: PartReading | undefined): PartReading =>
  choice !== undefined && part.ways.includes(choice) ? choice : part.guess;

/** Whether the Reading card names a part: a code fence set as written, as its fence says, is just code. */
export const namesPart = (part: Part, reading: PartReading): boolean =>
  reading !== part.guess || part.guess !== 'written' || part.from === 'text' || part.note !== null;
