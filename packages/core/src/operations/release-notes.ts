// The newest release of a changelog (K-22): the section of its first version heading, skipping an "Unreleased" one, as
// the bytes the file holds. A pure read over the parse: nothing is edited and nothing is rewritten, so what a copy of it
// carries is the file's own text from the heading to the line before the next heading of the same or a higher level
// (`sectionRange`, the range Copy section takes).
import type { Document, Heading, Inline, Source } from '../contracts/ast.ts';
import { sectionRange } from '../sourcemap/section.ts';

/** A version heading's words open with a version number: `1.4.0`, `[1.4.0]`, `v2.0`, `Version 3.1`; never "Unreleased". */
const VERSION = /^(?:\[\s*)?(?:version\s+)?v?\d+\.\d+/i;

/** The newest release: its heading, the label ("1.4.0") and the bytes it spans. */
export interface Release {
  readonly heading: Heading;
  /** The heading's words without the brackets, the date or the link: what a notice names ("1.4.0"). */
  readonly label: string;
  readonly range: Source;
}

function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'emphasis':
        case 'strong':
        case 'strikethrough':
        case 'link':
          return plain(node.children);
        default:
          return '';
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words of a version heading, or null when the heading is not one. */
export function versionLabel(heading: Heading): string | null {
  const words = plain(heading.children);
  if (!VERSION.test(words)) return null;
  const match = /^(?:\[\s*)?(?:version\s+)?(v?\d+(?:\.[0-9A-Za-z+_-]+)+)/i.exec(words);
  return match?.[1] ?? words;
}

/**
 * The first version heading of the document (Keep a Changelog order, newest first) and its section; null when no heading
 * names a version. Only the document's own headings count: one in a quote or a list item is not a release.
 */
export function newestRelease(doc: Document): Release | null {
  for (const block of doc.children) {
    if (block.type !== 'heading') continue;
    const label = versionLabel(block);
    if (label === null) continue;
    return { heading: block, label, range: sectionRange(doc, block) };
  }
  return null;
}
