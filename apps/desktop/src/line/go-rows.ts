// The Go scope's own rows besides files, headings and commands: a written reference
// (`path:12-18`) that goes there, the open tabs, and, on an empty Line, the scopes a first character picks.
import type { IndexEntry } from '@marxy/core';
import { appHandle } from '../commands/app-handle.ts';
import { documentName, isUntitled } from '../document/untitled.ts';
import { landAtLine } from './go.ts';
import { fuzzy, referenceQuery, resolveReference } from './refs.ts';
import type { LineRow } from './rows.ts';
import { SCOPES } from './scopes.ts';

const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

/** Opens `path` here or beside, then puts the cursor on line `from` (to `to`). */
export function openAtLine(path: string, from: number, to: number | null, beside: boolean): void {
  const handle = appHandle();
  if (!handle) return;
  void handle.open(path, { target: beside ? 'other' : undefined, onLanded: () => void handle.panes().focused.view.settled().then(() => landAtLine(from, to)) });
}

/** A written reference resolved against the index: the row that goes there, first in Go. */
export function referenceRows(q: string, entries: readonly IndexEntry[], here: string | null): LineRow[] {
  const ref = referenceQuery(q);
  if (!ref) return [];
  const paths = entries.map((e) => e.path);
  if (here !== null) paths.push(here);
  const path = resolveReference(ref.path, paths, here);
  if (path === null) return [];
  return [
    {
      key: `ref:${path}:${ref.from}-${ref.to}`,
      group: 'Reference',
      title: q.trim(),
      detail: ref.to === null ? `line ${ref.from}` : `lines ${ref.from}–${ref.to}`,
      run: (how) => openAtLine(path, ref.from, ref.to, how.beside),
      keep: { panel: 'places', arg: { reveal: path } },
    },
  ];
}

const nameOf = (path: string): string => (isUntitled(path) ? documentName(path) : basename(path));

/** The open tabs other than the one in front: all of them on an empty Line, those whose name holds the query else. */
export function tabRows(q: string, here: string | null): LineRow[] {
  const handle = appHandle();
  const tabs = (typeof handle?.frame === 'function' ? handle.frame()?.tabs.model.tabs : undefined) ?? [];
  const rows: { row: LineRow; score: number }[] = [];
  for (const t of tabs) {
    if (t.path === here) continue;
    const name = nameOf(t.path);
    const m = q === '' ? { idx: [] as number[], score: 0 } : fuzzy(q, name);
    if (!m) continue;
    rows.push({
      score: m.score,
      row: {
        key: `tab:${t.path}`,
        group: 'Open',
        title: name,
        marks: m.idx,
        detail: t.path.startsWith('marxy:') || isUntitled(t.path) ? '' : t.path,
        run: (how) => void handle?.open(t.path, how.beside ? { target: 'other' } : undefined),
        keep: { panel: 'places', arg: { reveal: t.path } },
      },
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, q === '' ? 8 : 4).map((r) => r.row);
}

/** On an empty Line: what each first character does, choosing one types it. */
export function orTypeRows(setQuery: (value: string) => void): LineRow[] {
  return SCOPES.filter((s) => s.mark !== '?' && s.mark !== '%' && s.mark !== '&' && s.mark !== '~').concat(SCOPES.filter((s) => s.mark === '?')).map((s) => ({
    key: `or:${s.mark}`,
    group: 'Or type',
    title: `${s.mark}  ${s.does}`,
    run: () => {
      setQuery(s.mark);
      return true;
    },
  }));
}
