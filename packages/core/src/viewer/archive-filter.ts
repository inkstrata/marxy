// The archive page's filter (`=`): `= reading:picture size>1mb`. Bare words and `name:` match
// the entry's own name, `reading:` what it reads as (its words or its group), `size` and `packed` compare bytes; every
// term must hold. Pure: the page asks it of each entry with the reading it has now.

export type SizeOp = '>' | '<' | '>=' | '<=';

export type FilterTerm =
  | { readonly by: 'name' | 'reading'; readonly word: string }
  | { readonly by: 'size' | 'packed'; readonly op: SizeOp; readonly bytes: number };

export interface ArchiveFilter {
  /** The query as written, trimmed: what the page says it is matching. */
  readonly text: string;
  readonly terms: readonly FilterTerm[];
}

/** What a term is asked of: an entry of the listing and what it reads as now. */
export interface FilterSubject {
  readonly path: string;
  readonly size: number | null;
  readonly packed: number | null;
}

// 1024-based, as the page writes its sizes ("2.1 KB").
const UNITS: Readonly<Record<string, number>> = { '': 1, b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

const HOW = 'Filter by words in the name, name:, reading:, size> or size< (b, kb, mb, gb) and packed> or packed<.';

/** A query read into its terms, or the sentence that says which term could not be read. */
export function parseArchiveFilter(query: string): ArchiveFilter | { readonly error: string } {
  const text = query.trim();
  const terms: FilterTerm[] = [];
  // A quoted value keeps its spaces: name:"tide table".
  for (const m of text.matchAll(/(?:[^\s"]*")[^"]*"?|\S+/g)) {
    const raw = m[0];
    const sized = /^(size|packed)(>=|<=|>|<)(.*)$/i.exec(raw);
    if (sized) {
      const n = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(sized[3]!);
      const unit = n ? UNITS[n[2]!.toLowerCase()] : undefined;
      if (!n || unit === undefined) return { error: `“${raw}” is not a size: write ${sized[1]!.toLowerCase()}${sized[2]}100kb, with b, kb, mb or gb.` };
      terms.push({ by: sized[1]!.toLowerCase() as 'size' | 'packed', op: sized[2] as SizeOp, bytes: Math.round(Number(n[1]) * unit) });
      continue;
    }
    const keyed = /^([a-z]+):(.*)$/i.exec(raw);
    if (keyed) {
      const key = keyed[1]!.toLowerCase();
      if (key === 'size' || key === 'packed') return { error: `“${raw}” needs a comparison: ${key}>100kb or ${key}<2mb.` };
      if (key !== 'name' && key !== 'reading') return { error: `“${key}:” is not a filter. ${HOW}` };
      const word = unquote(keyed[2]!);
      if (word === '') return { error: `“${raw}” has nothing after it. ${HOW}` };
      terms.push({ by: key, word: word.toLowerCase() });
      continue;
    }
    const word = unquote(raw);
    if (word !== '') terms.push({ by: 'name', word: word.toLowerCase() });
  }
  if (terms.length === 0) return { error: HOW };
  return { text, terms };
}

const unquote = (s: string): string => (s.startsWith('"') ? s.slice(1, s.endsWith('"') && s.length > 1 ? -1 : undefined) : s);

const compare = (v: number, op: SizeOp, to: number): boolean => (op === '>' ? v > to : op === '<' ? v < to : op === '>=' ? v >= to : v <= to);

/** Whether `e` holds to every term. An entry whose size the archive does not say holds to no size term. */
export function filterMatches(f: ArchiveFilter, e: FilterSubject, reading: { readonly label: string; readonly group: string }): boolean {
  const name = e.path.replace(/\/$/, '').slice(e.path.replace(/\/$/, '').lastIndexOf('/') + 1).toLowerCase();
  for (const t of f.terms) {
    if (t.by === 'name') {
      if (!name.includes(t.word)) return false;
    } else if (t.by === 'reading') {
      if (!reading.label.toLowerCase().includes(t.word) && !reading.group.toLowerCase().includes(t.word)) return false;
    } else if ('op' in t) {
      const v = t.by === 'size' ? e.size : e.packed;
      if (v === null || !compare(v, t.op, t.bytes)) return false;
    }
  }
  return true;
}
