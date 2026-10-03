// What the palette's `>` mode lists, how a chord is spelled, and which command a key press runs.
// Pure: no DOM, so Node tests cover it (A-12).
import type { AppContext, Command } from '../commands/registry.ts';
import { fuzzyScore } from './search.ts';

const GROUP_ORDER: Readonly<Record<Command['group'], number>> = {
  document: 0,
  view: 1,
  app: 2,
  selection: 3,
};

/** The commands that apply now, filtered by `query` on the title, in group then title order. */
export function paletteCommands(
  all: readonly Command[],
  ctx: AppContext,
  query: string,
): readonly Command[] {
  const needle = query.trim().toLowerCase();
  const kept = all.filter(
    (c) => c.when(ctx) && (needle === '' || fuzzyScore(c.title.toLowerCase(), needle) > 0),
  );
  return kept.slice().sort((a, b) => {
    const g = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
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
