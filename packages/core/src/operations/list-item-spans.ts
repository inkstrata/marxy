// The marker and content spans of a list's top-level items, shared by sort-list-items (E-09) and list-markers (E-08.1).
import type { List, ListItem, Source } from '../contracts/ast.ts';
import { textIndex } from './text-helpers.ts';

export interface ItemSpans {
  readonly item: ListItem;
  /** The marker, `[item start, first child start)`; for an item with no content, the whole item. UTF-16 offsets inside the range's text. */
  readonly marker: { readonly start: number; readonly end: number };
  /** The content, `[first child start, item end)`. It moves. */
  readonly content: { readonly start: number; readonly end: number };
}

/** The marker and content spans of each top-level item, as UTF-16 offsets in `text` (the bytes of `range`). Null when an item lies outside the range. */
export function itemSpans(list: List, range: Source, text: string): ItemSpans[] | null {
  const index = textIndex(text);
  const rel = (byte: number): number => index.toIndex(byte - range.start);
  const out: ItemSpans[] = [];
  let at = 0;
  for (const item of list.children) {
    if (item.src.start < range.start || item.src.end > range.end || item.src.start < at) return null;
    const start = rel(item.src.start);
    const end = rel(item.src.end);
    const first = item.children[0];
    const split = first && first.src.start >= item.src.start && first.src.start <= item.src.end ? rel(first.src.start) : end;
    out.push({ item, marker: { start, end: split }, content: { start: split, end } });
    at = item.src.end;
  }
  return out;
}
