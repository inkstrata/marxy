// A page of the app's own, laid over the page area between the drawer and the panel, for what is no file (the hue test,
// a folder): it takes no tab, Escape or Close leaves it, and what it shows is gone when it closes. One at a time.
// A slim sticky bar holds the crumb (the page's label unless the page sets its own) and Close with its Esc.
import { icon } from './icons.ts';

export interface AppPage {
  /** Where the page's content goes; its bar and Close button are outside it. */
  readonly column: HTMLElement;
  /** The bar's left side, which says where the page is; it starts as the page's label. */
  readonly crumb: HTMLElement;
  close(): void;
  /** Runs `fn` once when the page closes, by Escape, Close or another app page taking its place. */
  onClose(fn: () => void): void;
}

let current: (AppPage & { readonly id: string }) | null = null;

/** Opens the page `id`, closing any other app page first; the same `id` already open is given back as it is. */
export function openAppPage(id: string, label: string, opts?: { readonly wide?: boolean }): AppPage {
  if (current?.id === id) return current;
  current?.close();
  const page = document.createElement('div');
  page.className = 'marxy-apppage';
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-label', label);
  const column = document.createElement('div');
  column.className = opts?.wide ? 'marxy-apppage-column marxy-apppage-wide' : 'marxy-apppage-column';
  const bar = document.createElement('div');
  bar.className = 'marxy-apppage-bar';
  const crumb = document.createElement('div');
  crumb.className = 'marxy-apppage-crumb';
  crumb.textContent = label;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'marxy-btn';
  closeButton.dataset.marxyBtn = 'quiet';
  closeButton.dataset.marxySize = 'compact';
  closeButton.title = 'Close (Esc)';
  const key = document.createElement('span');
  key.className = 'marxy-btn-key';
  key.textContent = 'Esc';
  closeButton.append(icon('close'), 'Close', key);
  bar.append(crumb, closeButton);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Escape in the palette, Find or a menu opened over the page closes that, not the page under it.
    const target = e.target instanceof Element ? e.target : null;
    if (target && !page.contains(target) && target.closest('[role="dialog"], [role="menu"], [role="search"]')) return;
    e.preventDefault();
    e.stopPropagation();
    made.close();
  };
  const closers: (() => void)[] = [];
  const made = {
    id,
    column,
    crumb,
    close(): void {
      page.remove();
      document.removeEventListener('keydown', onKey, true);
      if (current === made) current = null;
      for (const fn of closers.splice(0)) fn();
    },
    onClose(fn: () => void): void {
      closers.push(fn);
    },
  };
  closeButton.addEventListener('click', () => made.close());
  page.append(bar, column);
  document.addEventListener('keydown', onKey, true);
  document.body.append(page);
  current = made;
  return made;
}
