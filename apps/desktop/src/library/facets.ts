// The library's filter menus (U-10): Kind, Status and Modified, beside the query field. A menu holds no state of its own:
// choosing an item writes a term into the field's text (and choosing it again takes it out), so what the reader sees in
// the field is the whole of the filter. A menu is offered only with something behind it: an item whose term would match
// nothing in the scope, and a menu left with no item, are not drawn. Pure and DOM-free.
import type { IndexEntry } from '@marxy/core';
import { parseQuery, type FieldTerm, type QueryKey } from '@marxy/core/src/index-model/index.ts';

export interface FacetItem {
  /** The words on the item. */
  readonly label: string;
  /** The term it writes: `kind:report`, `is:pinned`, `modified:<7d`. */
  readonly term: string;
  /** Entries of the scope it would leave. */
  readonly count: number;
}

export interface FacetMenu {
  readonly id: 'kind' | 'status' | 'modified';
  readonly label: string;
  /** The key the menu writes; choosing in it replaces any other term of this key (and, for Status, of these values). */
  readonly key: QueryKey;
  readonly items: readonly FacetItem[];
}

export interface FacetInput {
  readonly entries: readonly IndexEntry[];
  readonly nowMs: number;
  readonly pinned: ReadonlySet<string>;
  readonly recent: ReadonlySet<string>;
  changed(entry: IndexEntry): boolean;
}

const DAY = 86_400_000;
const AGES: readonly (readonly [label: string, term: string, ms: number])[] = [
  ['Last 24 hours', 'modified:<1d', DAY],
  ['Last 7 days', 'modified:<7d', 7 * DAY],
  ['Last 30 days', 'modified:<30d', 30 * DAY],
];
const STATUS_VALUES = ['changed', 'pinned', 'recent'] as const;
const STATUS_LABEL: Readonly<Record<(typeof STATUS_VALUES)[number], string>> = {
  changed: 'Changed since you read',
  pinned: 'Pinned',
  recent: 'Recent',
};

/** The menus the scope's entries make worth drawing, in the order they are drawn; none when there is nothing to filter. */
export function facetMenus(input: FacetInput): readonly FacetMenu[] {
  const { entries } = input;
  const menus: FacetMenu[] = [];

  const kinds = new Map<string, number>();
  for (const e of entries) if (e.readerKind !== undefined) kinds.set(e.readerKind, (kinds.get(e.readerKind) ?? 0) + 1);
  if (kinds.size > 0) {
    const items = [...kinds].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([kind, count]) => ({ label: kind, term: `kind:${kind}`, count }));
    menus.push({ id: 'kind', label: 'Kind', key: 'kind', items });
  }

  const status = STATUS_VALUES.map((v) => ({
    label: STATUS_LABEL[v],
    term: `is:${v}`,
    count: entries.filter((e) => (v === 'changed' ? input.changed(e) : v === 'pinned' ? input.pinned.has(e.path) : input.recent.has(e.path))).length,
  })).filter((i) => i.count > 0);
  if (status.length > 0) menus.push({ id: 'status', label: 'Status', key: 'is', items: status });

  const modified = AGES.map(([label, term, ms]) => ({ label, term, count: entries.filter((e) => input.nowMs - e.mtimeMs <= ms).length })).filter((i) => i.count > 0);
  if (modified.length > 0) menus.push({ id: 'modified', label: 'Modified', key: 'modified', items: modified });
  return menus;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const writtenTerm = (text: string, t: FieldTerm): string => text.slice(t.range[0], t.range[1]);

/** The field terms of the menu's key as written, un-negated (a `-kind:x` is the reader's own and is left alone). */
function ownTerms(text: string, menu: FacetMenu): FieldTerm[] {
  return parseQuery(text)
    .groups.flat()
    .filter((t): t is FieldTerm => t.kind === 'field' && t.key === menu.key && !t.negated && (menu.id !== 'status' || t.values.every((v) => (STATUS_VALUES as readonly string[]).includes(v.toLowerCase()))))
    .sort((a, b) => a.range[0] - b.range[0]);
}

/** Which item of the menu the field's text has on now, if any. */
export function activeItem(text: string, menu: FacetMenu): FacetItem | undefined {
  const written = ownTerms(text, menu).map((t) => writtenTerm(text, t));
  return menu.items.find((i) => written.some((w) => same(w, i.term)));
}

/** The field's text with the item written in (replacing the menu's other terms), or taken out when it is on already. */
export function chooseFacet(text: string, menu: FacetMenu, item: FacetItem): string {
  const own = ownTerms(text, menu);
  const on = own.some((t) => same(writtenTerm(text, t), item.term));
  let out = text;
  for (const t of [...own].reverse()) out = `${out.slice(0, t.range[0])}${out.slice(t.range[1])}`;
  out = out.replace(/\s{2,}/g, ' ').trim();
  return on ? out : `${out}${out === '' ? '' : ' '}${item.term}`;
}
