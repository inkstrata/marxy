// The regions of the unfolded workspace (ADR-0058; W-02): six named, empty containers around the panes.
// They exist in the page only while the window is unfolded: folded, there is no element to hide, so the
// page is today's page and `checkChrome` has nothing to find. They hold no content: W-03 to W-11 fill them.
//
// Where they sit is the stylesheet's (`packages/theme/src/base.css`, under `[data-marxy-workspace="unfolded"]`).
// In the document they run in reading order: the sidebar and the three bands above the panes, then the
// panes' own `#marxy-main`, then the inspector and the status bar.

import { WORKSPACE_REGIONS, type WorkspaceRegion } from '@marxy/core/src/layout/workspace-storage.ts';

export { WORKSPACE_REGIONS };
export type { WorkspaceRegion };

/** Regions drawn before the panes in the document; the rest follow them. */
const BEFORE_PANES: readonly WorkspaceRegion[] = ['sidebar', 'toolbar', 'tabs', 'strip'];

/** Which regions are shown (docked). A region that is not is still in the page, `hidden`, so what it holds survives. */
export type Arrangement = Readonly<Record<WorkspaceRegion, boolean>>;

function makeRegion(name: WorkspaceRegion, open: boolean): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-marxy-workspace-region', name);
  el.hidden = !open;
  return el;
}

/**
 * Puts the six regions in `body` around `main` (all of them after it when `main` is not a child of `body`,
 * as in a bare harness page) and returns them by name.
 */
export function mountRegions(body: HTMLElement, main: HTMLElement, arrangement: Arrangement): ReadonlyMap<WorkspaceRegion, HTMLElement> {
  const made = new Map<WorkspaceRegion, HTMLElement>();
  for (const name of WORKSPACE_REGIONS) made.set(name, makeRegion(name, arrangement[name]));
  const before = BEFORE_PANES.map((name) => made.get(name)!);
  const after = WORKSPACE_REGIONS.filter((name) => !BEFORE_PANES.includes(name)).map((name) => made.get(name)!);
  if (main.parentElement === body) {
    for (const el of before) body.insertBefore(el, main);
    main.after(...after);
  } else {
    body.append(...before, ...after);
  }
  return made;
}

export function unmountRegions(regions: ReadonlyMap<WorkspaceRegion, HTMLElement>): void {
  for (const el of regions.values()) el.remove();
}

export function setRegionOpen(regions: ReadonlyMap<WorkspaceRegion, HTMLElement>, name: WorkspaceRegion, open: boolean): void {
  const el = regions.get(name);
  if (el) el.hidden = !open;
}
