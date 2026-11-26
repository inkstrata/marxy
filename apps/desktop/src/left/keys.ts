// Tab on the page gives the keys to the panel (the page-key rule: only with focus on the page and the
// verbs on). The panel's own keys are its frame's (left/frame.ts); Tab there gives them back.
import type { AppHandle } from '../app-types.ts';
import { keysOnPage } from '../selection/bind.ts';
import type { LeftView } from './frame.ts';

export function installLeftKeys(_handle: AppHandle, left: LeftView): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (!keysOnPage(e)) return;
    e.preventDefault();
    left.focusPanel();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
