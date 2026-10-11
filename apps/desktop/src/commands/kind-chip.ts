// `kind.chip` (K-07): the door the kind chip in the toolbar presses. It opens a menu that says why the focused pane's file
// is the kind it is (the `Reason`s `detectFileKind` returned at open, the decisive one first; nothing is recomputed), then
// the reader's choices: *Show as* each kind, *Show as detected* and *Always open this folder as…* (a second list). A
// choice runs K-04's command (kind.ts), which writes `kinds.json` or `config.toml` only and then reopens the file so the
// kind takes effect now. The menu is the verb menu's (J-04's `rows`), so it has W-04's chrome and its keys.
import { KINDS } from '@marxy/core/src/contracts/kinds.ts';
import type { Reason } from '@marxy/core/src/kind/detect.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

/** The tiers of ADR-0060 item 3, as the menu names them. */
const TIER_NAMES: Readonly<Record<number, string>> = {
  1: 'your choice',
  2: 'file name',
  3: 'file format',
  4: 'shape',
  5: 'byline',
  6: 'weak shape',
  7: 'default',
};

/** The reasons as note rows: the decisive one first, the rest in the order they were kept. Pure. */
export function reasonRows(reasons: readonly Reason[]): VerbMenuRow[] {
  const ordered = [...reasons.filter((r) => r.decisive), ...reasons.filter((r) => !r.decisive)];
  return ordered.map((r, i) => ({
    command: null,
    note: true,
    key: `kind.reason.${i}`,
    title: r.decisive ? `Because ${r.signal}` : r.signal,
    detail: `${r.decisive ? '' : `${r.kind} · `}${TIER_NAMES[r.tier] ?? `tier ${r.tier}`} · ${r.at}`,
  }));
}

function registry(): ReadonlyMap<string, Command> {
  return new Map(((appHandle()?.commands() ?? []) as readonly Command[]).map((c) => [c.id, c] as const));
}

/** The folder choices: one row per kind, each K-04's command. */
function folderRows(): VerbMenuRow[] {
  const commands = registry();
  return KINDS.flatMap((kind) => {
    const command = commands.get(`kind.folder.${kind}`);
    return command ? [{ command, title: `Always open this folder as ${kind}` }] : [];
  });
}

/** Where the menu opens: under the chip when it is drawn, else the middle of the window. */
function anchorFor(): MenuAnchor {
  // Under the chip when it is in the row, else under *More* where the toolbar folded it.
  const chip = document.querySelector('[data-marxy-toolbar-item="kind"]:not([hidden])') ?? document.querySelector('[data-marxy-toolbar-item="more"]');
  const box = chip?.getBoundingClientRect();
  if (box && box.width > 0) return { x: Math.round(box.left), y: Math.round(box.bottom), top: Math.round(box.top) };
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
}

const hasKind = (): boolean => appHandle()?.panes().focused.content.detected() != null;

export function kindChipCommands(): readonly Command[] {
  return [
    {
      id: 'kind.chip',
      title: 'How this file is read',
      group: 'document',
      when: hasKind,
      async run(ctx: AppContext) {
        const handle = appHandle();
        const detected = handle?.panes().focused.content.detected();
        if (!handle || !detected) return;
        const commands = registry();
        const at = anchorFor();
        const rows: VerbMenuRow[] = reasonRows(detected.reasons);
        for (const kind of KINDS) {
          const command = commands.get(`kind.show-as.${kind}`);
          if (command) rows.push({ command, title: `Show as ${kind}` });
        }
        const detectedCommand = commands.get('kind.show-as.detected');
        if (detectedCommand) rows.push({ command: detectedCommand, title: 'Show as detected' });
        if (folderRows().length > 0) {
          rows.push({
            command: null,
            key: 'kind.folder',
            title: 'Always open this folder as…',
            run: () => void openVerbMenu(at, ctx, { registered: [], allActions: () => {}, rows: folderRows(), label: 'Always open this folder as' }),
          });
        }
        openVerbMenu(at, ctx, { registered: [], allActions: () => {}, rows, label: `Kind: ${detected.kind}` });
      },
    },
  ];
}
