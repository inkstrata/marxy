// Where the caret goes when a block opens for editing: the end of what the reader would call its text, never past a
// line that is syntax (a closing fence, a setext underline, a table's last pipe) and never into a nested list.

const FENCE = /^\s*(`{3,}|~{3,})/;
const UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const MARKER = /^\s*([-*+>]|\d+[.)])/;

/** `[start, end)` of each line of `text`, without its terminator. */
function lineSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /[^\r\n]*(\r\n|\n|\r|$)/g;
  for (let m = re.exec(text); m !== null && m.index < text.length; m = re.exec(text)) {
    spans.push([m.index, m.index + m[0].length - m[1]!.length]);
    if (m[0].length === 0) break;
  }
  return spans;
}

/**
 * The caret's offset in `text`, the block as the editor holds it. `nestedAt` is where a list item's nested list begins
 * in `text`, or null: the caret then stays in the item's own text.
 */
export function caretOffset(text: string, nestedAt: number | null): number {
  if (nestedAt !== null) return text.slice(0, nestedAt).replace(/[\r\n][ \t]*$/, '').length;
  const spans = lineSpans(text.replace(/[\r\n]+$/, ''));
  const last = spans.at(-1);
  if (last === undefined) return 0;
  const line = (i: number): string => text.slice(spans[i]![0], spans[i]![1]);
  if (spans.length > 1) {
    if (FENCE.test(line(0)) && FENCE.test(line(spans.length - 1)) && !/[^`~\s]/.test(line(spans.length - 1))) {
      return spans[spans.length - 2]![1];
    }
    if (spans.length === 2 && UNDERLINE.test(line(1)) && !MARKER.test(line(0))) return spans[0]![1];
    if (spans.length > 2 && line(1).includes('-') && DELIMITER_ROW.test(line(1)) && line(0).includes('|')) {
      const row = line(spans.length - 1);
      if (row.trimEnd().endsWith('|')) {
        let at = spans.at(-1)![0] + row.lastIndexOf('|');
        while (at > last[0] && /\s/.test(text[at - 1]!)) at--;
        return at;
      }
    }
  }
  return last[1];
}
