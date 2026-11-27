// The proposals: ways of working the app offers to try, each switched in Settings › Proposals and kept in
// config.toml as one inline table, `proposals = { glance = true, minimap = false }`. A proposal the file does not name has
// its default; Glance tabs alone start off, since it changes what a click does.

export const PROPOSAL_IDS = [
  'minimap',
  'glance',
  'pairs',
  'drag',
  'inspector',
  'paging',
  'notes_in_place',
  'sets',
  'compare_files',
  'table_aids',
  'log_zone',
] as const;

export type ProposalId = (typeof PROPOSAL_IDS)[number];
export type Proposals = Readonly<Record<ProposalId, boolean>>;

export interface Proposal {
  readonly id: ProposalId;
  readonly name: string;
  readonly description: string;
  readonly default: boolean;
}

export const PROPOSALS: readonly Proposal[] = [
  { id: 'minimap', name: 'Shape as the scrollbar', default: true, description: 'The page in miniature down each pane’s right edge: headings, blocks, and where you are. Click or drag it to go there.' },
  { id: 'glance', name: 'Glance tabs', default: false, description: 'A single click in the Library or Find shows a file in one italic tab that the next click replaces. A double click, scrolling it or editing it keeps it.' },
  { id: 'pairs', name: 'Pairs', default: true, description: 'A tab remembers what you had open beside it, and brings it back into the other pane when you return to it.' },
  { id: 'drag', name: 'Drag a tab', default: true, description: 'Along the row to reorder, or onto the other pane to move it there.' },
  { id: 'inspector', name: 'What a character is', default: true, description: 'Hold Alt over any character: its code point, its bytes and its byte offset in the file.' },
  { id: 'paging', name: 'Turn the page', default: true, description: 'Space moves a screen less two lines, and the two lines you carry over are marked for a moment, so the eye finds its place.' },
  { id: 'notes_in_place', name: 'Notes where you read', default: true, description: 'A note number opens the note under its line instead of sending you to the end.' },
  { id: 'sets', name: 'Sets', default: true, description: 'Save the open tabs, and which side each is on, as a named set; open it again from the Library.' },
  { id: 'compare_files', name: 'Compare two files', default: true, description: 'Compare this file with any other, on request, as a patch beside it.' },
  { id: 'table_aids', name: 'Table aids', default: true, description: 'A long table’s header stays in view; the row under the pointer is traced.' },
  { id: 'log_zone', name: 'Log times in your zone', default: true, description: 'A log’s times can be shown in your time zone when you ask; Source keeps the file’s own.' },
];

export const PROPOSAL_DEFAULTS: Proposals = Object.fromEntries(PROPOSALS.map((p) => [p.id, p.default])) as Record<ProposalId, boolean>;

const isId = (k: string): k is ProposalId => (PROPOSAL_IDS as readonly string[]).includes(k);

/** The proposals a `proposals` value names, each a boolean; anything else warns and is left to its default. */
export function parseProposals(raw: unknown, warnings: string[]): { readonly proposals: Proposals; readonly named: Partial<Record<ProposalId, boolean>> } {
  const named: Partial<Record<ProposalId, boolean>> = {};
  if (raw === undefined) return { proposals: PROPOSAL_DEFAULTS, named };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warnings.push('proposals must be a table of name = true or false; ignored');
    return { proposals: PROPOSAL_DEFAULTS, named };
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isId(k)) warnings.push(`proposals.${k} is not a proposal; ignored`);
    else if (typeof v !== 'boolean') warnings.push(`proposals.${k} must be true or false; using its default`);
    else named[k] = v;
  }
  return { proposals: { ...PROPOSAL_DEFAULTS, ...named }, named };
}

/**
 * The `proposals` value after switching `id` to `on`: only the proposals that differ from their defaults are named, in the
 * registry's order. Null when none differ, which is the key's absence.
 */
export function proposalsAfter(named: Partial<Record<ProposalId, boolean>>, id: ProposalId, on: boolean): string | null {
  const next: Partial<Record<ProposalId, boolean>> = { ...named, [id]: on };
  const parts = PROPOSALS.filter((p) => next[p.id] !== undefined && next[p.id] !== p.default).map((p) => `${p.id} = ${String(next[p.id])}`);
  return parts.length === 0 ? null : `{ ${parts.join(', ')} }`;
}
