// What fills the workspace's regions (W-05): the one place a story adds a region's content. `app.ts` makes
// the single call, `installWorkspaceFills(handle)`; every later story that puts something in a region (the
// sidebar, the tabs, the inspector, the status bar) adds its `workspace.fill(...)` line here, so the
// composition root is not touched again. The fills are registered at launch and cost nothing: they run only
// when the window unfolds, and are taken out when it folds (workspace/state.ts), so a folded page has none.
//
// The panels' code is not part of the first-text bundle (F-111): it is `panels.ts`, one chunk, read the first
// time a region is made. `loadPanels()` is what an unfold waits for (the workspace's `ready`), so by the time
// `unfold()` resolves each fill has run exactly as it did when the code was static; only a peek, which is
// synchronous, can make a region before the chunk is in, and its content then arrives a moment later.
import type { AppHandle } from '../app.ts';
import { notify } from '../notices/index.ts';
import { createDocumentSignal, type DocumentSignal } from './document-signal.ts';
import { installPeek } from './peek.ts';
import type { RegionFill } from './state.ts';

type Panels = typeof import('./panels.ts');

let loaded: Panels | null = null;
let loading: Promise<Panels> | null = null;

export const PANELS_UNAVAILABLE = 'The side panels could not be loaded · they stay empty. Unfolding again tries once more.';

/** Reads the panels' chunk once. A failed read is said to the reader and not kept, so the next unfold tries again. */
export function loadPanels(): Promise<Panels> {
  loading ??= import('./panels.ts').then(
    (m) => (loaded = m),
    (e: unknown) => {
      loading = null;
      console.warn('marxy: the workspace panels could not be loaded', e);
      // The same words again replace the line, so seven fills and an unfold make one notice.
      notify({ kind: 'error', text: PANELS_UNAVAILABLE });
      throw e;
    },
  );
  return loading;
}

/** A fill that runs `mount` from the panels' chunk: at once when the chunk is in, else when it arrives (and not if the region went first). */
function panel(mount: (panels: Panels, el: HTMLElement) => (() => void) | void): RegionFill {
  return (el) => {
    if (loaded) return mount(loaded, el);
    let gone = false;
    let dispose: (() => void) | void;
    loadPanels().then(
      (panels) => {
        if (gone) return;
        try {
          dispose = mount(panels, el);
        } catch (error) {
          console.warn('marxy: a workspace region could not be filled', error);
        }
      },
      () => undefined, // said by loadPanels
    );
    return () => {
      gone = true;
      dispose?.();
    };
  };
}

export function installWorkspaceFills(handle: AppHandle): void {
  const workspace = handle.workspace();
  // Seen from launch, so Back knows about the documents opened while the window was still folded.
  const signal: DocumentSignal = createDocumentSignal(handle);
  workspace.fill('toolbar', panel((p, el) => p.mountToolbar(el, handle, signal)));
  // The kind chip gives the toolbar's `kind` door its glyph and name (after the toolbar is mounted: fills run in the order they are registered);
  // the strip shows the focused kind's tools. Neither exists folded (K-07).
  workspace.fill('toolbar', panel((p, el) => p.mountKindChip(el, handle, signal)));
  workspace.fill('strip', panel((p, el) => p.mountStrip(el, handle, signal)));
  // Recent, Pinned and what changed since it was read; the toolbar's sidebar toggle and the left edge's peek light up once this exists (W-07).
  workspace.fill('sidebar', panel((p, el) => p.mountSidebar(el, handle, signal)));
  // The documents opened since the window unfolded, one click apart; the band hides itself below two (W-06). Folded there are no tabs.
  workspace.fill('tabs', panel((p, el) => p.mountTabs(el, handle, signal)));
  // The inspector: a strip of the tabs registered in panels.ts (Links, Outline, Versions) and the selected panel. Folded there is none.
  workspace.fill('inspector', panel((p, el) => p.mountInspector(el, handle, signal)));
  // The status bar: the file's kind, one measure, where you are and its encoding on the left, the theme and text size on the right; an item with a tab behind it opens that tab (W-11). Folded there is none.
  workspace.fill('status-bar', panel((p, el) => p.mountStatusBar(el, handle, signal)));
  // Folded, the pointer resting at an edge shows that edge's panel (W-03); the listeners exist only while folded.
  installPeek(workspace);
}
