// copy-section: markdown source for a heading section or the whole document (ADR-0004, MARXY-42).
import type { Document, Heading } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
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
  return parseMarkdown(new TextEncoder().encode(input.text), { file: document.path });
}

const PROVENANCE_ATTR = /^data-marxy-/i;

/** Drops renderer provenance attributes from tag openers only, never from text nodes (MARXY-230). */
function stripRendererProvenance(html: string): string {
  const parts: string[] = [];
  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      parts.push(html.slice(index));
      break;
    }
    parts.push(html.slice(index, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) {
        parts.push(html.slice(lt));
        break;
      }
      parts.push(html.slice(lt, end + 3));
      index = end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      parts.push(html.slice(lt));
      break;
    }
    parts.push(stripProvenanceFromTag(html.slice(lt, gt + 1)));
    index = gt + 1;
  }
  return parts.join('');
}

function stripProvenanceFromTag(tag: string): string {
  if (!tag.startsWith('<') || !tag.endsWith('>')) return tag;
  const selfClosing = tag.endsWith('/>');
  const contentEnd = selfClosing ? tag.length - 2 : tag.length - 1;
  let cursor = 1;
  if (tag.startsWith('</')) cursor = 2;
  while (cursor < contentEnd && tag[cursor] !== ' ' && tag[cursor] !== '\t' && tag[cursor] !== '\n' && tag[cursor] !== '\r' && tag[cursor] !== '/') {
    cursor++;
  }
  let out = tag.slice(0, cursor);
  while (cursor < contentEnd) {
    while (cursor < contentEnd && (tag[cursor] === ' ' || tag[cursor] === '\t' || tag[cursor] === '\n' || tag[cursor] === '\r')) {
      out += tag[cursor++];
    }
    if (cursor >= contentEnd) break;
    const nameStart = cursor;
    while (cursor < contentEnd && tag[cursor] !== '=' && tag[cursor] !== ' ' && tag[cursor] !== '\t' && tag[cursor] !== '\n' && tag[cursor] !== '\r' && tag[cursor] !== '/') {
      cursor++;
    }
    const attrName = tag.slice(nameStart, cursor);
    while (cursor < contentEnd && (tag[cursor] === ' ' || tag[cursor] === '\t' || tag[cursor] === '\n' || tag[cursor] === '\r')) cursor++;
    let valueEnd = cursor;
    if (cursor < contentEnd && tag[cursor] === '=') {
      cursor++;
      while (cursor < contentEnd && (tag[cursor] === ' ' || tag[cursor] === '\t' || tag[cursor] === '\n' || tag[cursor] === '\r')) cursor++;
      const quote = tag[cursor];
      if (quote === '"' || quote === "'") {
        cursor++;
        while (cursor < contentEnd && tag[cursor] !== quote) cursor++;
        if (cursor < contentEnd) cursor++;
      } else {
        while (cursor < contentEnd && tag[cursor] !== ' ' && tag[cursor] !== '\t' && tag[cursor] !== '\n' && tag[cursor] !== '\r' && tag[cursor] !== '/') {
          cursor++;
        }
      }
      valueEnd = cursor;
    }
    if (!PROVENANCE_ATTR.test(attrName)) out += tag.slice(nameStart, valueEnd);
  }
  out += selfClosing ? '/>' : '>';
  return out.replace(/\s+>/g, '>');
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
