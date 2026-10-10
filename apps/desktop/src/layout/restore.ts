// Remember the layout, and restore it at launch (D-12; ADR-0057; 07 §4.6, §6.5).
//
// layout.json (`{ version, columns: [{ path, mode }], ratio, focused }`) is written beside positions.json
// as the panes change, and read again here. Restoring never gets in the way of reading: the first pane's
// document is opened first, through the launch's own first-text path, at the place positions.json keeps for
// it; the second pane is opened after that. A column whose file is gone or cannot be read is left out and
// the reader is told. A window too narrow for two columns, or a layout with one column left, shows the
// focused column alone and leaves layout.json as it was until the reader changes the layout.
//
// Positions are per path, and with one file in both panes only one pane writes its place: `writerFor`.

import { basename } from '@marxy/core/src/index-model/paths.ts';
import { LAYOUT_FILE_VERSION, type LayoutColumn, type LayoutEnvelope } from '@marxy/core/src/layout/index.ts';
import type { AppShell } from '../app-types.ts';
import { notify } from '../notices/index.ts';
import { canShowTwoColumns } from '../pane/fit.ts';
import { clampToMain } from '../pane/divider.ts';
import type { AppPanes } from '../pane/index.ts';
import type { ReadingPersistence } from '../position/reading-persistence.ts';

type AppPane = AppPanes['panes'][number];

/**
 * The pane that writes `path`'s place to positions.json: the focused pane if it shows the path, else the
 * lowest slot that does, else none. A second view of a file already shown is never written.
 */
export function writerFor(panes: Pick<AppPanes, 'panes' | 'focused'>, path: string): AppPane | null {
  if (panes.focused.path() === path) return panes.focused;
  return panes.panes.find((pane) => pane.path() === path) ?? null;
}

/** The layout the panes are in now: the columns that show a document, the ratio and the focused column. */
function layoutOf(panes: Pick<AppPanes, 'panes' | 'focused' | 'ratio'>): LayoutEnvelope {
  const columns: LayoutColumn[] = [];
  let focused = 0;
  for (const pane of panes.panes) {
    const path = pane.path();
    if (path === null) continue;
    if (pane === panes.focused) focused = columns.length;
    columns.push({ path, mode: pane.view.mode });
  }
  return { version: LAYOUT_FILE_VERSION, columns, ratio: panes.ratio, focused };
}

export interface LayoutKeeper {
  /**
   * Starts keeping the layout. `armed` writes what the panes show now; unarmed (a layout that could not be
   * restored whole) waits for the reader to change the layout first, so the file is untouched until then.
   */
  start(armed: boolean): void;
  stop(): void;
}

/** Notes the layout on every pane change (open, close, focus, ratio) and each pane's mode change. */
export function createLayoutKeeper(panes: AppPanes, persistence: ReadingPersistence): LayoutKeeper {
  const offs: (() => void)[] = [];
  let stopped = false;
  return {
    start(armed) {
      if (stopped) return;
      const baseline = JSON.stringify(layoutOf(panes));
      let on = armed;
      let last = '';
      const note = (): void => {
        const now = layoutOf(panes);
        const json = JSON.stringify(now);
        if (!on) {
          if (json === baseline) return;
          on = true;
        }
        if (json === last || now.columns.length === 0) return;
        last = json;
        persistence.noteLayout(now);
      };
      offs.push(panes.onChange(note));
      // A pane's section carries its own mode (D-11); there is no other event for a mode change.
      const main = panes.panes[0]?.host.parentElement;
      if (main) {
        const observer = new MutationObserver(note);
        observer.observe(main, { subtree: true, attributes: true, attributeFilter: ['data-marxy-mode'] });
        offs.push(() => observer.disconnect());
      }
      if (armed) note();
    },
    stop() {
      stopped = true;
      for (const off of offs.splice(0)) off();
    },
  };
}

interface Survey {
  readonly alive: readonly { readonly column: LayoutColumn; readonly index: number }[];
  readonly notices: readonly string[];
}

/** Which saved columns can still be read, by their first byte (a file's whole read is the pane's, later). */
async function survey(shell: Pick<AppShell, 'readHead'>, columns: readonly LayoutColumn[]): Promise<Survey> {
  const alive: { column: LayoutColumn; index: number }[] = [];
  const notices: string[] = [];
  for (const [index, column] of columns.entries()) {
    try {
      await shell.readHead(column.path, 1);
      alive.push({ column, index });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const name = basename(column.path);
      notices.push(
        code === undefined || code === 'not-found'
          ? `${name} is no longer there, so it was left out of the layout.`
          : `${name} could not be read, so it was left out of the layout.`,
      );
    }
  }
  return { alive, notices };
}

export interface LaunchDeps {
  readonly shell: AppShell;
  readonly panes: AppPanes;
  readonly persistence: ReadingPersistence;
  readonly keeper: LayoutKeeper;
  /** The launch's first open: `OpenPath.boot` (first text, the stored place, the frontispiece with no document). */
  boot(argv: readonly string[]): Promise<void>;
  readonly argv: readonly string[];
}

/** `column`'s mode in `pane`, when it is not that already. */
async function inMode(pane: AppPane | undefined, column: LayoutColumn): Promise<void> {
  if (pane && pane.path() !== null && pane.view.mode !== column.mode) await pane.view.toggleMode();
}

/**
 * The launch. Resolves once the first pane's document is on screen (first text has been marked); the
 * promise it resolves to settles when the rest of the layout is back and the layout is being kept.
 *
 * With no file argument the saved layout names the first document, which then boots as an argument would.
 * With one, the argument boots first and the layout is put back around it: the argument goes into the pane
 * that was focused, the other pane keeps its document (a parked reference survives).
 */
export async function launch(d: LaunchDeps): Promise<{ readonly rest: Promise<void> }> {
  const { shell, panes, persistence, keeper } = d;
  const args = d.argv.length > 0 ? [...d.argv] : await shell.args();
  const file = args.find((a) => !a.startsWith('-'));
  const main = panes.panes[0]!.host.parentElement!;
  const fits = (): boolean => canShowTwoColumns(main);
  const tell = (notices: readonly string[]): void => {
    for (const text of notices) notify({ kind: 'info', text });
  };

  if (file) {
    await d.boot(args);
    const rest = (async () => {
      const saved = await persistence.loadLayout();
      if (!saved || saved.columns.length === 0) return keeper.start(true);
      const { alive, notices } = await survey(shell, saved.columns);
      const narrow = saved.columns.length === 2 && !fits();
      const whole = alive.length === 2 && !narrow;
      if (whole) {
        const [left, right] = alive.map((a) => a.column) as [LayoutColumn, LayoutColumn];
        if (saved.focused === 0) {
          await panes.openIn('other', right.path);
          await inMode(panes.panes[1], right);
        } else {
          // The argument goes in the focused (right) pane, the left keeps its document.
          await panes.openIn('other', file);
          await panes.openIn(0, left.path);
          await inMode(panes.panes[0], left);
        }
        panes.setRatio(clampToMain(main, saved.ratio));
        panes.focus(panes.panes[saved.focused] ?? panes.panes[0]!);
      }
      tell(notices);
      keeper.start(notices.length === 0 && !narrow);
    })();
    return { rest };
  }

  const saved = await persistence.loadLayout();
  if (!saved || saved.columns.length === 0) {
    await d.boot(args);
    return { rest: Promise.resolve().then(() => keeper.start(true)) };
  }
  const { alive, notices } = await survey(shell, saved.columns);
  const narrow = saved.columns.length === 2 && !fits();
  const whole = alive.length === 2 && !narrow;
  // Both gone: the normal empty state, and what happened.
  if (alive.length === 0) {
    await d.boot(args);
    return {
      rest: Promise.resolve().then(() => {
        tell(notices);
        keeper.start(false);
      }),
    };
  }
  const first = whole ? alive[0]! : (alive.find((a) => a.index === saved.focused) ?? alive[0]!);
  await d.boot([...args.filter((a) => a.startsWith('-')), first.column.path]);
  const rest = (async () => {
    await inMode(panes.panes[0], first.column);
    if (whole) {
      const right = alive[1]!.column;
      await panes.openIn('other', right.path);
      await inMode(panes.panes[1], right);
      panes.setRatio(clampToMain(main, saved.ratio));
      panes.focus(panes.panes[saved.focused] ?? panes.panes[0]!);
    }
    tell(notices);
    keeper.start(notices.length === 0 && !narrow);
  })();
  return { rest };
}
