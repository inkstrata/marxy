// W-17: text that came out of the file (a key, a value, the words of a note) is never drawn raw in the metadata surfaces. A bidi
// control or a zero-width character shows as the same visible mark Read draws (`appendInvisibleSegments`), and the element holding
// it reads aloud with each such character named (commitment 4: nothing hidden silently). Built with createElement and textContent only.
import { invisibleHexLabel, invisibleSegments } from '@marxy/core/src/render/index.ts';
import { appendInvisibleSegments } from '../render/invisibles-dom.ts';

const CTX = { inCode: false, sourceStart: 1 } as const;
/** Printable ASCII, tab and the line breaks: nothing in it can be flagged, so most text skips the walk. */
const PLAIN = /^[\t\n\r\x20-\x7e]*$/;

/** `text` with each flagged character named (`U+202E`) in place of itself, for a label a screen reader speaks and a tooltip shows. */
export function spokenText(text: string): string {
  if (PLAIN.test(text)) return text;
  return invisibleSegments(text, CTX)
    .map((seg) => (seg.kind === 'text' ? seg.value : seg.kind === 'tag-run' ? ` tag ×${seg.count} ` : ` U+${invisibleHexLabel(seg.cp)} `))
    .join('');
}

/** Whether `text` holds a character that would be drawn as a mark. */
export function hasMarks(text: string): boolean {
  return !PLAIN.test(text) && invisibleSegments(text, CTX).some((seg) => seg.kind !== 'text');
}

/** Sets `node`'s content to `text`: plain text as it is, a flagged character as a visible mark inside one labelled run. */
export function setMarked(node: Element, text: string): void {
  if (!hasMarks(text)) {
    node.textContent = text;
    return;
  }
  const run = node.ownerDocument.createElement('span');
  run.setAttribute('role', 'img');
  run.setAttribute('aria-label', spokenText(text));
  appendInvisibleSegments(run, invisibleSegments(text, CTX));
  node.replaceChildren(run);
}
