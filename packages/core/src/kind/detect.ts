// Kind detection (ADR-0060 items 3 to 6, K-03): what a file is read as, from its path, a bounded prefix of
// its bytes, its front matter and the reader's rules. A pure function: no DOM, no Node built-ins, no I/O.
// Nothing in the app calls it yet (K-05 does); no file's opening mode changes.
//
// Seven tiers, highest first: reader, name, format, shape, byline, weak shape, default. The first tier with an
// applicable signal decides; inside a tier the strongest signal wins (its strength is stated beside each signal),
// and a tie goes to the kind earlier in KINDS. Every signal that fired is kept as a reason.
//
// Never a signal (item 5): of the front matter only the presence of `author`, `published` and `source` is read,
// never a value; no path that names a tool or vendor is matched; a speaker heading naming a product is no speaker.

import { DEFAULT_KIND, KINDS } from '../contracts/kinds.ts';
import type { Kind } from '../contracts/kinds.ts';
import { basename, dirname, normalizePath } from '../index-model/paths.ts';

/** Bytes of body read after the front matter ends (ADR-0060 item 6). Shape signals live inside it, never beyond. */
export const KIND_PREFIX_BYTES = 16 * 1024;
/** How far into a file the end of its front matter is looked for. A longer block is treated as no front matter. */
export const KIND_FRONT_MATTER_SCAN_BYTES = 64 * 1024;
/** What a caller should pass as `head`: the front matter scan plus the body prefix. */
export const KIND_HEAD_BYTES = KIND_FRONT_MATTER_SCAN_BYTES + KIND_PREFIX_BYTES;

/**
 * Thresholds ADR-0060 leaves to K-03 (recorded with `kinds.json`):
 *  - "several" is more than one: two distinct working headings make `report`; two admonitions or docs sections
 *    (Parameters, Returns, Errors, Example) make `docs`.
 *  - speaker headings: two, naming at least two distinct roles.
 *  - JSONL role objects: at least 80% of the lines that are not a cut-off last line parse as objects, and at
 *    least one carries a `role` (or a `message.role`) in ROLES, or a `type` in MESSAGE_TYPES.
 *  - log: at least three lines open with a timestamp then a level word, and they are 60% of the non-blank lines
 *    outside code fences.
 *  - terminal: at least two prompt lines each followed directly by an output line.
 *  - book: a "Chapter" heading and three paragraphs of 600 characters or more, or a chapter-numbered file name.
 */
export const THRESHOLDS = {
  workingHeadings: 2,
  docsSignals: 2,
  speakerHeadings: 2,
  speakerRoles: 2,
  jsonlObjectShare: 0.8,
  logLines: 3,
  logShare: 0.6,
  terminalPrompts: 2,
  bookLongParagraphs: 3,
  bookParagraphChars: 600,
} as const;

/** A reader's `[[kind]]` rule (K-04 parses it). The glob arrives already expanded (`~`) and is matched against the whole path. */
export interface KindRule {
  readonly glob: string;
  readonly is: string;
  readonly read?: boolean;
}

export interface DetectInput {
  readonly path: string;
  /** The first bytes of the file; at most `KIND_HEAD_BYTES` are read. */
  readonly head: Uint8Array;
  /** The parsed front matter. When absent, the key names are read from `head`. Only three keys are ever looked at. */
  readonly frontMatter?: Record<string, unknown>;
  readonly rules?: readonly KindRule[];
  /** *Show as* chosen for this file (ADR-0060 item 9): tier 1, above any rule. */
  readonly showAs?: string;
}

export interface Reason {
  /** 1 reader, 2 name, 3 format, 4 shape, 5 byline, 6 weak shape, 7 default. */
  readonly tier: number;
  readonly signal: string;
  readonly kind: Kind;
  /** Where it was seen: the rule's glob, the file name, or a line. */
  readonly at: string;
  /** True for the signal that decided the kind. */
  readonly decisive: boolean;
}

export interface DetectResult {
  readonly kind: Kind;
  readonly reasons: readonly Reason[];
}

interface Signal {
  tier: number;
  signal: string;
  kind: Kind;
  at: string;
  strength: number;
  applies: boolean;
}

const TEXT_EXT = new Set(['.md', '.markdown', '.mdx', '.txt']);
const TEXT_NAMES = ['readme', 'contributing', 'changelog', 'changes', 'history'];
const FORMAT_KIND: Record<string, Kind> = {
  '.diff': 'diff', '.patch': 'diff',
  '.html': 'html', '.htm': 'html',
  '.log': 'log', '.out': 'log',
  '.term': 'terminal', '.session': 'terminal',
  '.json': 'data', '.jsonl': 'data', '.yaml': 'data', '.yml': 'data', '.toml': 'data', '.csv': 'data', '.tsv': 'data',
};
const BUILD_FILES = new Set(['makefile', 'dockerfile', 'gnumakefile', 'justfile', 'rakefile', 'gemfile', 'procfile']);
const ROLES = new Set(['user', 'assistant', 'system', 'tool', 'human', 'ai', 'agent', 'developer', 'function']);
const MESSAGE_TYPES = new Set(['user', 'assistant', 'system', 'tool', 'tool_use', 'tool_result', 'message']);
const SPEAKERS = new Set(['you', 'user', 'human', 'assistant', 'agent', 'tool', 'system']);
const WORKING = new Set(['summary', 'context', 'risk', 'next step', 'open question', 'verified', 'recommendation']);
const DOCS_SECTIONS = new Set(['parameter', 'return', 'error', 'example']);

const kindIndex = (kind: Kind): number => KINDS.indexOf(kind);
const isKind = (value: unknown): value is Kind => typeof value === 'string' && (KINDS as readonly string[]).includes(value);

/** Lowercase extension with its dot, or '' (a leading dot is a dotfile, not an extension). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function isTextFamily(name: string, ext: string): boolean {
  if (TEXT_EXT.has(ext)) return true;
  return ext === '' && TEXT_NAMES.includes(name.toLowerCase());
}

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Front matter at the top of the file: the byte offset where it ends and the text between the fences, or null. */
function frontMatterOf(head: Uint8Array): { end: number; text: string } | null {
  const bom = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  const text = new TextDecoder().decode(head.subarray(bom, KIND_FRONT_MATTER_SCAN_BYTES));
  const open = /^(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!open) return null;
  const closer = open[1] === '---' ? /^(?:---|\.\.\.)[ \t]*$/ : /^\+\+\+[ \t]*$/;
  let at = open[0].length;
  while (at < text.length) {
    const eol = text.indexOf('\n', at);
    const next = eol < 0 ? text.length : eol + 1;
    if (closer.test(text.slice(at, eol < 0 ? text.length : eol).replace(/\r$/, ''))) {
      return { end: bom + new TextEncoder().encode(text.slice(0, next)).length, text: text.slice(open[0].length, at) };
    }
    at = next;
  }
  return null;
}

/** Top-level key names of a front matter block and whether each has a value: a light scan, not a parser. */
function scanKeys(block: string): Record<string, unknown> {
  const keys: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_.-]+)[ \t]*[:=][ \t]*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    let value = m[2]!.trim();
    if (value === '' && /^(?:[ \t]+\S|-[ \t])/.test(lines[i + 1] ?? '')) value = 'nested';
    keys[m[1]!] = value === '~' || /^null$/i.test(value) || value === '""' || value === "''" ? null : value;
  }
  return keys;
}

const present = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

interface Line { n: number; text: string }

/** Non-blank lines outside code fences, with their 1-based line numbers. */
function proseLines(body: string): Line[] {
  const out: Line[] = [];
  let fence: { ch: string; len: number } | null = null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence) {
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len) fence = null;
      continue;
    }
    if (m) { fence = { ch: m[1]![0]!, len: m[1]!.length }; continue; }
    out.push({ n: i + 1, text });
  }
  return out;
}

const headingText = (line: string): string | null => {
  const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
  return m ? m[1]!.replace(/[*_`]/g, '').replace(/:$/, '').trim() : null;
};

const singular = (word: string): string => word.toLowerCase().replace(/s$/, '');

const TIMESTAMP = /^\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?[\s|\-[]*(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|CRIT)\b/i;
const PROMPT = /^(?:\$ \S.*|[\w.-]+@[\w.-]+[ :].*?[ ][%$#](?: .*)?)$/;

interface Shape { kind: Kind; signal: string; at: string; strength: number }

/** The shape signals of ADR-0060 tier 4 that fired in `body`; markup-based ones only when `markup` is true. */
function shapes(body: string, markup: boolean, path: string): Shape[] {
  const out: Shape[] = [];
  const lines = proseLines(body);

  const nonBlank = lines.filter((l) => l.text.trim() !== '');
  const logLines = nonBlank.filter((l) => TIMESTAMP.test(l.text));
  if (logLines.length >= THRESHOLDS.logLines && logLines.length >= THRESHOLDS.logShare * nonBlank.length) {
    out.push({ kind: 'log', signal: 'timestamp and level word open most lines', at: `line ${logLines[0]!.n}`, strength: logLines.length });
  }
  let prompts = 0;
  let firstPrompt = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!PROMPT.test(lines[i]!.text)) continue;
    const next = lines[i + 1]!;
    if (next.n === lines[i]!.n + 1 && next.text.trim() !== '' && !PROMPT.test(next.text)) {
      if (prompts++ === 0) firstPrompt = lines[i]!.n;
    }
  }
  if (prompts >= THRESHOLDS.terminalPrompts) {
    out.push({ kind: 'terminal', signal: 'prompt lines each followed by output', at: `line ${firstPrompt}`, strength: prompts });
  }
  if (!markup) return out;

  const speakers = nonBlank.filter((l) => {
    const h = headingText(l.text);
    return h !== null && SPEAKERS.has(h.toLowerCase());
  });
  const roles = new Set(speakers.map((l) => headingText(l.text)!.toLowerCase()));
  if (speakers.length >= THRESHOLDS.speakerHeadings && roles.size >= THRESHOLDS.speakerRoles) {
    out.push({ kind: 'transcript', signal: 'speaker headings', at: `line ${speakers[0]!.n}`, strength: speakers.length });
  }

  const headings = nonBlank.flatMap((l) => { const h = headingText(l.text); return h === null ? [] : [{ n: l.n, h }]; });
  const chapters = headings.filter(({ h }) => /^chapter\b/i.test(h));
  const long = body.split(/\r?\n[ \t]*\r?\n/).filter((p) => p.replace(/\s+/g, ' ').trim().length >= THRESHOLDS.bookParagraphChars && !/^\s*(?:#|[-*+>|]|\d+[.)]\s)/.test(p)).length;
  if (chapters.length > 0 && long >= THRESHOLDS.bookLongParagraphs) {
    out.push({ kind: 'book', signal: '"Chapter" heading with long paragraphs', at: `line ${chapters[0]!.n}`, strength: chapters.length });
  }
  if (/^(?:chapter|ch)[-_. ]?\d+/i.test(basename(path))) {
    out.push({ kind: 'book', signal: 'chapter-numbered file name', at: basename(path), strength: 1 });
  }

  const admonitions = nonBlank.filter((l) => /^\s{0,3}>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|^:::\s*\w|^!!!\s+\w/i.test(l.text));
  const sections = headings.filter(({ h }) => DOCS_SECTIONS.has(singular(h)));
  const docsAt = [...admonitions.map((l) => l.n), ...sections.map((s) => s.n)].sort((a, b) => a - b);
  if (docsAt.length >= THRESHOLDS.docsSignals) {
    out.push({ kind: 'docs', signal: 'admonitions or Parameters, Returns, Errors, Example sections', at: `line ${docsAt[0]}`, strength: docsAt.length });
  }

  const working = headings.filter(({ h }) => WORKING.has(singular(h)));
  const distinct = new Set(working.map(({ h }) => singular(h)));
  if (distinct.size >= THRESHOLDS.workingHeadings) {
    out.push({ kind: 'report', signal: 'working headings', at: `line ${working[0]!.n}`, strength: distinct.size });
  }
  return out;
}

/** JSONL whose lines are objects with a role or a message type (tier 4, first row). */
function jsonlShape(text: string): Shape | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length > 1 && !text.endsWith('\n')) lines.pop(); // the prefix may cut the last line
  if (lines.length === 0) return null;
  let objects = 0;
  let roled = 0;
  let firstRoled = 0;
  lines.forEach((line, i) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    objects++;
    const o = value as Record<string, unknown>;
    const msg = o.message !== null && typeof o.message === 'object' ? (o.message as Record<string, unknown>) : undefined;
    const role = typeof o.role === 'string' ? o.role : typeof msg?.role === 'string' ? msg.role : undefined;
    const type = typeof o.type === 'string' ? o.type : undefined;
    if ((role !== undefined && ROLES.has(role.toLowerCase())) || (type !== undefined && MESSAGE_TYPES.has(type.toLowerCase()))) {
      if (roled++ === 0) firstRoled = i + 1;
    }
  });
  if (roled === 0 || objects < THRESHOLDS.jsonlObjectShare * lines.length) return null;
  return { kind: 'transcript', signal: 'JSONL lines are objects with a role or message type', at: `line ${firstRoled}`, strength: roled };
}

export function detectKind(input: DetectInput): DetectResult {
  const path = normalizePath(input.path);
  const name = basename(path);
  const ext = extensionOf(name);
  const family = isTextFamily(name, ext);
  const head = input.head.subarray(0, KIND_HEAD_BYTES);
  const fm = frontMatterOf(head);
  const bodyBytes = head.subarray(fm?.end ?? (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0));
  const prefix = bodyBytes.subarray(0, KIND_PREFIX_BYTES);
  const body = new TextDecoder().decode(prefix);
  const binary = prefix.includes(0);
  const signals: Signal[] = [];
  const add = (tier: number, signal: string, kind: Kind, at: string, strength: number, applies = true): void => {
    signals.push({ tier, signal, kind, at, strength, applies });
  };

  // Tier 1: the reader.
  if (isKind(input.showAs)) add(1, 'show as', input.showAs, path, 2);
  for (const rule of input.rules ?? []) {
    if (!isKind(rule.is)) continue; // an unknown kind is K-04's notice; here it is ignored
    if (globToRegExp(rule.glob).test(path)) { add(1, 'reader rule', rule.is, rule.glob, 1); break; } // first match wins
  }

  // Tier 2: the name, inside the text family.
  if (family) {
    const lower = name.toLowerCase();
    if (/^(?:readme|contributing)/.test(lower)) add(2, 'file name', 'readme', name, 1);
    else if (/^(?:changelog|changes|history)/.test(lower)) add(2, 'file name', 'changelog', name, 1);
  }

  // Tier 3: the format, outside the text family.
  let format: Signal | undefined;
  if (!family) {
    const mapped = FORMAT_KIND[ext];
    if (mapped) add(3, `extension ${ext}`, mapped, name, 1);
    else if (ext === '' && !name.startsWith('.') && !BUILD_FILES.has(name.toLowerCase()) && !(body.startsWith('#!'))) {
      add(3, 'no extension', 'code', name, 1);
    } else if (ext === '') {
      add(3, body.startsWith('#!') ? 'shebang' : name.startsWith('.') ? 'dotfile' : 'build file', 'code', name, 1);
    } else add(3, `extension ${ext}`, 'code', name, 1);
    format = signals[signals.length - 1];
  }

  // Tier 4: the shape of the prefix. Outside the text family only the JSONL row, and log or terminal for an
  // extension-less file, may decide; the rest are reasons.
  if (!binary) {
    const refinable = !family && (ext === '.jsonl' || (ext === '' && format?.signal === 'no extension'));
    if (!family && ext === '.jsonl') {
      const jsonl = jsonlShape(body);
      if (jsonl) {
        add(4, jsonl.signal, jsonl.kind, jsonl.at, jsonl.strength);
        if (format) format.applies = false;
      }
    }
    for (const s of shapes(body, family, path)) {
      const decides = family || (refinable && ext === '' && (s.kind === 'log' || s.kind === 'terminal'));
      add(4, s.signal, s.kind, s.at, s.strength, decides);
      if (decides && !family && format) format.applies = false;
    }
  }

  if (family) {
    // Tier 5: the byline. Presence of keys only, never a value.
    const front = input.frontMatter ?? (fm ? scanKeys(fm.text) : {});
    if (present(front.author) && (present(front.published) || present(front.source))) {
      add(5, 'byline: author with published or source', 'article', 'front matter', 1);
    }
    // Tier 6: weak shape.
    const lines = binary ? [] : proseLines(body);
    const tasks = lines.filter((l) => /^\s*[-*+][ \t]+\[[ xX]\][ \t]/.test(l.text));
    const working = lines.filter((l) => { const h = headingText(l.text); return h !== null && WORKING.has(singular(h)); });
    if (tasks.length > 0 && working.length === 0) add(6, 'task list without working headings', 'report', `line ${tasks[0]!.n}`, 1);
    if (/\d{4}-\d{2}-\d{2}/.test(name)) add(6, 'dated file name', 'notes', name, 1);
    const folder = dirname(path).split('/').find((part) => /^(?:notes|journal)$/i.test(part));
    if (folder !== undefined) add(6, 'folder name', 'notes', folder, 1);
    // Tier 7: the default.
    add(7, 'nothing else fired', DEFAULT_KIND, name, 0);
  }

  // The first tier with an applicable signal decides; inside it the strongest, ties to the earlier kind.
  const live = signals.filter((s) => s.applies);
  let winner = live[0]!;
  for (const s of live) {
    if (s.tier < winner.tier || (s.tier === winner.tier && (s.strength > winner.strength || (s.strength === winner.strength && kindIndex(s.kind) < kindIndex(winner.kind))))) winner = s;
  }
  const reasons = signals
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.tier - b.s.tier || a.i - b.i)
    .map(({ s }): Reason => ({ tier: s.tier, signal: s.signal, kind: s.kind, at: s.at, decisive: s === winner }));
  return { kind: winner.kind, reasons };
}
