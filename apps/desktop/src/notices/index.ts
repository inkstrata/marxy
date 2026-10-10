// One-line notices above the article (docs/design/09-app-shell.md §Notices). MARXY-138.

/**
 * What a pane says when its Source text and the other pane's fold of the same file meet (D-11), and when a
 * save is refused for it. Opening the same file again does nothing over unsaved changes, so it names ways out
 * that work.
 */
export const SOURCE_HELD_APART =
  'Source in the other pane changed this file; your text here was not folded in. Undo your typing here until it matches the file, or open another document and discard it.';

export type NoticeKind = 'blocked' | 'info';

export interface NoticeInput {
  readonly kind: NoticeKind;
  readonly text: string;
  readonly transient?: boolean;
}

let nextId = 0;
const open = new Map<number, HTMLElement>();

/**
 * Ensures `#marxy-notices` exists in flow above `#doc`, empty and zero-height at rest. Given a pane
 * (`section.marxy-pane`, D-01), that pane's own region instead: the `[role=status]` child it was built
 * with, or one made at its top.
 */
export function ensureNoticesRegion(pane?: HTMLElement): HTMLElement {
  if (pane) {
    const own = pane.querySelector<HTMLElement>(':scope > [role="status"]');
    if (own) return own;
    const made = document.createElement('div');
    made.setAttribute('role', 'status');
    pane.insertBefore(made, pane.firstChild);
    return made;
  }
  let region = document.getElementById('marxy-notices');
  const doc = document.getElementById('doc');
  if (region === null) {
    region = document.createElement('div');
    region.id = 'marxy-notices';
    region.setAttribute('role', 'status');
    region.style.margin = '0';
    region.style.padding = '0';
    region.style.border = '0';
    if (doc?.parentElement) doc.parentElement.insertBefore(region, doc);
    else document.body.insertBefore(region, document.body.firstChild);
  }
  return region;
}

export function notify(input: NoticeInput): number {
  const region = ensureNoticesRegion();
  // One line per kind and text: the same news again replaces the old line instead of stacking.
  for (const [openId, el] of [...open]) {
    if (el.dataset.noticeKind === input.kind && el.querySelector('.marxy-notice-text')?.textContent === input.text) {
      dismissNotice(openId);
    }
  }
  const id = ++nextId;
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  line.dataset.noticeId = String(id);
  line.dataset.noticeKind = input.kind;

  const text = document.createElement('span');
  text.className = 'marxy-notice-text';
  text.textContent = input.text;
  line.append(text);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'marxy-notice-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => dismissNotice(id));
  line.append(dismiss);

  region.append(line);
  open.set(id, line);

  if (input.transient) {
    window.setTimeout(() => dismissNotice(id), 4000);
  }
  return id;
}

export function dismiss(id: number): void {
  dismissNotice(id);
}

function dismissNotice(id: number): void {
  const el = open.get(id);
  if (el === undefined) return;
  el.remove();
  open.delete(id);
}

export function clearNotices(): void {
  for (const id of [...open.keys()]) dismissNotice(id);
  ensureNoticesRegion().replaceChildren();
}
