// What fills the workspace's regions (W-05): the one place a story adds a region's content. `app.ts` makes
// the single call, `installWorkspaceFills(handle)`; every later story that puts something in a region (the
// sidebar, the tabs, the inspector, the status bar) adds its `workspace.fill(...)` line here, so the
// composition root is not touched again. The fills are registered at launch and cost nothing: they run only
// when the window unfolds, and are taken out when it folds (workspace/state.ts), so a folded page has none.
import type { AppHandle } from '../app.ts';
import { mountKindChip, mountStrip } from './kind-chip.ts';
import { installPeek } from './peek.ts';
import { createDocumentSignal, mountToolbar } from './toolbar.ts';

export function installWorkspaceFills(handle: AppHandle): void {
  const workspace = handle.workspace();
  // Seen from launch, so Back knows about the documents opened while the window was still folded.
  const signal = createDocumentSignal(handle);
  workspace.fill('toolbar', (el) => mountToolbar(el, handle, signal));
  // The kind chip gives the toolbar's `kind` door its glyph and name (after the toolbar is mounted: fills run in the order they are registered);
  // the strip shows the focused kind's tools. Neither exists folded (K-07).
  workspace.fill('toolbar', (el) => mountKindChip(el, handle, signal));
  workspace.fill('strip', (el) => mountStrip(el, handle, signal));
  // Folded, the pointer resting at an edge shows that edge's panel (W-03); the listeners exist only while folded.
  installPeek(workspace);
}
