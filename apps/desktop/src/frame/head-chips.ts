// The pane head's state chips: `¶` while Reveal is on, pressed to turn it
// off, and "Unsaved · n places" while the pane's document holds changes not yet written, pressed to read them as a patch.
// Each runs the registry command its key runs, in this pane.
import type { AppHandle } from '../app-types.ts';
import { changesSummary, onChangesSummary } from '../changes/state.ts';
import type { Command } from '../commands/registry.ts';
import { onDepths, revealOn } from '../depths/dress.ts';
import { buildAppContext } from '../selection/bind.ts';
import type { FramePane } from './types.ts';

export interface HeadChips {
  readonly reveal: HTMLButtonElement;
  readonly unsaved: HTMLButtonElement;
  render(): void;
  destroy(): void;
}

/** "Unsaved · 1 place", "Unsaved · 3 places". */
export const unsavedWords = (places: number): string => `Unsaved · ${places} ${places === 1 ? 'place' : 'places'}`;

function chip(kind: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'marxy-head-chip';
  b.setAttribute('data-marxy-chip', kind);
  b.hidden = true;
  // A press in the head never takes focus or the selection from the page.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

/** Runs registry command `id` in `pane`, as its key would there. */
function runIn(handle: AppHandle, pane: FramePane, id: string): void {
  const panes = handle.panes();
  if (panes.focused !== pane) panes.focus(pane);
  const command = (handle.commands() as readonly Command[]).find((c) => c.id === id);
  const ctx = buildAppContext(handle);
  if (command?.when(ctx)) void Promise.resolve(command.run(ctx)).catch((e: unknown) => console.warn(`marxy: ${id} failed`, e));
}

export function mountHeadChips(pane: FramePane, handle: AppHandle): HeadChips {
  const reveal = chip('reveal');
  reveal.textContent = '¶';
  reveal.title = 'Reveal is on: the markup put back around the reading · press to turn it off (Shift+X)';
  reveal.setAttribute('aria-label', 'Reveal is on. Turn it off');
  reveal.setAttribute('aria-pressed', 'true');
  const unsaved = chip('unsaved');
  const dot = document.createElement('i');
  dot.className = 'marxy-head-chip-dot';
  dot.setAttribute('aria-hidden', 'true');
  const words = document.createElement('span');
  unsaved.append(dot, words);
  unsaved.title = 'Nothing is written until you save · press to read the changes as a patch (R)';

  function render(): void {
    reveal.hidden = !(pane.view.mode === 'rendered' && pane.path() !== null && (revealOn(pane) || pane.content.viewer()?.reveal?.on() === true));
    const path = pane.path();
    const sum = path === null ? null : changesSummary(path);
    const places = sum?.places ?? 0;
    unsaved.hidden = places === 0;
    if (sum && places > 0) {
      words.textContent = unsavedWords(places);
      unsaved.setAttribute('aria-label', `${unsavedWords(places)}, +${sum.added} −${sum.removed} lines. Read the changes as a patch`);
    }
  }

  reveal.addEventListener('click', () => runIn(handle, pane, 'depths.reveal'));
  unsaved.addEventListener('click', () => runIn(handle, pane, 'changes.read'));
  const offChanges = onChangesSummary((path) => {
    if (path === pane.path()) render();
  });
  const offDepths = onDepths(render);
  render();
  return {
    reveal,
    unsaved,
    render,
    destroy() {
      offChanges();
      offDepths();
    },
  };
}
