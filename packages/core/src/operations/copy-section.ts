// copy-section: markdown source for a heading section or the whole document (ADR-0004, MARXY-42).
import type { Document } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { renderDocumentSafeHtml } from '../render/pipeline.ts';

function isWholeDocument(input: Omit<OperationInput, 'text'>, doc: Document): boolean {
  return (
    input.node === undefined &&
    input.range.start === doc.src.start &&
    input.range.end === doc.src.end
  );
}

/** Copy section. Pure: text in, text out; never touches bytes outside input.range. */
export const copySection: Operation = {
  id: 'copy-section',
  title: 'Copy section',
  appliesTo: ['section', 'document'],
  canApply(input) {
    if (input.node?.type === 'heading') return true;
    return isWholeDocument(input, input.document);
  },
  run(input: OperationInput): OperationResult {
    const clipText = input.text.replace(/\s+$/, '') + '\n';
    const parsed = parseMarkdown(new TextEncoder().encode(clipText), { file: input.document.path });
    let html = renderDocumentSafeHtml(parsed).html;
    html = html.replace(/\sdata-marxy-[a-z0-9-]+="[^"]*"/gi, '');
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    return {
      replacement: input.text,
      clipboard: { text: clipText, html },
    };
  },
};
