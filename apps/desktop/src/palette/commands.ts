// What the palette's `>` mode lists, how a chord is spelled, and which command a key press runs.
// Pure: no DOM, so Node tests cover it (A-12).
import type { AppContext, Command } from '../commands/registry.ts';
import { fuzzyScore } from './search.ts';

/** The palette's command groups (U-04), in the order the `>` list shows them (mock-v2 `04-palette.md`). */
export const PALETTE_GROUPS = ['Navigate', 'File', 'View', 'Copy', 'Source', 'Extract', 'Transform'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** The operations that rewrite text: the rest of `op.*` is Copy or Extract by name. */
const TRANSFORM_OPS = new Set([
  'align-table-pipes', 'bullets-from-glyphs', 'dedupe-lines', 'demote-heading', 'format-json', 'format-yaml',
  'list-to-bullets', 'list-to-numbers', 'move-section-down', 'move-section-up', 'promote-heading', 'renumber-list', 'sort-list-items', 'toggle-task',
  'unwrap-markdown-fence',
]);

/** The group a command is listed under. Pure, by id, so a new command lands in View until it is named here. */
export function paletteGroupOf(cmd: Pick<Command, 'id'>): PaletteGroup {
  const id = cmd.id;
  if (id.startsWith('transform.') || id.startsWith('outline.move-section-')) return 'Transform';
  if (id.startsWith('op.extract-')) return 'Extract';
  if (id.startsWith('op.copy-') || id.startsWith('selection.copy-') || id.startsWith('copy-as.') || id.startsWith('paste.') || id === 'source.paste-plain' || id === 'source.table-copy-csv') return 'Copy';
  if (id.startsWith('op.')) return TRANSFORM_OPS.has(id.slice(3)) ? 'Transform' : 'View';
  if (id.startsWith('source.') || id === 'edit.block' || id === 'view.jump-to-source' || id === 'view.toggle-line-numbers') return 'Source';
  if (id.startsWith('nav.') || id.startsWith('tab.') || id.startsWith('selection.') || id.startsWith('view.focus-') || id === 'view.outline' || id === 'view.find' || id === 'library.open') return 'Navigate';
  if (id.startsWith('document.') || id.startsWith('trust.') || id.startsWith('collection.') || id.startsWith('kind.') || id.startsWith('compare.') || id.startsWith('palette.drill.')) return 'File';
  return 'View';
}

/**
 * Families of commands that differ by one word (U-04): thirteen "Show this file as <kind>" rows would fill the
 * first screen, so the list holds one row that opens the family. Typing the family's phrase lists its members.
 */
const DRILLS: readonly { readonly id: string; readonly idPrefix: string; readonly phrase: string }[] = [
  { id: 'palette.drill.show-as', idPrefix: 'kind.show-as.', phrase: 'Show this file as' },
  { id: 'palette.drill.folder-as', idPrefix: 'kind.folder.', phrase: 'Always open this folder as' },
];

/** A word of a family's phrase, or the start of one (`sho`, `as`): typing it names the family, not a member. */
function isPhraseWord(token: string, phrase: string): boolean {
  return phrase.toLowerCase().split(' ').some((word) => word.startsWith(token));
}

/** What the reader typed beyond the family's own words: `log` in `>show as log`. */
function remainderOf(needle: string, phrase: string): string {
  return needle.split(/\s+/).filter((t) => t !== '' && !isPhraseWord(t, phrase)).join(' ');
}

/** The text the query becomes when a drill row is chosen (the typed remainder kept), or undefined for any other command. */
export function drillText(id: string, query = ''): string | undefined {
  const drill = DRILLS.find((d) => d.id === id);
  if (drill === undefined) return undefined;
  const rest = remainderOf(query.trim().replace(/^>/, '').toLowerCase(), drill.phrase);
  return `${drill.phrase} ${rest === '' ? '' : `${rest}`}`;
}

/** A family collapses only while the query names no member: `>show` collapses, `>log` and `>show as log` list. */
function collapseFamilies(kept: readonly Command[], needle: string): readonly Command[] {
  let out = kept;
  for (const drill of DRILLS) {
    // The phrase typed in full (the state a drill row leaves) lists the members too.
    if (remainderOf(needle, drill.phrase) !== '' || needle.includes(drill.phrase.toLowerCase())) continue;
    const members = out.filter((c) => c.id.startsWith(drill.idPrefix));
    if (members.length < 2) continue;
    const row: Command = {
      id: drill.id,
      title: `${drill.phrase}\u2026`,
      group: members[0]!.group,
      when: () => true,
      run: () => Promise.resolve(),
    };
    out = [...out.filter((c) => !c.id.startsWith(drill.idPrefix)), row];
  }
  return out;
}

/** The commands that apply now, filtered by `query` on the title, in palette group then title order. */
export function paletteCommands(
  all: readonly Command[],
  ctx: AppContext,
  query: string,
): readonly Command[] {
  const needle = query.trim().toLowerCase();
  const kept = all.filter(
    (c) => c.listed !== false && c.when(ctx) && (needle === '' || fuzzyScore(c.title.toLowerCase(), needle) > 0),
  );
  return collapseFamilies(kept, needle).slice().sort((a, b) => {
    const g = PALETTE_GROUPS.indexOf(paletteGroupOf(a)) - PALETTE_GROUPS.indexOf(paletteGroupOf(b));
    if (g !== 0) return g;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
}

const MAC_KEYS: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '↩',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
};

/** `Mod+Shift+S` as `⇧⌘S` on a Mac and `Ctrl+Shift+S` elsewhere. */
export function keyLabel(spec: string, mac: boolean): string {
  const parts = spec.split('+');
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  const shown = key.length === 1 ? key.toUpperCase() : key;
  if (mac) {
    return (
      (mods.has('Ctrl') ? '⌃' : '') +
      (mods.has('Alt') ? '⌥' : '') +
      (mods.has('Shift') ? '⇧' : '') +
      (mods.has('Mod') ? '⌘' : '') +
      (MAC_KEYS[key] ?? shown)
    );
  }
  const out: string[] = [];
  if (mods.has('Mod') || mods.has('Ctrl')) out.push('Ctrl');
  if (mods.has('Alt')) out.push('Alt');
  if (mods.has('Shift')) out.push('Shift');
  out.push(shown);
  return out.join('+');
}

export interface ChordEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function chordMatches(event: ChordEvent, spec: string, mac: boolean): boolean {
  const parts = spec.split('+');
  const key = parts[parts.length - 1]!;
  const needMod = parts.includes('Mod');
  const needShift = parts.includes('Shift');
  const needAlt = parts.includes('Alt');
  const mod = mac ? event.metaKey : event.ctrlKey;
  // A literal Ctrl (a Mac's Control key, as in Ctrl+[ for back) is checked on its own; off a Mac
  // it is what Mod already means, so that spelling never matches there.
  if (parts.includes('Ctrl') && !(mac && event.ctrlKey && !event.metaKey)) return false;
  if (needMod !== mod) return false;
  if (!needMod && mod) return false;
  if (needShift !== event.shiftKey) return false;
  if (needAlt !== event.altKey) return false;
  // A letter arrives as `z` without Shift and `Z` with it: `Mod+Z` spells the key, not its case.
  return key.length === 1 ? event.key.toLowerCase() === key.toLowerCase() : event.key === key;
}

/** The command a key press runs: first whose `key` or `keys` match, that may run here, and whose `when` holds. */
export function commandForKey(
  event: ChordEvent,
  cmds: readonly Command[],
  ctx: AppContext,
  opts: { inEditable: boolean; mac?: boolean },
): Command | undefined {
  const mac = opts.mac ?? (typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC'));
  for (const cmd of cmds) {
    if (opts.inEditable && cmd.global !== true) continue;
    const specs = cmd.key === undefined ? (cmd.keys ?? []) : [cmd.key, ...(cmd.keys ?? [])];
    if (!specs.some((spec) => chordMatches(event, spec, mac))) continue;
    if (!cmd.when(ctx)) continue;
    return cmd;
  }
  return undefined;
}
