// Extract verbs (C-09): gather what an agent's answer scatters across a section or the document.
// Clipboard only; each is offered only when the range holds at least one item.
import type { Document, Heading, Inline, Link, ListItem, Node, Source } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { DEFAULT_POLICY } from '../sanitize/policy.ts';
import { sanitizeUrl } from '../sanitize/urls.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { inlinePlainText } from './inline-text.ts';

type Scope = Omit<OperationInput, 'text'>;

/** The byte range an extract verb reads, or null when the selection is neither a section nor the document. */
function scopeOf(input: Scope): Source | null {
  if (input.node?.type === 'heading') return sectionRange(input.document, input.node as Heading);
  const doc: Document = input.document;
  if (input.node === undefined && input.range.start === doc.src.start && input.range.end === doc.src.end) return doc.src;
  return null;
}

/** Depth-first, document order. `visit` returns true to stop. */
function walk(node: Node, range: Source, ancestors: Node[], visit: (n: Node, a: readonly Node[]) => boolean): boolean {
  if (node.type !== 'document' && (node.src.end <= range.start || node.src.start >= range.end)) return false;
  if (node.type !== 'document' && node.src.start >= range.start && node.src.end <= range.end && visit(node, ancestors)) return true;
  const children = (node as { children?: readonly Node[] }).children;
  if (!Array.isArray(children)) return false;
  ancestors.push(node);
  for (const child of children) {
    if (walk(child, range, ancestors, visit)) {
      ancestors.pop();
      return true;
    }
  }
  ancestors.pop();
  return false;
}

function collect<T>(input: Scope, pick: (n: Node, ancestors: readonly Node[]) => T | undefined, limit = Infinity): T[] {
  const range = scopeOf(input);
  const found: T[] = [];
  if (range === null) return found;
  walk(input.document, range, [], (node, ancestors) => {
    const item = pick(node, ancestors);
    if (item !== undefined) found.push(item);
    return found.length >= limit;
  });
  return found;
}

function plural(n: number, one: string, many: string): string {
  return `Copied ${n} ${n === 1 ? one : many}`;
}

function result(input: OperationInput, text: string, summary: string): OperationResult {
  return { replacement: input.text, clipboard: { text }, summary };
}

const codeBlocksIn = (input: Scope, limit?: number) => collect(input, (n) => (n.type === 'codeBlock' ? n.value : undefined), limit);

export const extractCodeBlocks: Operation = {
  id: 'extract-code-blocks',
  title: 'Copy all code blocks',
  appliesTo: ['section', 'document'],
  canApply: (input) => codeBlocksIn(input, 1).length > 0,
  run(input) {
    const blocks = codeBlocksIn(input);
    return result(input, blocks.map((v) => v.replace(/\n$/, '')).join('\n\n'), plural(blocks.length, 'code block', 'code blocks'));
  },
};

interface Task { readonly depth: number; readonly text: string; }

const tasksIn = (input: Scope, limit?: number): Task[] =>
  collect(input, (n, ancestors): Task | undefined => {
    if (n.type !== 'listItem' || (n as ListItem).task !== 'unchecked') return undefined;
    const first = (n as ListItem).children.find((b) => b.type === 'paragraph');
    const text = first && first.type === 'paragraph'
      ? inlinePlainText(first.children, { hardBreak: ' ' }).replace(/\s+/g, ' ').trim()
      : '';
    return { depth: ancestors.filter((a) => a.type === 'listItem').length, text };
  }, limit);

export const extractTasks: Operation = {
  id: 'extract-tasks',
  title: 'Copy unchecked tasks',
  appliesTo: ['section', 'document'],
  canApply: (input) => tasksIn(input, 1).length > 0,
  run(input) {
    const tasks = tasksIn(input);
    const base = Math.min(...tasks.map((t) => t.depth));
    const lines = tasks.map((t) => `${'  '.repeat(t.depth - base)}- [ ] ${t.text}`.trimEnd());
    return result(input, lines.join('\n'), plural(tasks.length, 'unchecked task', 'unchecked tasks'));
  },
};

interface Found { readonly text: string; readonly url: string; }

/** A link's target as the renderer would emit it; null when the renderer would refuse it (javascript:, data:, …). */
function safeTarget(link: Link): string | null {
  const decision = sanitizeUrl(link.url, 'link', DEFAULT_POLICY);
  return decision.allowed ? decision.value : null;
}

const linksIn = (input: Scope, limit?: number): Found[] =>
  collect(input, (n): Found | undefined => {
    if (n.type !== 'link') return undefined;
    const url = safeTarget(n);
    if (url === null) return undefined;
    return { url, text: inlinePlainText(n.children as readonly Inline[], { hardBreak: ' ' }).replace(/\s+/g, ' ').trim() };
  }, limit);

function markdownLink({ text, url }: Found): string {
  const label = (text === '' ? url : text).replace(/([\\[\]])/g, '\\$1');
  const target = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
  return `- [${label}](${target})`;
}

export const extractLinks: Operation = {
  id: 'extract-links',
  title: 'Copy all links',
  appliesTo: ['section', 'document'],
  canApply: (input) => linksIn(input, 1).length > 0,
  run(input) {
    const seen = new Set<string>();
    const unique = linksIn(input).filter((l) => !seen.has(l.url) && seen.add(l.url));
    return result(input, unique.map(markdownLink).join('\n'), plural(unique.length, 'link', 'links'));
  },
};
