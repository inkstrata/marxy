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

/**
 * The section as a document of the open document's own blocks. Its links were resolved against the
 * whole file, so a `[text][ref]` whose definition sits elsewhere stays a link; a re-parse of the
 * section alone would turn it back into brackets. A range that cuts through a top-level block is
 * re-parsed on its own, which is the best that text can do.
 */
function sectionOf(input: OperationInput): Document {
  const { document, range } = input;
  const inside = document.children.filter((block) => block.src.start >= range.start && block.src.end <= range.end);
  const covered = inside.length > 0 && document.children.every(
    (block) => inside.includes(block) || block.src.end <= range.start || block.src.start >= range.end,
  );
  if (covered) return { ...document, src: range, children: inside };
  const clipText = input.text.replace(/\s+$/, '') + '\n';
  return parseMarkdown(new TextEncoder().encode(clipText), { file: document.path });
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
    let html = renderDocumentSafeHtml(sectionOf(input)).html;
    html = html.replace(/\sdata-marxy-[a-z0-9-]+="[^"]*"/gi, '');
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    return {
      replacement: input.text,
      clipboard: { text: clipText, html },
    };
  },
};
