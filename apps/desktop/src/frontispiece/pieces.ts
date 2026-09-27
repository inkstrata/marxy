// The Commonplace as the empty window reads it (MARXY-257): which piece to show, and the few
// front-matter fields the layout needs. Pure: no DOM, no Vite, so it runs in Node for tests. The piece
// format is apps/desktop/src/commonplace/FORMAT.md (MARXY-256).

/** One piece, not yet read: `load` fetches its markdown only when the piece is chosen. */
export interface PieceSource {
  /** The file's slug, `<slug>.md` without the extension. */
  readonly name: string;
  load(): Promise<string>;
}

export type PieceForm = 'verse' | 'prose' | 'code';

/** What the layout reads from a piece's front matter; everything else there is for the corpus check. */
export interface PieceMatter {
  readonly title: string | null;
  readonly author: string | null;
  readonly form: PieceForm;
  /** BCP 47 tags in the order the body's sections appear; empty when the piece names none. */
  readonly languages: readonly string[];
}

export interface ChosenPiece {
  readonly name: string;
  readonly text: string;
}

const FORMS: readonly PieceForm[] = ['verse', 'prose', 'code'];

/** `import.meta.glob`'s record as sources, named by slug and in a stable order. */
export function piecesFromGlob(record: Readonly<Record<string, () => Promise<unknown>>>): PieceSource[] {
  return Object.keys(record)
    .sort()
    .map((path) => ({
      name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
      load: async () => String(await record[path]!()),
    }));
}

/** One of `sources`, uniformly; null when there are none. `random` returns a number in [0, 1). */
export function choosePiece(sources: readonly PieceSource[], random: () => number = Math.random): PieceSource | null {
  if (sources.length === 0) return null;
  const i = Math.min(sources.length - 1, Math.max(0, Math.floor(random() * sources.length)));
  return sources[i]!;
}

/** Chooses one piece and reads only that one. Null when there is nothing to choose or it cannot be read. */
export async function loadRandomPiece(
  sources: readonly PieceSource[],
  random: () => number = Math.random,
): Promise<ChosenPiece | null> {
  const source = choosePiece(sources, random);
  if (!source) return null;
  try {
    return { name: source.name, text: await source.load() };
  } catch {
    return null;
  }
}

/** A plain or quoted YAML scalar, with a trailing ` # comment` removed from a plain one. */
function scalar(raw: string): string {
  const s = raw.trim();
  const quote = s[0];
  if (quote === '"' || quote === "'") {
    const end = s.indexOf(quote, 1);
    if (end > 0) return s.slice(1, end);
  }
  return s.replace(/\s+#.*$/, '').trim();
}

/** A flow sequence `[a, b]`, or null when `raw` is not one. */
function flowList(raw: string): string[] | null {
  const m = /^\[(.*)\]\s*(?:#.*)?$/.exec(raw.trim());
  if (!m) return null;
  return m[1]!.split(',').map(scalar).filter(Boolean);
}

/**
 * The layout's fields from a piece's front matter (the YAML between the `---` lines, as the parser's
 * frontmatter node holds it). Reads top-level `key: value` lines, quoted or plain, and `languages` as a
 * flow or block sequence. Anything it does not understand is left out, never an error: a piece with odd
 * front matter still shows, as prose.
 */
export function readFrontMatter(yaml: string): PieceMatter {
  const fields = new Map<string, string>();
  let languages: string[] = [];
  let inLanguages = false;
  for (const line of yaml.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (inLanguages && item) {
      const tag = scalar(item[1]!);
      if (tag) languages.push(tag);
      continue;
    }
    inLanguages = false;
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!;
    if (key === 'languages') {
      const list = flowList(value);
      if (list) languages = list;
      else if (scalar(value) === '') inLanguages = true;
      else languages = [scalar(value)];
      continue;
    }
    fields.set(key, scalar(value));
  }
  const form = fields.get('form') as PieceForm | undefined;
  return {
    title: fields.get('title') || null,
    author: fields.get('author') || null,
    form: form && FORMS.includes(form) ? form : 'prose',
    languages,
  };
}

/** Scripts written right to left, by primary language subtag. */
const RTL = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ku', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi']);

/** The writing direction of a BCP 47 tag: an explicit script subtag wins over the language. */
export function directionOf(tag: string): 'ltr' | 'rtl' {
  const parts = tag.toLowerCase().split('-');
  const script = parts.find((p, i) => i > 0 && p.length === 4);
  if (script) return ['arab', 'hebr', 'syrc', 'thaa', 'nkoo', 'adlm', 'rohg'].includes(script) ? 'rtl' : 'ltr';
  return RTL.has(parts[0]!) ? 'rtl' : 'ltr';
}
