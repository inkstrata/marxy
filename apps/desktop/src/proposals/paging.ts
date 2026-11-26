// Turn the page (proposal `paging`): Space moves the focused pane a screen less two lines, Shift+Space a screen back, and
// the two lines carried over are marked for a moment where they now sit, so the eye finds its place on the new screen.
import type { AppHandle } from '../app-types.ts';
import { proposalOn } from './state.ts';

const CARRY_LINES = 2;
const MARK_MS = 900;

/** Space that belongs to something else: a field, a control, the editor, a summary that folds. */
const OWN_SPACE = 'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), .cm-editor, [role="menu"], [role="dialog"]';

function visibleBand(scroller: HTMLElement, pane: Element | null): { top: number; bottom: number } {
  const head = pane?.querySelector<HTMLElement>(':scope > .marxy-head');
  const top = head ? head.getBoundingClientRect().bottom : 0;
  const bottom = scroller === document.documentElement ? window.innerHeight : scroller.getBoundingClientRect().bottom;
  return { top, bottom };
}

function markCarried(article: HTMLElement, top: number, height: number): void {
  const box = article.getBoundingClientRect();
  const mark = document.createElement('div');
  mark.className = 'marxy-carry';
  mark.setAttribute('aria-hidden', 'true');
  Object.assign(mark.style, { left: `${box.left}px`, width: `${box.width}px`, top: `${top}px`, height: `${height}px` });
  document.body.append(mark);
  setTimeout(() => mark.remove(), MARK_MS);
}

export function installPaging(handle: AppHandle): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || event.isComposing) return;
    if (!proposalOn('paging')) return;
    if (event.target instanceof Element && event.target !== document.body && event.target.closest(OWN_SPACE)) return;
    const view = handle.panes().focused?.view;
    if (!view || view.mode !== 'rendered') return;
    const article = view.host.article;
    const scroller = view.scroller;
    const line = parseFloat(getComputedStyle(article).lineHeight) || 30;
    const band = visibleBand(scroller, article.closest('.marxy-pane'));
    const page = Math.max(line, band.bottom - band.top - CARRY_LINES * line);
    const before = scroller.scrollTop;
    event.preventDefault();
    scroller.scrollBy({ top: event.shiftKey ? -page : page, behavior: 'instant' });
    const moved = scroller.scrollTop - before;
    if (moved === 0) return;
    const carried = Math.min(CARRY_LINES * line, band.bottom - band.top);
    // Forward, the lines that were at the bottom moved up by what the page moved (to the top, unless the end came first);
    // back, the lines that were at the top moved down.
    const at = moved > 0 ? band.bottom - carried - moved : band.top - moved;
    if (at >= band.top && at + carried <= band.bottom) markCarried(article, at, carried);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
