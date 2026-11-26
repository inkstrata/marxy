// The Line's grammar (`R.line`): one field, and the first character picks the scope.
// Pure: the table of scopes, what a typed value asks for, and what each scope's foot says. No DOM.
import type { PanelId } from '../left/types.ts';

export type ScopeId = 'go' | 'cmd' | 'outline' | 'goto' | 'find' | 'grep' | 'filter' | 'tx' | 'lens' | 'pair' | 'as' | 'help';

export interface Scope {
  readonly id: ScopeId;
  /** The first character that picks it; '' for Go. */
  readonly mark: string;
  /** The word the field shows before the query. */
  readonly label: string;
  /** What it does, in the help scope and the empty Line's "Or type" rows. */
  readonly does: string;
}

export const SCOPES: readonly Scope[] = [
  { id: 'cmd', mark: '>', label: 'Commands', does: 'Run a command' },
  { id: 'outline', mark: '@', label: 'In this document', does: 'Go to a part of this document' },
  { id: 'goto', mark: ':', label: 'Line', does: 'Go to a line, or a range such as 40-52' },
  { id: 'find', mark: '/', label: 'Find', does: 'Find in this document' },
  { id: 'grep', mark: '#', label: 'Search the workspace', does: 'Search the text of every file' },
  { id: 'filter', mark: '=', label: 'Filter rows', does: 'Filter the rows of a table, records or a log' },
  { id: 'tx', mark: '!', label: 'Change the text', does: 'Change the text: transforms, staged as a patch' },
  { id: 'lens', mark: '%', label: 'Lens', does: 'Show only the parts that hold something' },
  { id: 'pair', mark: '~', label: 'Compare this file with', does: 'Compare this file with another, or an earlier copy' },
  { id: 'as', mark: '&', label: 'Read this as', does: 'Read this file another way, Bytes last' },
  { id: 'help', mark: '?', label: 'Help', does: 'What the first character means' },
];

export const GO: Scope = { id: 'go', mark: '', label: 'Go', does: 'Go to a file, a heading, a command, or path:line' };

const BY_MARK = new Map(SCOPES.map((s) => [s.mark, s]));

export function scopeById(id: ScopeId): Scope {
  return id === 'go' ? GO : SCOPES.find((s) => s.id === id)!;
}

/** The scope a typed value is in, and the query after its mark (trimmed). Leading spaces never pick a scope. */
export function scopeOf(value: string): { readonly scope: Scope; readonly q: string } {
  const scope = BY_MARK.get(value.charAt(0));
  return scope ? { scope, q: value.slice(1).trim() } : { scope: GO, q: value.trim() };
}

/** Tab in the Line keeps what it found in the panel that scope belongs to (KEEP_IN). */
export const KEEP_IN: Readonly<Partial<Record<ScopeId, PanelId>>> = {
  go: 'places',
  grep: 'search',
  find: 'search',
  outline: 'outline',
  tx: 'transforms',
  as: 'metadata',
  lens: 'metadata',
};

export const PANEL_NAMES: Readonly<Record<PanelId, string>> = {
  places: 'Places',
  metadata: 'Metadata',
  outline: 'Outline',
  links: 'Links',
  search: 'Search',
  transforms: 'Transforms',
  export: 'Export',
  versions: 'Versions',
};

/** The foot's hints for a scope, as [key spec, words]; Tab and Esc are added by the view. */
export function footHints(scope: ScopeId): readonly (readonly [string, string])[] {
  switch (scope) {
    case 'go':
      return [['Enter', 'open'], ['Mod+Enter', 'beside'], ['Mod+.', 'pin']];
    case 'cmd':
      return [['Enter', 'run']];
    case 'find':
      return [['Enter', 'go there'], ['Alt+Enter', 'show only what matches']];
    case 'grep':
      return [['Enter', 'open at the line'], ['Mod+Enter', 'beside']];
    case 'tx':
      return [['Enter', 'stage the change; nothing is written']];
    case 'filter':
      return [['Enter', 'keep']];
    case 'pair':
      return [['Enter', 'compare beside']];
    default:
      return [['Enter', 'choose']];
  }
}

export const PLACEHOLDER = 'Go to a file or heading.   > command   @ here   / find   # everywhere   : line   ? more';
