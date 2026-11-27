// Remember the layout, and restore it at launch.
//
// layout.json (`{ version, columns: [{ path, mode }], ratio, focused, tabs }`) is written beside positions.json
// as the panes change, and read again here. Restoring never gets in the way of reading: the first pane's
// document is opened first, through the launch's own first-text path, at the place positions.json keeps for
// it; the second pane is opened after that. A column whose file is gone or cannot be read is left out and
// the reader is told. A window too narrow for two columns, or a layout with one column left, shows the
// focused column alone and leaves layout.json as it was until the reader changes the layout.
//
// Positions are per path, and with one file in both panes only one pane writes its place: `writerFor`.

import { basename } from '@marxy/core/src/index-model/paths.ts';
import { LAYOUT_FILE_VERSION, layoutTabs, type LayoutColumn, type LayoutEnvelope } from '@marxy/core/src/layout/index.ts';
import type { AppShell } from '../app-types.ts';
import { isUntitled } from '../document/untitled.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { layoutLeftOut } from '../notices/config-copy.ts';
import { notify } from '../notices/index.ts';
import { canShowTwoColumns } from '../pane/fit.ts';
import { clampToMain } from '../pane/divider.ts';
import { keepTwoColumns } from '../pane/narrow.ts';
import type { AppPanes } from '../pane/index.ts';
import type { ReadingPersistence } from '../position/reading-persistence.ts';
import { pushAll } from '@marxy/core/src/util/spread.ts';

type AppPane = AppPanes['panes'][number];

/**
 * The pane that writes `path`'s place to positions.json: the focused pane if it shows the path, else the
 * lowest slot that does, else none. A second view of a file already shown is never written.
 */
export function writerFor(panes: Pick<AppPanes, 'panes' | 'focused'>, path: string): AppPane | null {
  if (panes.focused.path() === path) return panes.focused;
  return panes.panes.find((pane) => pane.path() === path) ?? null;
}

/**
 * The window's row of tabs as the layout keeps it: its files in order, put back at launch. The frame
 * gives it once mounted (frame/row-layout.ts); without one, the row is what the panes show.
 */
export interface LayoutRow {
  /** The row's files, in order: no scratch, bundled page or archive entry. */
  paths(): readonly string[];
  /** Puts `paths` in the row in this order, ahead of any tab not among them. */
  restore(paths: readonly string[]): void;
  /** `cb` hears a change of the row (a tab opened, closed or moved). Returns the off switch. */
  onChange(cb: () => void): () => void;
}

/** The layout the panes are in now: the columns that show a document, the ratio, the focused column and the row. */
function layoutOf(panes: Pick<AppPanes, 'panes' | 'focused' | 'ratio'>, row: LayoutRow | null): LayoutEnvelope {
  const columns: LayoutColumn[] = [];
  let focused = 0;
  for (const pane of panes.panes) {
    const path = pane.path();
    // A scratch document is never kept: layout.json names files, and a scratch is not one; nor is an archive's entry.
    if (path === null || isUntitled(path) || isArchiveEntry(path)) continue;
    if (pane === panes.focused) focused = columns.length;
    columns.push({ path, mode: pane.view.mode });
  }
  return { version: LAYOUT_FILE_VERSION, columns, ratio: panes.ratio, focused, tabs: layoutTabs(row?.paths(), columns) };
}

/**
 * The reader restores what layout.json names, and only that: each column and tab is told to the shell as opened before
 * its probe, so the shell's scope after a restart is what the reader is shown again, never everything in history.
 */
async function restored(shell: Pick<AppShell, 'markOpened'>, path: string): Promise<void> {
  await shell.markOpened?.(path).catch(() => undefined);
}

/** The saved row put back: the tabs no pane shows are probed after first text, and one gone from disk is left out quietly. */
async function restoreRow(shell: Pick<AppShell, 'readHead' | 'markOpened'>, row: LayoutRow | null, saved: LayoutEnvelope): Promise<void> {
  if (!row || saved.tabs.length === 0) return;
  const open = new Set(row.paths());
  const alive = await Promise.all(
    saved.tabs.map(async (path) => {
      if (open.has(path)) return true;
      try {
        await restored(shell, path);
        await shell.readHead(path, 1);
        return true;
      } catch {
        return false;
      }
    }),
  );
  row.restore(saved.tabs.filter((_, i) => alive[i]));
}

export interface LayoutKeeper {
  /**
   * Starts keeping the layout. `armed` writes what the panes show now; unarmed (a layout that could not be
   * restored whole) waits for the reader to change the layout first, so the file is untouched until then.
   */
  start(armed: boolean): void;
  /** While held, a change of layout is not written (a pane given back by a narrow window); released, it is caught up. */
  hold(on: boolean): void;
  stop(): void;
}

/** Notes the layout on every pane change (open, close, focus, ratio), each pane's mode change and each change of the row. */
export function createLayoutKeeper(panes: AppPanes, persistence: ReadingPersistence, rowOf: () => LayoutRow | null = () => null): LayoutKeeper {
  const offs: (() => void)[] = [];
  let stopped = false;
  let held = false;
  let catchUp: () => void = () => {};
  const hold = (on: boolean): void => {
    held = on;
    if (!on) catchUp();
  };
  return {
    hold,
    start(armed) {
      if (stopped) return;
      const row = rowOf();
      const baseline = JSON.stringify(layoutOf(panes, row));
      let on = armed;
      let last = '';
      const note = (): void => {
        if (held) return;
        const now = layoutOf(panes, row);
        const json = JSON.stringify(now);
        if (!on) {
          if (json === baseline) return;
          on = true;
        }
        if (json === last || now.columns.length === 0) return;
        last = json;
        persistence.noteLayout(now);
      };
      catchUp = note;
      offs.push(panes.onChange(note));
      if (row) offs.push(row.onChange(note));
      // A pane's section carries its own mode; there is no other event for a mode change.
      const main = panes.panes[0]?.host.parentElement;
      if (main) {
        // The window narrowed below two columns gives a pane back, and the split returns with the room.
        offs.push(keepTwoColumns(panes, main, { hold }));
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
async function survey(shell: Pick<AppShell, 'readHead' | 'markOpened'>, columns: readonly LayoutColumn[]): Promise<Survey> {
  const alive: { column: LayoutColumn; index: number }[] = [];
  const notices: string[] = [];
  for (const [index, column] of columns.entries()) {
    try {
      await restored(shell, column.path);
      await shell.readHead(column.path, 1);
      alive.push({ column, index });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const name = basename(column.path);
      notices.push(
        layoutLeftOut(name, code === undefined || code === 'not-found'),
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
  /** The window's row, to put the saved one back into. */
  readonly row?: () => LayoutRow | null;
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
    for (const text of notices) notify({ kind: 'refused', text });
  };
  const putRow = (saved: LayoutEnvelope): Promise<void> => restoreRow(shell, d.row?.() ?? null, saved);

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
        // An argument the other column already shows stays in its own column, so the focused one keeps its document.
        const argAt = file === (saved.focused === 0 ? right : left).path ? 1 - saved.focused : saved.focused;
        if (argAt === 0) {
          await panes.openIn('other', right.path);
          await inMode(panes.panes[1], right);
        } else {
          // The argument goes in the right pane, the left keeps its document.
          await panes.openIn('other', file);
          await panes.openIn(0, left.path);
          await inMode(panes.panes[0], left);
        }
        panes.setRatio(clampToMain(main, saved.ratio));
        panes.focus(panes.panes[argAt] ?? panes.panes[0]!);
      }
      await putRow(saved);
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
  // Only the column that boots first is looked at before first text; the other is the rest's (never waited for).
  const narrow = saved.columns.length === 2 && !fits();
  const order = saved.columns.map((_, i) => i);
  if (narrow) order.sort((a, b) => Number(b === saved.focused) - Number(a === saved.focused));
  const flags = args.filter((a) => a.startsWith('-'));
  const notices: string[] = [];
  let at = -1;
  for (const [pos, index] of order.entries()) {
    const probed = await survey(shell, [saved.columns[index]!]);
    if (probed.alive.length === 1) {
      at = pos;
      break;
    }
    pushAll(notices, probed.notices);
  }
  // None can be read: the normal empty state, and what happened.
  if (at < 0) {
    await d.boot(args);
    return {
      rest: putRow(saved).then(() => {
        tell(notices);
        keeper.start(false);
      }),
    };
  }
  const firstIndex = order[at]!;
  const first = saved.columns[firstIndex]!;
  await d.boot([...flags, first.path]);
  const rest = (async () => {
    await inMode(panes.panes[0], first);
    const others = order.slice(at + 1).map((i) => saved.columns[i]!);
    const more = await survey(shell, others);
    pushAll(notices, more.notices);
    if (!narrow && firstIndex === 0 && more.alive.length === 1) {
      const right = more.alive[0]!.column;
      await panes.openIn('other', right.path);
      await inMode(panes.panes[1], right);
      panes.setRatio(clampToMain(main, saved.ratio));
      panes.focus(panes.panes[saved.focused] ?? panes.panes[0]!);
    }
    await putRow(saved);
    tell(notices);
    keeper.start(notices.length === 0 && !narrow);
  })();
  return { rest };
}
