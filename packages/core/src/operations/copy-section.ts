// copy-section: markdown source for a heading section or the whole document (ADR-0004, MARXY-42).
import type { Document, Heading } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { sectionOf, stripRendererProvenance } from './html-clean.ts';
import { renderDocumentSafeHtml } from '../render/pipeline.ts';
import { sectionRange } from '../sourcemap/section.ts';

function isWholeDocument(input: Omit<OperationInput, 'text'>, doc: Document): boolean {
  return (
    input.node === undefined &&
    input.range.start === doc.src.start &&
    input.range.end === doc.src.end
  );
}

/**
 * The slice without its trailing blank lines. The last content line keeps its own line ending
 * (CRLF included) and trailing spaces; a final line with no ending stays without one.
 */
function withoutTrailingBlankLines(text: string): string {
  let end = text.length;
  for (;;) {
    // The line that ends at `end`, and where it starts (after its predecessor's terminator).
    let lineEnd = end;
    if (text[lineEnd - 1] === '\n') lineEnd -= text[lineEnd - 2] === '\r' ? 2 : 1;
    else if (text[lineEnd - 1] === '\r') lineEnd -= 1;
    let lineStart = lineEnd;
    while (lineStart > 0 && text[lineStart - 1] !== '\n' && text[lineStart - 1] !== '\r') lineStart--;
    if (lineStart === end || !/^[ \t]*$/.test(text.slice(lineStart, lineEnd))) return text.slice(0, end);
    end = lineStart;
  }
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
    if (input.node?.type === 'heading') {
      const section = sectionRange(input.document, input.node as Heading);
      if (section.start !== input.range.start || section.end !== input.range.end) {
        return { replacement: input.text };
      }
    }
    // The source slice less its trailing blank lines: never a newline the source did not have
    // (MARXY-230), and the last content line's own trailing whitespace and ending (CRLF too) kept.
    const clipText = withoutTrailingBlankLines(input.text);
    const html = stripRendererProvenance(renderDocumentSafeHtml(sectionOf(input)).html);
    return {
      replacement: input.text,
      clipboard: { text: clipText, html },
    };
  },
};
