// The tab row's palette commands (W-06): `tab.next`, `tab.previous` and `tab.close`. No keys: ⌘W closes the window and
// ⌃Tab is the author's to rule. A tab row exists only while the window is unfolded and holds two documents or more,
// so each command is available only then; folded, the palette's Recent is the switcher.
//
// The commands act on the row the page has, through the controller `workspace/tabs-view.ts` registers while it is
// mounted and withdraws when the window folds (the same way `app-handle.ts` hands commands the app). They add no way
// into a pane: a tab is shown by `content.open` in a pane, which asks about unsaved edits as any open does.
import type { AppContext, Command } from './registry.ts';

/** What the mounted tab row lets a command do. */
export interface TabsController {
  /** How many tabs the row holds. */
  count(): number;
  /** Shows the tab `delta` places from the active one (wrapping) in the focused pane. */
  step(delta: 1 | -1): Promise<void>;
  /** Closes the active tab; on the document a pane shows it opens the next tab there first. */
  closeActive(): Promise<void>;
}

let mounted: TabsController | null = null;

/** The row mounted now registers itself; the same row withdraws itself (a later row is not withdrawn by an earlier one). */
export function setTabsController(next: TabsController): () => void {
  mounted = next;
  return () => {
    if (mounted === next) mounted = null;
  };
}

const available = (_ctx: AppContext): boolean => (mounted?.count() ?? 0) >= 2;

export function tabCommands(): readonly Command[] {
  return [
    {
      id: 'tab.next',
      title: 'Next tab',
      group: 'view',
      when: available,
      async run() {
        await mounted?.step(1);
      },
    },
    {
      id: 'tab.previous',
      title: 'Previous tab',
      group: 'view',
      when: available,
      async run() {
        await mounted?.step(-1);
      },
    },
    {
      id: 'tab.close',
      title: 'Close tab',
      group: 'view',
      when: available,
      async run() {
        await mounted?.closeActive();
      },
    },
  ];
}
