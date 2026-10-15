// The per-kind tool strip's table (K-07; mock-v2 01-workspace Round 6, 03-content-modes): which tools a kind's strip
// can hold, and which of them are drawn now. A tool names the registry command it runs, or `null` while that command
// is not built; the strip draws a tool only when its command is registered, so a kind fills as the stories that
// register its commands land (K-08 to K-22) and nothing here is a dead button. At most four tools per kind. Pure: no
// DOM; `workspace/kind-chip.ts` draws it.
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { ToolbarGlyph } from './toolbar-icons.ts';
import { MAX_STRIP_TOOLS } from '@marxy/theme/src/config.ts';

export interface StripTool {
  /** Stable name, the one `[strip]` in config.toml uses. */
  readonly id: string;
  /** The words on the button. */
  readonly label: string;
  /** The registry command it runs; `null` until that command exists. */
  readonly command: string | null;
}

const tool = (id: string, label: string, command: string | null = null): StripTool => ({ id, label, command });

const CHANGES = tool('changes', 'Changes', 'compare.since-reload');
const OUTLINE = tool('outline', 'Outline', 'view.outline');

/**
 * Per kind, the mock's tools in its order. Code lists Line numbers (a command that exists) where the mock lists
 * Literate, to stay at four; Literate is not a command anywhere yet.
 */
export const STRIP_TOOLS: Readonly<Record<Kind, readonly StripTool[]>> = {
  article: [tool('focus', 'Focus'), tool('highlight', 'Highlight'), tool('margin-notes', 'Margin notes'), tool('read-aloud', 'Read aloud')],
  report: [tool('paths', 'Paths'), CHANGES, tool('split-by-h2', 'Split by H2')],
  book: [tool('paged', 'Paged'), tool('contents', 'Contents'), tool('justify', 'Justify'), tool('bookmark', 'Bookmark')],
  readme: [OUTLINE, tool('config-table', 'Config table'), tool('open-repo', 'Open repo')],
  docs: [tool('on-this-page', 'On this page', 'inspector.show-outline'), tool('examples-only', 'Examples only'), tool('search-docs', 'Search docs set'), tool('prev-next', 'Prev / next')],
  code: [tool('line-numbers', 'Line numbers', 'view.toggle-line-numbers'), tool('wrap', 'Wrap'), tool('symbols', 'Symbols'), tool('go-to-line', 'Go to line')],
  transcript: [tool('collapse-tools', 'Collapse tools'), tool('only-you', 'Only you'), tool('only-assistant', 'Only assistant')],
  // Table takes the first slot and Chart drops off until it has a story (K-10b, ADR-0071 ruling 3).
  data: [tool('table', 'Table', 'data.table-lens'), tool('column-stats', 'Column stats', 'data.column-stats'), tool('filter', 'Filter'), tool('transpose', 'Transpose')],
  notes: [tool('backlinks', 'Backlinks'), tool('append-clipboard', 'Append clipboard'), tool('daily', 'Daily')],
  changelog: [tool('versions', 'Versions', 'inspector.show-outline'), tool('copy-release-notes', 'Copy release notes', 'changelog.copy-release-notes'), CHANGES],
  log: [tool('filter-by-level', 'Filter by level', 'log.filter-level'), tool('wrap', 'Wrap'), tool('jump-to-first-error', 'Jump to first error', 'log.first-error'), tool('follow-tail', 'Follow tail')],
  terminal: [tool('copy-commands', 'Copy commands', 'terminal.copy-commands'), tool('copy-output', 'Copy output', 'terminal.copy-output'), tool('wrap', 'Wrap')],
  diff: [],
  html: [],
};

/** Every tool by id (a tool shared by several kinds is one entry), for a `[strip]` list that names a tool of another kind. */
export const STRIP_TOOL_BY_ID: ReadonlyMap<string, StripTool> = new Map(
  Object.values(STRIP_TOOLS).flatMap((list) => list.map((t) => [t.id, t] as const)),
);

/**
 * The tools to draw for `kind`: the reader's `[strip]` list for it when one exists (its order), else the kind's row;
 * of those only the tools whose command is registered, never more than four.
 */
export function toolsFor(
  kind: Kind,
  config: { readonly strip: Readonly<Record<string, readonly string[]>> },
  registered: Iterable<string>,
): readonly StripTool[] {
  const have = new Set(registered);
  const chosen = config.strip[kind];
  const row = chosen === undefined ? STRIP_TOOLS[kind] : chosen.flatMap((id) => STRIP_TOOL_BY_ID.get(id) ?? []);
  return row.filter((t) => t.command !== null && have.has(t.command)).slice(0, MAX_STRIP_TOOLS);
}

/**
 * The glyph for a tool, reused from the toolbar's set (U-09: no new artwork). A tool with no entry is drawn as its word
 * alone; the others gain one when their command lands and the toolbar's set has a glyph that says what they do.
 */
export const STRIP_GLYPHS: Readonly<Record<string, ToolbarGlyph>> = {
  changes: 'split',
  outline: 'sidebar',
  'line-numbers': 'source',
};
