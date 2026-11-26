// What the look painter last painted, and the context it reads beyond a pane, for the pop-over, the Studio and the
// commands to read without loading the painter (which carries a stylesheet).
import { resolve, type LookContext, type LookState, type Resolved } from '@marxy/theme';

const byHost = new WeakMap<HTMLElement, Resolved>();
let windowResolved: Resolved | null = null;

/** What the window's chrome was painted with, or null while the theme paints it. */
export const windowLook = (): Resolved | null => windowResolved;
/** What `host` (a pane's section) was painted with, or null. */
export const paneLook = (host: HTMLElement): Resolved | null => byHost.get(host) ?? null;

export function notePainted(host: HTMLElement | null, r: Resolved | null): void {
  if (host === null) windowResolved = r;
  else if (r === null) byHost.delete(host);
  else byHost.set(host, r);
}

/** The context the engine reads beyond the pane: the system's dark, the hour, more contrast. */
export function lookContext(doc: Document = document): Pick<LookContext, 'systemDark' | 'hour' | 'more'> {
  const view = doc.defaultView;
  return {
    systemDark: view?.matchMedia('(prefers-color-scheme: dark)').matches ?? false,
    hour: new Date().getHours(),
    more: doc.documentElement.getAttribute('data-marxy-contrast') === 'more',
  };
}

type PaneLike = { readonly host: HTMLElement; path(): string | null };

/** What `pane` wears under `state` as the painter resolves it, now rather than at the next paint. */
export function paneResolved(state: LookState, pane: PaneLike): Resolved {
  const doc = pane.host.ownerDocument;
  return resolve(state, { ...lookContext(doc), kind: pane.host.getAttribute('data-marxy-kind'), path: pane.path() ?? '', width: pane.host.clientWidth || doc.documentElement.clientWidth });
}

/** The look `pane` wears as the painter resolves it (a rule's, perhaps), else the look in use: what a change acts on. */
export function shownLookId(state: LookState, pane: PaneLike | undefined): string {
  return pane ? paneResolved(state, pane).look.id : state.id;
}
