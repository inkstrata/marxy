// Re-indent YAML (E-10): the leading whitespace of each line of a `yaml` fence becomes two spaces per level.
// Pure string to string. Nothing but leading whitespace changes (no parse-and-print: comments, anchors, quotes and
// scalars are never touched). It declines whenever re-indenting could change what the YAML means, and it checks
// its own result: the structure of the output, recomputed, must equal the structure of the input.
import type { CodeBlock } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { lineStartAt } from '../sourcemap/index.ts';
import { textIndex } from './text-helpers.ts';

interface Line {
  /** Offset of the line's first character in the body, and the length of its leading whitespace. */
  readonly start: number;
  readonly indent: number;
  readonly rest: string;
  readonly blank: boolean;
}

interface Shape {
  /** One entry per non-blank line: the depth of each anchor column the line opens or uses, and the text after the indent. */
  readonly depths: readonly (readonly number[])[];
  readonly rest: readonly string[];
}

type Analysis = { readonly ok: true; readonly lines: Line[]; readonly depth: Map<number, number>; readonly shape: Shape } | { readonly ok: false; readonly why: string };

const EOL = /\r\n|\n|\r/g;

function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  const push = (end: number): void => {
    const raw = body.slice(pos, end);
    const indent = /^[ \t]*/.exec(raw)![0].length;
    lines.push({ start: pos, indent, rest: raw.slice(indent), blank: indent === raw.length });
  };
  for (const m of body.matchAll(EOL)) {
    push(m.index!);
    pos = m.index! + m[0].length;
  }
  if (pos < body.length) push(body.length);
  return lines;
}

/** Can a node (a quote, a flow collection) begin right after `before`? */
function startsNode(before: string): boolean {
  const t = before.trimEnd();
  return t === '' || /[:\-?,[{]$/.test(t) || /(^|\s)[&!][^\s]*$/.test(t);
}

/** Scan one line: whether a quote or a flow collection is still open at its end, and the text without a trailing comment. */
function scanLine(line: string, state: { quote: string; flow: number }): void {
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (state.quote === '"') {
      if (c === '\\') i++;
      else if (c === '"') state.quote = '';
    } else if (state.quote === "'") {
      if (c === "'") {
        if (line[i + 1] === "'") i++;
        else state.quote = '';
      }
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
      return;
    } else if ((c === '"' || c === "'") && startsNode(line.slice(0, i))) {
      state.quote = c;
    } else if ((c === '[' || c === '{') && startsNode(line.slice(0, i))) {
      state.flow++;
    } else if ((c === ']' || c === '}') && state.flow > 0) {
      state.flow--;
    }
  }
}

const BLOCK_SCALAR = /(^|\s)[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*(?:#.*)?$/;

/** The anchor columns of a line: its indent, then the column after each `- ` that opens a sequence entry. Null: not representable. */
function anchors(indent: number, rest: string): number[] | null {
  const cols = [indent];
  let col = indent;
  let text = rest;
  for (;;) {
    const m = /^-( *)/.exec(text);
    if (!m || (text.length > 1 && text[1] !== ' ')) break;
    const after = text.slice(1 + m[1]!.length);
    if (after === '' || after.startsWith('#')) break;
    if (m[1]!.length !== 1) return null;
    col += 2;
    text = after;
    cols.push(col);
  }
  return cols;
}

/** The index of the last level whose column is at or left of `col` (0 when none is). */
function lastAtOrLeft(levels: readonly number[], col: number): number {
  let at = 0;
  levels.forEach((level, i) => {
    if (level <= col) at = i;
  });
  return at;
}

function analyse(body: string): Analysis {
  const lines = splitLines(body);
  const state = { quote: '', flow: 0 };
  const open = (): string => (state.quote ? 'a quoted scalar continues across lines' : 'a flow collection continues across lines');
  let stack: number[] = [];
  const depth = new Map<number, number>();
  const anchorDepths = new Map<number, readonly number[]>();
  let sawContent = false;
  let sawStart = false;
  const pending: Line[] = [];
  // A comment line sits on a level of the stack as it was above the next content line if its column matches one;
  // otherwise it goes with that next line (or, at the end of the block, on the nearest level at or left of it).
  const resolveComments = (before: readonly number[], next: number | null): void => {
    for (const c of pending) {
      const exact = before.indexOf(c.indent);
      const d = exact >= 0 ? exact : (next ?? lastAtOrLeft(before, c.indent));
      depth.set(c.start, d);
      anchorDepths.set(c.start, [d]);
    }
    pending.length = 0;
  };
  for (const line of lines) {
    if (line.blank) continue;
    if (/\t/.test(body.slice(line.start, line.start + line.indent))) return { ok: false, why: 'a tab in the indentation' };
    if (state.quote !== '' || state.flow > 0) return { ok: false, why: open() };
    const text = line.rest;
    if (text.startsWith('#')) {
      pending.push(line);
      continue;
    }
    if (line.indent === 0 && /^(---|\.\.\.)(\s|$)/.test(text)) {
      if (text.startsWith('...') || sawContent || sawStart) return { ok: false, why: 'more than one YAML document' };
      if (BLOCK_SCALAR.test(text.slice(3))) return { ok: false, why: 'a block scalar (| or >)' };
      sawStart = true;
      resolveComments(stack, 0);
      stack = [];
      depth.set(line.start, 0);
      anchorDepths.set(line.start, [0]);
      scanLine(text.slice(3), state);
      continue;
    }
    if (/^\?(\s|$)/.test(text) || /^:(\s|$)/.test(text)) return { ok: false, why: 'an explicit key (? or :)' };
    if (BLOCK_SCALAR.test(text)) return { ok: false, why: 'a block scalar (| or >)' };
    const cols = anchors(line.indent, text);
    if (!cols) return { ok: false, why: 'more than one space after a dash' };
    const before = stack;
    stack = [...stack];
    // Pop to the line's own column; a dedent to a column no open level has is not YAML this can re-indent.
    let popped = false;
    while (stack.length > 0 && stack[stack.length - 1]! > cols[0]!) {
      stack.pop();
      popped = true;
    }
    if (stack[stack.length - 1] !== cols[0]) {
      if (popped) return { ok: false, why: 'indentation that matches no enclosing level' };
      stack.push(cols[0]!);
    }
    const first = stack.length - 1;
    const ds = [first];
    for (let k = 1; k < cols.length; k++) {
      stack.push(cols[k]!);
      ds.push(stack.length - 1);
    }
    resolveComments(before, first);
    depth.set(line.start, first);
    anchorDepths.set(line.start, ds);
    scanLine(text, state);
    sawContent = true;
  }
  if (state.quote !== '' || state.flow > 0) return { ok: false, why: open() };
  resolveComments(stack, null);
  const used = lines.filter((l) => !l.blank);
  return { ok: true, lines, depth, shape: { depths: used.map((l) => anchorDepths.get(l.start)!), rest: used.map((l) => l.rest) } };
}

/** The re-indented body, or the reason it was declined. A body that is already normalised comes back equal. */
export function reindentYamlText(body: string): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string } {
  const before = analyse(body);
  if (!before.ok) return before;
  const edits = reindentEdits(before);
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += body.slice(at, e.start) + e.text;
    at = e.end;
  }
  out += body.slice(at);
  const after = analyse(out);
  if (!after.ok || JSON.stringify(after.shape) !== JSON.stringify(before.shape)) {
    return { ok: false, why: 'the indentation could not be changed without changing the structure' };
  }
  return { ok: true, text: out };
}

function reindentEdits(a: Extract<Analysis, { ok: true }>): { start: number; end: number; text: string }[] {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const line of a.lines) {
    if (line.blank) continue;
    edits.push({ start: line.start, end: line.start + line.indent, text: ' '.repeat(2 * a.depth.get(line.start)!) });
  }
  return edits;
}

/** The leading-whitespace spans (UTF-16 offsets in `body`) of every non-blank line: what a re-indent may touch. */
export function yamlIndentSpans(body: string): { start: number; end: number }[] {
  return splitLines(body).filter((l) => !l.blank).map((l) => ({ start: l.start, end: l.start + l.indent }));
}

const LANGS = new Set(['yaml', 'yml']);

function eligible(input: Pick<OperationInput, 'document' | 'node' | 'range'>): boolean {
  const node = input.node;
  if (!node || node.type !== 'codeBlock') return false;
  const lang = (node as CodeBlock).lang?.toLowerCase();
  if (!lang || !LANGS.has(lang)) return false;
  if (!input.document.children.includes(node)) return false;
  if (input.range.start !== node.src.start || input.range.end !== node.src.end) return false;
  return lineStartAt(input.document, node.src.start) === node.src.start;
}

/** Re-indent YAML. Pure. Leading whitespace of content lines only; declines (no change, with the reason) when unsure. */
export const formatYaml: Operation = {
  id: 'format-yaml',
  title: 'Re-indent YAML',
  appliesTo: ['block'],
  canApply: eligible,
  run(input: OperationInput): OperationResult {
    const node = input.node as CodeBlock | undefined;
    if (!node || node.type !== 'codeBlock') return { replacement: input.text };
    const index = textIndex(input.text);
    let start: number;
    let end: number;
    try {
      start = index.toIndex(node.content.start - input.range.start);
      end = index.toIndex(node.content.end - input.range.start);
    } catch {
      return { replacement: input.text };
    }
    const result = reindentYamlText(input.text.slice(start, end));
    if (!result.ok) return { replacement: input.text, summary: `Not re-indented: ${result.why}` };
    const replacement = input.text.slice(0, start) + result.text + input.text.slice(end);
    return replacement === input.text ? { replacement, summary: 'Already indented by two spaces' } : { replacement, summary: 'Re-indented YAML' };
  },
};
