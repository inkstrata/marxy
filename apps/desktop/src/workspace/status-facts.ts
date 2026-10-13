// The status bar's facts, with no DOM (W-11): the items a snapshot of the focused document gives, the word and line counters, the
// caret as the Source frame says it, the section under a byte, and which items are buttons. `status-bar.ts` reads the page and
// draws these; `status-bar.test.ts` holds every rule here, under node. The labels are `source/frame-facts.ts`'s, so Source's
// frame and the bar read alike and nothing here formats a count twice.
import { type Buffer, type OutlineEntry } from '@marxy/core';
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { countsAsMarkdown } from '@marxy/core/src/index-model/words.ts';
import { type EncodingFact, formatCount, lineEndingFact, linesLabel } from '../source/frame-facts.ts';
import type { BundledThemeName } from '../theme/bundled-themes.ts';

/** The kinds read as prose: their measure is words. Every other kind is read by the line (W-16 lets the reader choose). */
export const PROSE_KINDS: ReadonlySet<Kind> = new Set<Kind>(['article', 'report', 'readme', 'docs', 'notes', 'transcript', 'book']);

export type MeasureName = 'words' | 'lines';

export function measureFor(kind: Kind): MeasureName {
  return PROSE_KINDS.has(kind) ? 'words' : 'lines';
}

/** "1 word", "2,140 words". */
export function wordsLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'word' : 'words'}`;
}

/** How the language of a code file is written; any id not here is capitalised. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript', javascript: 'JavaScript', tsx: 'TSX', jsx: 'JSX', cpp: 'C++', c: 'C', rust: 'Rust', python: 'Python',
  go: 'Go', java: 'Java', kotlin: 'Kotlin', ruby: 'Ruby', php: 'PHP', swift: 'Swift', bash: 'Shell', json: 'JSON', toml: 'TOML',
  yaml: 'YAML', html: 'HTML', xml: 'XML', sql: 'SQL', graphql: 'GraphQL', lua: 'Lua', r: 'R', elixir: 'Elixir', haskell: 'Haskell',
  vue: 'Vue', svelte: 'Svelte', css: 'CSS', scss: 'SCSS', docker: 'Dockerfile', make: 'Makefile', markdown: 'Markdown', mdx: 'MDX',
};

/** "Report", "Log", "Code · Rust": the kind with its first letter up, and for code the language the file's name says. */
export function kindLabel(kind: Kind, path: string): string {
  const name = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (kind !== 'code') return name;
  const id = fileTypeOf(path)?.shiki;
  if (id === undefined) return name;
  return `${name} · ${LANGUAGE_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)}`;
}

/** The theme in force, in the words the palette's theme commands use; a light or dark variant names the half it is. */
export function themeLabel(theme: BundledThemeName | 'folder' | null, variant: 'light' | 'dark'): string {
  switch (theme) {
    case null: return variant === 'light' ? 'Paper' : 'Night';
    case 'ink': return 'Ink';
    case 'warm': return variant === 'light' ? 'Sepia' : 'Dusk';
    case 'fjord': return 'Fjord';
    case 'high-contrast': return 'High contrast';
    default: return 'Theme folder';
  }
}

/** The caret as the Source frame says it: line, then column counted in characters (a pair is one, a tab is one). */
export function caretOf(doc: { lineAt(pos: number): { readonly number: number; readonly from: number }; sliceString(from: number, to?: number): string }, head: number): { line: number; column: number } {
  const line = doc.lineAt(head);
  const before = doc.sliceString(line.from, head);
  let column = 1;
  for (let i = 0; i < before.length; i++) {
    const c = before.charCodeAt(i);
    // A pair is one character; its low half is not counted again.
    if (!(c >= 0xdc00 && c <= 0xdfff && i > 0 && before.charCodeAt(i - 1) >= 0xd800 && before.charCodeAt(i - 1) <= 0xdbff)) column++;
  }
  return { line: line.number, column };
}

/** The lines of a file as Source shows them, read from its bytes: the editor's own rule (`lineCountOf`) without an editor. */
export function lineCountOfBytes(bytes: Uint8Array, eol: Buffer['eol'], bom: boolean): number {
  const from = bom && bytes.length >= 3 ? 3 : 0;
  if (bytes.length <= from) return 0;
  // CRLF and LF files break at 0x0A; a classic-Mac file at a lone CR; a mixed file is edited with LF (a lone CR is a character).
  const sep = eol === 'cr' ? 0x0d : 0x0a;
  let breaks = 0;
  for (let at = bytes.indexOf(sep, from); at !== -1; at = bytes.indexOf(sep, at + 1)) breaks++;
  return bytes[bytes.length - 1] === sep ? breaks : breaks + 1;
}

/** The heading of the section the byte offset is in, or null above the first heading (ADR-0018's coordinate, as the outline reads it). */
export function sectionAt(entries: readonly OutlineEntry[], byteOffset: number): string | null {
  let lo = 0;
  let hi = entries.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.src.start <= byteOffset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : entries[found]!.text;
}

// The counter is the library's (`@marxy/core`'s words.ts): one function, so the bar, `words:` and the Outline's sections agree.
export { countsAsMarkdown, countWords, createWordCounter, type WordCounter } from '@marxy/core/src/index-model/words.ts';

/** The bar's items, left to right then (`end`) right to left of the spacer. */
export type StatusItemId = 'kind' | 'measure' | 'where' | 'encoding' | 'progress' | 'theme' | 'size';

export interface StatusItem {
  readonly id: StatusItemId;
  readonly text: string;
  /** The longer sentence for the pointer. */
  readonly title: string;
  /** On the right of the bar. */
  readonly end: boolean;
}

/** Where an item leads when it is a button: an inspector tab, or the palette on a query. */
export type Opens = { readonly tab: string } | { readonly palette: string };

/** The doors: *where you are* opens Outline (W-10 registers it), the theme opens the palette on its commands. */
export const OPENS: Readonly<Partial<Record<StatusItemId, Opens>>> = {
  where: { tab: 'outline' },
  theme: { palette: '>Theme' },
};

/** Everything the bar says, already read. A null document has none of the file's facts; the theme and size are the window's. */
export interface StatusInput {
  readonly document: {
    readonly kind: Kind | null;
    readonly path: string;
    /** `words` while it is being counted: null, then the bar says so. */
    readonly words: number | null;
    readonly lines: number;
    /** The caret in Source; null in Read or before the editor exists. */
    readonly caret: { readonly line: number; readonly column: number } | null;
    /** The heading of the section under the reading line in Read; null above the first heading (and in Source). */
    readonly heading: string | null;
    readonly encoding: EncodingFact;
    /** `buffer.eol` and the editor's rows, for the line-ending label. */
    readonly eol: Buffer['eol'];
    readonly rows: number;
  } | null;
  readonly theme: string;
  readonly textSize: number;
  /** Indexing is slow enough to say so. */
  readonly indexing: boolean;
}

/** The items for a snapshot. Pure: no DOM and no clock. */
export function statusItems(input: StatusInput): readonly StatusItem[] {
  const items: StatusItem[] = [];
  const doc = input.document;
  if (doc !== null) {
    if (doc.kind !== null) {
      items.push({ id: 'kind', text: kindLabel(doc.kind, doc.path), title: 'How Marxy reads this file', end: false });
      if (measureFor(doc.kind) === 'words') {
        items.push({
          id: 'measure',
          text: doc.words === null ? 'Counting words…' : wordsLabel(doc.words),
          title: countsAsMarkdown(doc.path) ? 'Words in the text, not counting code and front matter' : 'Words in the text',
          end: false,
        });
      } else {
        items.push({ id: 'measure', text: linesLabel(doc.lines), title: 'Lines in the file; a last empty row after a final line break is not counted', end: false });
      }
    }
    if (doc.caret !== null) {
      items.push({
        id: 'where',
        text: `Ln ${formatCount(doc.caret.line)}, Col ${formatCount(doc.caret.column)}`,
        title: 'Line, then column counted in characters (a tab is one)',
        end: false,
      });
    } else if (doc.heading !== null) {
      items.push({ id: 'where', text: doc.heading, title: 'The section under the reading line', end: false });
    }
    const endings = lineEndingFact(doc.eol, doc.rows);
    items.push({
      id: 'encoding',
      text: endings === null ? doc.encoding.label : `${doc.encoding.label} · ${endings.label}`,
      title: endings === null ? doc.encoding.title : `${doc.encoding.title}. ${endings.title}`,
      end: false,
    });
  }
  if (input.indexing) {
    items.push({ id: 'progress', text: 'Indexing…', title: 'Reading the folders you declared; Marxy writes nothing to them', end: false });
  }
  items.push({ id: 'theme', text: input.theme, title: 'The theme in force', end: true });
  items.push({ id: 'size', text: `${input.textSize} px`, title: 'Text size in pixels', end: true });
  return items;
}

/** What each button is called to a screen reader: its value, then what activating it does. The plain items are read as their text. */
export const BUTTON_LABELS: Readonly<Partial<Record<StatusItemId, (text: string) => string>>> = {
  where: (text) => `${text.startsWith('Ln ') ? 'Position' : 'Section'}: ${text} — open the outline`,
  theme: (text) => `Theme: ${text} — choose a theme`,
};

/**
 * Whether the item is a button now: only where something is behind it. A tab is behind it when it is registered and the
 * inspector can be shown (it cannot over Source in a narrow window, `Workspace.inspectorHidden`); the palette when one is mounted.
 */
export function isButton(id: StatusItemId, tabs: ReadonlySet<string>, inspectorShut: boolean, hasPalette: boolean): boolean {
  const opens = OPENS[id];
  if (opens === undefined) return false;
  if ('tab' in opens) return tabs.has(opens.tab) && !inspectorShut;
  return hasPalette;
}

