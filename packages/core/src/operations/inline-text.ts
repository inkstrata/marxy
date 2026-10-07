// The plain text of a run of inline nodes: what a reader would read, without markup.
import type { Inline } from '../contracts/ast.ts';

export interface InlinePlainTextOptions {
  /** What a hard break becomes. Default `'\n'`. */
  readonly hardBreak?: string;
}

export function inlinePlainText(nodes: readonly Inline[], opts: InlinePlainTextOptions = {}): string {
  const hardBreak = opts.hardBreak ?? '\n';
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
      case 'mathInline':
        out += node.value;
        break;
      case 'emphasis':
      case 'strong':
      case 'strikethrough':
      case 'link':
        out += inlinePlainText(node.children, opts);
        break;
      case 'image':
        out += node.alt;
        break;
      case 'softBreak':
        out += ' ';
        break;
      case 'hardBreak':
        out += hardBreak;
        break;
      case 'footnoteReference':
        out += `[${node.label}]`;
        break;
      case 'html':
      case 'taskMarker':
        break;
    }
  }
  return out;
}
