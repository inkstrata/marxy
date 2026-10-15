// What a reader sees of a `jsonl-transcript` tree (ADR-0061 items 5 and 7, K-12): the sanitised HTML of each row, the
// header line that says what the view left out, and the text each copy verb takes. Pure string building, so the app's
// view and the derived goldens are one render (`packages/core/goldens/<fixture>.derived.html.txt`).
//
// - A turn is a `section` with an outdented speaker label (K-11's `data-marxy-speaker`), then its leaves. The agent's text is
//   Markdown, parsed over its own value into an inner document (`derive/invariants.ts` `innerDocument`) and rendered by the
//   ordinary safe pipeline under the default allow-list, with its file provenance, ids and speaker marks taken out (its
//   offsets index the derived text, never the file, ADR-0061 item 7) and its images shown as their words, never loaded.
//   A prompt is plain text with its line breaks kept; tool input and output are plain, in the code face.
// - Each derived element carries `data-marxy-s` and `data-marxy-e` from its node's `src`, a file offset; the view's root
//   carries `data-marxy-derived`.
// - Every character the invisibles rule flags is drawn as its marker (a bidi control never acts, an ESC is ␛); a U+FFFD
//   the decoding put for bytes that are not UTF-8, and a lone surrogate, are drawn marked, apart from a U+FFFD the file holds.
import type { DerivedText, DerivedThinking, DerivedTool, DerivedTranscript, DerivedTurn, TranscriptPending, TranscriptUnreadable } from '../contracts/derived.ts';
import { DEFAULT_POLICY, type Policy } from '../sanitize/policy.ts';
import { escapeText } from '../sanitize/escape.ts';
import { markInvisibles } from '../render/invisibles.ts';
import { renderDocumentSafeHtml } from '../render/pipeline.ts';
import { innerDocument } from './invariants.ts';

export type TranscriptRow = DerivedTurn | TranscriptUnreadable | TranscriptPending;

/** The speaker's label: the strip's words (*Only you*, *Only assistant*), so the view and its tools name one speaker one way. */
export const SPEAKER_LABEL = { you: 'You', agent: 'Assistant' } as const;
/** The speaker as K-11's `data-marxy-speaker` names it, so a Markdown transcript's label styling is this view's. */
export const SPEAKER_ATTR = { you: 'you', agent: 'assistant' } as const;

/** Lines of output past which a tool's body shows its first and last few, with the count between as text. */
export const OUTPUT_BOUND = { past: 30, head: 10, tail: 10 } as const;
/** Characters of one output line shown before the rest of it is counted instead. */
export const LINE_CHARS = 4000;

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const range = (node: { readonly src: { readonly start: number; readonly end: number } }): string =>
  `data-marxy-s="${node.src.start}" data-marxy-e="${node.src.end}"`;

const isLoneSurrogate = (value: string, i: number): boolean => {
  const c = value.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff) {
    const n = value.charCodeAt(i + 1);
    return !(n >= 0xdc00 && n <= 0xdfff);
  }
  if (c >= 0xdc00 && c <= 0xdfff) {
    const p = value.charCodeAt(i - 1);
    return !(p >= 0xd800 && p <= 0xdbff);
  }
  return false;
};

const hex4 = (c: number): string => c.toString(16).toUpperCase().padStart(4, '0');

/**
 * `value` as HTML: every flagged character as its marker (`render/invisibles.ts`), and each U+FFFD the decoding made
 * (`replaced`, offsets in `value`) and each lone surrogate as a marked replacement character whose title says which.
 * `start` is the value's place in a longer text, for `replaced`.
 */
export function plainTextHtml(value: string, replaced: readonly number[] = [], opts: { readonly inCode?: boolean; readonly start?: number } = {}): string {
  const inCode = opts.inCode ?? false;
  const offset = opts.start ?? 0;
  const made = new Set(replaced);
  const parts: string[] = [];
  let run = 0;
  const flush = (to: number): void => {
    if (to > run) parts.push(markInvisibles(value.slice(run, to), { inCode, sourceStart: 1 }));
  };
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0xfffd && made.has(i + offset)) {
      flush(i);
      parts.push('<span class="marxy-derived-replaced" title="bytes that are not UTF-8 in the file">�</span>');
      run = i + 1;
    } else if (code >= 0xd800 && code <= 0xdfff && isLoneSurrogate(value, i)) {
      flush(i);
      parts.push(`<span class="marxy-derived-replaced" title="a lone surrogate, \\u${hex4(code)}, in the file">�</span>`);
      run = i + 1;
    }
  }
  flush(value.length);
  return parts.join('');
}

/**
 * An inner document's safe HTML with the file's marks taken out: its provenance indexes the derived text, so it is
 * dropped (a click resolves to the enclosing leaf); ids would collide between turns; a heading called *You* is not a
 * speaker here; and an image is shown as its words, never loaded (no request leaves the machine, commitment 2).
 * The allow-list has run, so `="` occurs only inside a tag and these patterns reach no text.
 */
function innerMarkdownHtml(path: string, leaf: DerivedText, policy: Policy): string {
  const html = markInvisiblesInHtml(renderDocumentSafeHtml(innerDocument(path, leaf), policy).html);
  return html
    .replace(/ data-marxy-[se]="[0-9]+"/g, '')
    .replace(/ (?:id|data-marxy-speaker)="[^"]*"/g, '')
    .replace(/<img\b[^>]*>/g, (tag) => {
      const alt = / alt="([^"]*)"/.exec(tag)?.[1] ?? '';
      return `<span class="marxy-derived-image">image${alt === '' ? '' : `: ${alt}`}</span>`;
    });
}

/**
 * The invisibles pass over sanitised HTML: each text run that holds a character outside printable ASCII goes through
 * `markInvisibles` (in code inside `pre`, `code` or `kbd`), so a bidi control or a zero-width character in an agent's
 * Markdown is its marker in this render, as it is in Read's DOM pass. The allow-list's text is escaped with `&amp;`,
 * `&lt;` and `&gt;` only, so those three are read back before the run is marked and escaped again.
 */
export function markInvisiblesInHtml(html: string): string {
  const parts = html.split(/(<[^>]*>)/);
  let code = 0;
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!;
    if (k % 2 === 1) {
      const tag = /^<(\/?)(pre|code|kbd)\b/i.exec(part);
      if (tag) code += tag[1] === '/' ? -1 : part.endsWith('/>') ? 0 : 1;
      continue;
    }
    if (part === '' || /^[\x20-\x7e\t\n\r]*$/.test(part)) continue;
    const text = part.replace(/&(amp|lt|gt);/g, (_m, name: string) => (name === 'amp' ? '&' : name === 'lt' ? '<' : '>'));
    parts[k] = markInvisibles(text, { inCode: code > 0, sourceStart: 1 });
  }
  return parts.join('');
}

export interface RowOptions {
  /** The file's path: inner documents are parsed under `<path>#derived@<start>`. */
  readonly path: string;
  /** The allow-list for an agent's Markdown. The default, whatever the file's trust: a session is never trusted HTML. */
  readonly policy?: Policy;
}

/** A leaf as a block: an agent's Markdown, or plain text whose line breaks are kept. */
export function leafHtml(leaf: DerivedText, opts: RowOptions): string {
  if (leaf.syntax === 'markdown') {
    return `<div class="marxy-derived-markdown" ${range(leaf)}>${innerMarkdownHtml(opts.path, leaf, opts.policy ?? DEFAULT_POLICY)}</div>`;
  }
  return `<p class="marxy-derived-plain" ${range(leaf)}>${plainTextHtml(leaf.value, leaf.replaced)}</p>`;
}

/** The text of a tool's result: its output leaves, in order, joined by a newline. */
export function toolOutput(tool: DerivedTool): string {
  return tool.children.filter((c) => c.role === 'tool-output').map((c) => c.value).join('\n');
}

const lineCountOf = (text: string): number => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

/** The tool's name, or what stands for it: a result whose call is not in the turn. */
export function toolName(tool: DerivedTool): string {
  return tool.children.find((c) => c.role === 'tool-name')?.value ?? 'result';
}

/** The words on a tool's line after its name: the result's length, or why there is none. */
export function toolSize(tool: DerivedTool): string {
  if (!tool.answered) return 'no result';
  const lines = lineCountOf(toolOutput(tool));
  const size = lines === 0 ? 'no output' : plural(lines, 'line');
  return tool.failed ? `failed · ${size}` : size;
}

const firstInput = (tool: DerivedTool): DerivedText | undefined => tool.children.find((c) => c.role === 'tool-input');

/** One line of a tool at rest: its name, the first of its input, and the size of its result. */
export function toolLineHtml(tool: DerivedTool): string {
  const name = tool.orphan ? 'Tool result' : `Tool · ${plainTextHtml(toolName(tool), tool.children[0]?.replaced ?? [])}`;
  const input = firstInput(tool);
  const hint = input ? input.value.split('\n', 1)[0]! : '';
  const short = hint.length > 72 ? `${hint.slice(0, 71)}…` : hint;
  const hintHtml = short === '' ? '' : `<span class="marxy-tool-hint">${plainTextHtml(short, [], { inCode: true })}</span>`;
  return `<span class="marxy-tool-name">${name}</span>${hintHtml}<span class="marxy-tool-size">${toolSize(tool)}</span>`;
}

/** The words on a thinking block's line. */
export function thinkingLine(thinking: DerivedThinking): string {
  const words = thinking.children.reduce((n, leaf) => n + (leaf.value.match(/\S+/g)?.length ?? 0), 0);
  return `Thinking · ${plural(words, 'word')}`;
}

/** Plain text in the code face, bounded: past `OUTPUT_BOUND.past` lines its head and tail with the count between as text. */
export function boundedCodeHtml(value: string, replaced: readonly number[] = []): string {
  const lines = value.split('\n');
  let at = 0;
  const shown: string[] = [];
  const omitted = (n: number, what: string): string => `<span class="marxy-tool-omitted">… ${plural(n, what)} omitted</span>`;
  const lineHtml = (text: string, start: number): string =>
    text.length > LINE_CHARS
      ? `${plainTextHtml(text.slice(0, LINE_CHARS), replaced, { inCode: true, start })}${omitted(text.length - LINE_CHARS, 'character')}`
      : plainTextHtml(text, replaced, { inCode: true, start });
  const bounded = lines.length > OUTPUT_BOUND.past;
  for (let k = 0; k < lines.length; k++) {
    const text = lines[k]!;
    if (bounded && k === OUTPUT_BOUND.head) shown.push(omitted(lines.length - OUTPUT_BOUND.head - OUTPUT_BOUND.tail, 'line'));
    if (!bounded || k < OUTPUT_BOUND.head || k >= lines.length - OUTPUT_BOUND.tail) shown.push(lineHtml(text, at));
    at += text.length + 1;
  }
  return `<pre class="marxy-tool-output"><code>${shown.join('\n')}</code></pre>`;
}

/** A tool's body, made when it is first opened: each string of its input under its key, then its output, bounded. */
export function toolBodyHtml(tool: DerivedTool): string {
  const inputs = tool.children
    .filter((c) => c.role === 'tool-input')
    .map((c) => `<div class="marxy-tool-input" ${range(c)}><span class="marxy-tool-key">${plainTextHtml(c.key ?? '')}</span>${boundedCodeHtml(c.value, c.replaced)}</div>`)
    .join('');
  const outputs = tool.children.filter((c) => c.role === 'tool-output');
  const output = outputs.length === 0 ? '' : `<div ${range({ src: { start: outputs[0]!.src.start, end: outputs[outputs.length - 1]!.src.end } })}>${boundedCodeHtml(toolOutput(tool), outputReplaced(outputs))}</div>`;
  return inputs + output;
}

/** The leaves' `replaced` offsets, moved to their place in `toolOutput`'s joined text. */
function outputReplaced(outputs: readonly DerivedText[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const leaf of outputs) {
    for (const r of leaf.replaced) out.push(at + r);
    at += leaf.value.length + 1;
  }
  return out;
}

/** A thinking block's body: its text, as an agent's Markdown is set. */
export function thinkingBodyHtml(thinking: DerivedThinking, opts: RowOptions): string {
  return thinking.children.map((leaf) => leafHtml(leaf, opts)).join('');
}

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** An unreadable line's body: its own bytes in the code face (U+FFFD for bytes that are not UTF-8, as Source shows them). */
export function unreadableBodyHtml(row: TranscriptUnreadable | TranscriptPending, bytes: Uint8Array): string {
  const text = utf8.decode(bytes.subarray(row.src.start, row.src.end)).replace(/\r?\n$/, '');
  return boundedCodeHtml(text);
}

/** A folded unit: one line that opens its body on a click (`aria-expanded`), the body made when it is first opened. */
const folded = (cls: string, node: { readonly src: { readonly start: number; readonly end: number } }, line: string, open: string | null): string =>
  `<div class="${cls}" ${range(node)}><button type="button" class="marxy-tool-line" aria-expanded="${open === null ? 'false' : 'true'}">${line}</button><div class="marxy-tool-body"${open === null ? ' hidden' : ''}>${open ?? ''}</div></div>`;

/** A root row at rest (`expanded` true: every fold open, as the golden shows it). */
export function rowHtml(row: TranscriptRow, bytes: Uint8Array, opts: RowOptions & { readonly expanded?: boolean }): string {
  const expanded = opts.expanded === true;
  if (row.type === 'unreadable') return folded('marxy-unreadable', row, `Unreadable line ${row.line.toLocaleString('en-US')}`, expanded ? unreadableBodyHtml(row, bytes) : null);
  if (row.type === 'pending') return `<p class="marxy-pending" ${range(row)}>Still being written · line ${row.line.toLocaleString('en-US')}</p>`;
  const parts: string[] = [
    `<section class="marxy-turn" data-marxy-turn="${row.speaker}" ${range(row)} tabindex="-1">`,
    `<h2 data-marxy-speaker="${SPEAKER_ATTR[row.speaker]}">${SPEAKER_LABEL[row.speaker]}</h2>`,
  ];
  for (const child of row.children) {
    if (child.type === 'derivedText') parts.push(leafHtml(child, opts));
    else if (child.type === 'tool') parts.push(folded('marxy-tool', child, toolLineHtml(child), expanded ? toolBodyHtml(child) : null));
    else parts.push(folded('marxy-thinking', child, thinkingLine(child), expanded ? thinkingBodyHtml(child, opts) : null));
  }
  parts.push('</section>');
  return parts.join('');
}

// ---- the header line --------------------------------------------------------------------------------------------------

export interface DroppedGroup {
  readonly record: string;
  readonly known: boolean;
  /** Each line's 1-based number and its range. */
  readonly lines: readonly { readonly line: number; readonly start: number; readonly end: number }[];
}

export interface TranscriptCounts {
  readonly lines: number;
  readonly turns: number;
  /** Lines of a known type left out (bookkeeping, blank lines, messages with no text). */
  readonly notShown: number;
  /** Lines of a type the deriver does not know, left out and counted apart. */
  readonly unknown: number;
  readonly unreadable: number;
  readonly pending: boolean;
  /** The dropped lines by record type, known types first, then in order of first appearance. */
  readonly groups: readonly DroppedGroup[];
}

export function countsOf(tree: DerivedTranscript): TranscriptCounts {
  const groups = new Map<string, { record: string; known: boolean; lines: { line: number; start: number; end: number }[] }>();
  let notShown = 0;
  let unknown = 0;
  for (const d of tree.dropped) {
    if (d.known) notShown++;
    else unknown++;
    const key = `${d.known ? 'k' : 'u'}:${d.record}`;
    let g = groups.get(key);
    if (!g) {
      g = { record: d.record, known: d.known, lines: [] };
      groups.set(key, g);
    }
    g.lines.push({ line: d.line, start: d.src.start, end: d.src.end });
  }
  const ordered = [...groups.values()].sort((a, b) => Number(b.known) - Number(a.known));
  return {
    lines: tree.from.length,
    turns: tree.children.filter((c) => c.type === 'turn').length,
    notShown,
    unknown,
    unreadable: tree.children.filter((c) => c.type === 'unreadable').length,
    pending: tree.children.some((c) => c.type === 'pending'),
    groups: ordered,
  };
}

/** Line numbers a dropped group lists before it says how many more. */
export const GROUP_LINES = 40;

/**
 * The view's opening line, in the dek's style (ADR-0061 item 7): what it was derived from and what it left out, each count
 * a button that unfolds its lines by record type, each line a Jump to source. `done` false: the file is still being read.
 */
export function headHtml(counts: TranscriptCounts, opts: { readonly done?: boolean; readonly sourceKey?: string } = {}): string {
  const bits: string[] = [`Derived from ${plural(counts.lines, 'line')} of JSONL${opts.done === false ? ' so far' : ''}`];
  if (counts.notShown > 0) bits.push(`<button type="button" class="marxy-transcript-count" data-marxy-dropped="known" aria-expanded="false">${counts.notShown.toLocaleString('en-US')} not shown</button>`);
  if (counts.unknown > 0) bits.push(`<button type="button" class="marxy-transcript-count" data-marxy-dropped="unknown" aria-expanded="false">${counts.unknown.toLocaleString('en-US')} of unknown type</button>`);
  if (counts.unreadable > 0) bits.push(plural(counts.unreadable, 'unreadable line'));
  bits.push(`Source ${escapeText(opts.sourceKey ?? '⌘E')}`);
  const list = (known: boolean): string => {
    const items = counts.groups
      .filter((g) => g.known === known)
      .map((g) => {
        const shown = g.lines.slice(0, GROUP_LINES).map((l) => `<button type="button" class="marxy-transcript-jump" data-marxy-s="${l.start}" data-marxy-e="${l.end}">${l.line.toLocaleString('en-US')}</button>`);
        const more = g.lines.length > GROUP_LINES ? ` <span>and ${(g.lines.length - GROUP_LINES).toLocaleString('en-US')} more</span>` : '';
        return `<li><span class="marxy-transcript-record">${plainTextHtml(g.record.length > 60 ? `${g.record.slice(0, 59)}…` : g.record)}</span> · ${plural(g.lines.length, 'line')}: ${shown.join(' ')}${more}</li>`;
      });
    return items.length === 0 ? '' : `<ul class="marxy-transcript-dropped" data-marxy-dropped="${known ? 'known' : 'unknown'}" hidden>${items.join('')}</ul>`;
  };
  return `<p class="marxy-transcript-head">${bits.join(' · ')}</p>${list(true)}${list(false)}`;
}

/** The whole view as HTML, every fold open: what the derived golden holds. */
export function renderTranscriptHtml(tree: DerivedTranscript, bytes: Uint8Array, opts: RowOptions): string {
  const rows = tree.children.map((row) => rowHtml(row, bytes, { ...opts, expanded: true }));
  return `<div data-marxy-derived="jsonl-transcript">${headHtml(countsOf(tree))}\n${rows.join('\n')}\n</div>`;
}

// ---- what the copy verbs take ---------------------------------------------------------------------------------------------

/** The text of one child of a turn as shown: a leaf's value; a folded unit its line, and its text too when it is open. */
function childText(child: DerivedTurn['children'][number], isOpen: (node: DerivedTool | DerivedThinking) => boolean): string {
  if (child.type === 'derivedText') return child.value;
  if (child.type === 'tool') {
    const line = `${child.orphan ? 'Tool result' : `Tool · ${toolName(child)}`} · ${toolSize(child)}`;
    if (!isOpen(child)) return line;
    const inputs = child.children.filter((c) => c.role === 'tool-input').map((c) => `${c.key ?? ''}: ${c.value}`);
    return [line, ...inputs, toolOutput(child)].filter((s) => s !== '').join('\n');
  }
  const line = thinkingLine(child);
  return isOpen(child) ? [line, ...child.children.map((c) => c.value)].join('\n') : line;
}

/** `copy-turn`: a turn's text as shown, without its label (ADR-0061 item 5). */
export function turnText(turn: DerivedTurn, isOpen: (node: DerivedTool | DerivedThinking) => boolean = () => false): string {
  return turn.children.map((c) => childText(c, isOpen)).join('\n\n');
}

/** `copy-user-prompts`: every prompt of yours, in order, a blank line between. */
export function userPrompts(tree: DerivedTranscript): string {
  return tree.children
    .filter((c): c is DerivedTurn => c.type === 'turn' && c.speaker === 'you')
    .map((t) => t.children.filter((c): c is DerivedText => c.type === 'derivedText').map((c) => c.value).join('\n\n'))
    .join('\n\n');
}

/** *Source lines (JSONL)*: the exact bytes of every whole line `node` came from, in order. */
export function sourceLinesOf(tree: DerivedTranscript, bytes: Uint8Array, node: { readonly from: readonly { readonly start: number; readonly end: number }[] }): Uint8Array {
  const lines = tree.from;
  const picked = new Set<number>();
  const lineAt = (at: number): number => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid]!.start <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const r of node.from) for (let k = lineAt(r.start); k <= lineAt(Math.max(r.start, r.end - 1)); k++) picked.add(k);
  const order = [...picked].sort((a, b) => a - b);
  const total = order.reduce((n, k) => n + lines[k]!.end - lines[k]!.start, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const k of order) {
    out.set(bytes.subarray(lines[k]!.start, lines[k]!.end), at);
    at += lines[k]!.end - lines[k]!.start;
  }
  return out;
}

