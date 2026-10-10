// The divider by keyboard (D-04): the palette's way to do what dragging and double-clicking do. Palette
// only, no keys; each is offered only while two panes are open.
import { DEFAULT_RATIO } from '@marxy/core/src/layout/index.ts';
import { RATIO_STEP, clampToMain } from '../pane/divider.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const twoPanes = (): boolean => (appHandle()?.panes().panes.length ?? 0) === 2;

/** Moves the divider toward (+1) or away from (-1) the focused pane's side, by one step. */
function step(direction: 1 | -1): void {
  const panes = appHandle()?.panes();
  if (!panes || panes.panes.length < 2) return;
  const main = panes.focused.host.parentElement;
  if (!main) return;
  const toward = panes.focused.slot === 0 ? direction : -direction;
  panes.setRatio(clampToMain(main, panes.ratio + toward * RATIO_STEP));
}

export function paneLayoutCommands(): readonly Command[] {
  return [
    {
      id: 'view.reset-split',
      title: 'Even split',
      group: 'view',
      when: twoPanes,
      async run() {
        const panes = appHandle()?.panes();
        const main = panes?.focused.host.parentElement;
        if (panes && main && panes.panes.length === 2) panes.setRatio(clampToMain(main, DEFAULT_RATIO));
      },
    },
    { id: 'view.split-wider', title: 'Widen the focused pane', group: 'view', when: twoPanes, async run() { step(1); } },
    { id: 'view.split-narrower', title: 'Narrow the focused pane', group: 'view', when: twoPanes, async run() { step(-1); } },
  ];
}
