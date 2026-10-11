// Pretty-print JSON (E-10): re-indent the content of a `json` fence two spaces per level, token by token.
// Pure string to string. No parse-and-print: strings and numbers are copied byte for byte, so nothing is rounded,
// re-escaped or reordered; only the whitespace between tokens is rewritten. A trailing comma (which LLM answers
// leave in) is kept as the token it is. Anything that is not JSON apart from that returns null.
import type { CodeBlock } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { lineStartAt } from '../sourcemap/index.ts';
import { eolOf, replaceSpans, textIndex } from './text-helpers.ts';

/** The end (exclusive) of the JSON string starting at `from`, or -1. A manual scan: a regular expression recurses on a long string. */
function stringEnd(text: string, from: number): number {
  for (let i = from + 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22) return i + 1;
    if (c < 0x20) return -1;
    if (c === 0x5c) {
      const e = text[++i];
      if (e === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) return -1;
        i += 4;
      } else if (e === undefined || !'"\\/bfnrt'.includes(e)) return -1;
    }
  }
  return -1;
}
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const LITERAL = /true|false|null/y;

type State = 'open' | 'key' | 'colon' | 'value' | 'item' | 'comma';
interface Frame {
  readonly obj: boolean;
  state: State;
}

export type JsonFormat = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly line: number };

/** The formatter with its failure position: `line` is the 1-based line of the first token that is not JSON. */
export function formatJsonDetailed(text: string, eol: string): JsonFormat {
  const stack: Frame[] = [];
  let out = '';
  let top: 'value' | 'done' = 'value';
  let i = 0;
  const fail = (at: number): JsonFormat => {
    const before = text.slice(0, at);
    return { ok: false, line: (before.match(/\r\n|\n|\r/g)?.length ?? 0) + 1 };
  };
  const nl = (depth: number): string => eol + '  '.repeat(depth);
  let sawToken = false;
  for (;;) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
    if (i >= text.length) break;
    sawToken = true;
    const at = i;
    const c = text[i]!;
    const frame = stack[stack.length - 1];
    // What the grammar expects here: a value, a key, a colon, a comma, or a close.
    const wantsValue = frame ? frame.state === 'value' || frame.state === 'item' || (frame.state === 'open' && !frame.obj) : top === 'value';
    const wantsKey = !!frame && frame.obj && (frame.state === 'open' || frame.state === 'key');
    if (c === '{' || c === '[') {
      if (!wantsValue) return fail(at);
      if (frame) out += frame.state === 'value' ? ' ' : nl(stack.length);
      out += c;
      if (frame) frame.state = 'comma';
      else top = 'done';
      stack.push({ obj: c === '{', state: 'open' });
      i++;
    } else if (c === '}' || c === ']') {
      if (!frame || frame.obj !== (c === '}')) return fail(at);
      if (frame.state !== 'open' && frame.state !== 'comma' && frame.state !== 'key' && frame.state !== 'item') return fail(at);
      out += frame.state === 'open' ? c : nl(stack.length - 1) + c;
      stack.pop();
      i++;
    } else if (c === ',') {
      if (!frame || frame.state !== 'comma') return fail(at);
      out += ',';
      frame.state = frame.obj ? 'key' : 'item';
      i++;
    } else if (c === ':') {
      if (!frame || !frame.obj || frame.state !== 'colon') return fail(at);
      out += ':';
      frame.state = 'value';
      i++;
    } else if (c === '"' && wantsKey) {
      const e = stringEnd(text, i);
      if (e < 0) return fail(at);
      out += nl(stack.length) + text.slice(i, e);
      frame!.state = 'colon';
      i = e;
    } else if (wantsValue) {
      let token: string;
      if (c === '"') {
        const e = stringEnd(text, i);
        if (e < 0) return fail(at);
        token = text.slice(i, e);
      } else {
        const re = c === '-' || (c >= '0' && c <= '9') ? NUMBER : LITERAL;
        re.lastIndex = i;
        const m = re.exec(text);
        if (!m) return fail(at);
        token = m[0];
      }
      if (frame) {
        out += frame.state === 'value' ? ' ' : nl(stack.length);
        frame.state = 'comma';
      } else top = 'done';
      out += token;
      i += token.length;
    } else return fail(at);
  }
  if (!sawToken || stack.length > 0 || top !== 'done') return fail(text.length);
  return { ok: true, text: out };
}

/**
 * `text` re-indented two spaces per level, using `eol` for every line break it writes; null when it is not JSON
 * (a trailing comma excepted). The result has no leading or trailing whitespace and is idempotent.
 */
export function formatJsonText(text: string, eol: string): string | null {
  const result = formatJsonDetailed(text, eol);
  return result.ok ? result.text : null;
}

function eligible(input: Pick<OperationInput, 'document' | 'node' | 'range'>): boolean {
  const node = input.node;
  if (!node || node.type !== 'codeBlock') return false;
  if ((node as CodeBlock).lang?.toLowerCase() !== 'json') return false;
  if (!input.document.children.includes(node)) return false;
  if (input.range.start !== node.src.start || input.range.end !== node.src.end) return false;
  return lineStartAt(input.document, node.src.start) === node.src.start;
}

const TRAILING_EOL = /(?:\r\n|\n|\r)$/;

/** Pretty-print JSON. Pure. Only the bytes between the fence lines change; the final line ending of the content stays. */
export const formatJson: Operation = {
  id: 'format-json',
  title: 'Pretty-print JSON',
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
    const content = input.text.slice(start, end);
    const eol = /\r\n|\n|\r/.test(content) ? eolOf(content) : eolOf(input.text);
    const result = formatJsonDetailed(content, eol);
    if (!result.ok) {
      return { replacement: input.text, summary: `Not formatted: not strict JSON near line ${result.line}` };
    }
    const tail = TRAILING_EOL.exec(content)?.[0] ?? '';
    const replacement = replaceSpans(input.text, [{ start, end, text: result.text + tail }]);
    return replacement === input.text ? { replacement, summary: 'Already formatted' } : { replacement, summary: 'Pretty-printed JSON' };
  },
};
