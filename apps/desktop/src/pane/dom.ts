// The DOM of a pane (D-01; docs/design/09-app-shell.md §DOM skeleton): `section.marxy-pane` inside
// `#marxy-main`, holding its notices region, its article, its Source mount and an empty find slot. The
// first pane's elements keep the ids every test and script has always named (`#doc`, `#marxy-notices`,
// `#marxy-source`); the second pane's carry a `-2`.

import { ensureNoticesRegion } from '../notices/index.ts';

export type Slot = 0 | 1;

export interface PaneParts {
  readonly host: HTMLElement;
  readonly notices: HTMLElement;
  readonly article: HTMLElement;
  readonly source: HTMLElement;
  /** Empty and zero-height at rest; Rendered find (D-13) fills it. */
  readonly findSlot: HTMLElement;
}

export function idsForSlot(slot: Slot): { article: string; notices: string; source: string } {
  return slot === 0
    ? { article: 'doc', notices: 'marxy-notices', source: 'marxy-source' }
    : { article: 'doc-2', notices: 'marxy-notices-2', source: 'marxy-source-2' };
}

/**
 * Sets the slot attribute and the three ids together, in one synchronous task: no script can observe
 * a moment in which `getElementById('doc')` names nothing or names two elements' worth of pane.
 */
export function applySlot(parts: PaneParts, slot: Slot): void {
  const ids = idsForSlot(slot);
  parts.host.setAttribute('data-marxy-pane', String(slot));
  parts.article.id = ids.article;
  parts.notices.id = ids.notices;
  parts.source.id = ids.source;
}

function findSlot(): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'marxy-find-slot';
  return slot;
}

/** A new pane for `slot`: `section.marxy-pane[data-marxy-pane][tabindex=-1]` and its four children. */
export function createPaneElement(slot: Slot): PaneParts {
  const host = document.createElement('section');
  host.className = 'marxy-pane';
  host.tabIndex = -1;
  const notices = document.createElement('div');
  notices.setAttribute('role', 'status');
  const article = document.createElement('article');
  article.className = 'marxy-article';
  const source = document.createElement('div');
  source.className = 'marxy-source-mount';
  source.hidden = true;
  const parts: PaneParts = { host, notices, article, source, findSlot: findSlot() };
  host.append(notices, article, source, parts.findSlot);
  applySlot(parts, slot);
  return parts;
}

/**
 * The first pane, from the page as it was loaded. The app's skeleton (index.html) already is one: its
 * elements are adopted as they are. A harness page that still has the older skeleton (`#marxy-main >
 * #marxy-notices + #doc`, or a bare `#doc`) is given the section around what it has, in place: a plain
 * block with no style of its own there, so nothing is laid out differently. `#marxy-source` is adopted
 * wherever it is (the gate's page keeps it outside `#marxy-main`), else made inside the pane. Idempotent:
 * a second app in the page finds the pane the first one left.
 */
export function adoptFirstPane(): { readonly main: HTMLElement; readonly parts: PaneParts } {
  const article = document.getElementById('doc');
  if (!article) throw new Error('marxy: the page has no #doc');
  let host = article.closest<HTMLElement>('section.marxy-pane');
  if (!host) {
    host = document.createElement('section');
    host.className = 'marxy-pane';
    const before = article.previousElementSibling;
    const notices = before?.id === 'marxy-notices' ? before : null;
    article.parentElement!.insertBefore(host, notices ?? article);
    if (notices) host.append(notices);
    host.append(article);
  }
  host.setAttribute('data-marxy-pane', '0');
  // Made the way notices/index.ts always has (zero-height, no padding) where the page has none.
  const notices = host.querySelector<HTMLElement>(':scope > [role="status"]') ?? ensureNoticesRegion();
  let source = document.getElementById('marxy-source');
  if (!source) {
    source = document.createElement('div');
    source.id = 'marxy-source';
    source.className = 'marxy-source-mount';
    source.hidden = true;
    host.append(source);
  }
  const slot = host.querySelector<HTMLElement>(':scope > .marxy-find-slot') ?? host.appendChild(findSlot());
  // `#marxy-main` is the grid two panes share; a bare harness page has none, and its pane's parent stands in.
  const main = host.closest<HTMLElement>('#marxy-main') ?? host.parentElement!;
  return { main, parts: { host, notices, article, source, findSlot: slot } };
}
