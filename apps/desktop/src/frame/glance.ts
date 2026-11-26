// An open from a list in the drawer (the Library, Find). With Glance tabs on (a proposal), a single click shows the file
// in the window's one glance tab, which the next single click replaces; a double click keeps it. Ctrl+Shift opens beside.
import type { AppHandle } from '../app-types.ts';
import { proposalOn } from '../proposals/state.ts';
import { intend } from './intent.ts';
import type { Frame } from './types.ts';

export function openFromList(handle: AppHandle, frame: Frame, path: string, e: MouseEvent, at?: number): void {
  const where = at === undefined ? {} : { at };
  if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
    void handle.open(path, { ...where, target: 'other' });
    return;
  }
  const pane = handle.panes().focused;
  const glancing = proposalOn('glance');
  if (glancing && e.detail >= 2) {
    const glance = frame.tabs.model.tabs.find((t) => t.glance && t.path === path);
    if (glance) {
      frame.tabs.model.keep(glance.id);
      frame.tabs.render();
      return;
    }
  }
  intend(pane.host, path, glancing && e.detail < 2 ? 'glance' : 'new');
  void handle.open(path, where);
}
