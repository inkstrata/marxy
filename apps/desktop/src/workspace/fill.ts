// What fills the workspace's regions (W-05): the one place a story adds a region's content. `app.ts` makes
// the single call, `installWorkspaceFills(handle)`; every later story that puts something in a region (the
// sidebar, the tabs, the inspector, the status bar) adds its `workspace.fill(...)` line here, so the
// composition root is not touched again. The fills are registered at launch and cost nothing: they run only
// when the window unfolds, and are taken out when it folds (workspace/state.ts), so a folded page has none.
import type { AppHandle } from '../app.ts';
import { installQuietDates } from '../kinds/quiet-dates.ts';
import { mountKindChip, mountStrip } from './kind-chip.ts';
import { mountInspector, registerInspectorTab } from './inspector.ts';
import { installMetadataMargin } from '../render/metadata-margin.ts';
import { LINKS_TAB } from './links-tab.ts';
import { METADATA_TAB } from './metadata-tab.ts';
import { OUTLINE_TAB } from './outline-tab.ts';
import { VERSIONS_TAB } from './versions-tab.ts';
import { installPeek } from './peek.ts';
import { mountSidebar } from './sidebar-view.ts';
import { mountTabs } from './tabs-view.ts';
import { mountStatusBar } from './status-bar.ts';
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
  // Recent, Pinned and what changed since it was read; the toolbar's sidebar toggle and the left edge's peek light up once this exists (W-07).
  workspace.fill('sidebar', (el) => mountSidebar(el, handle, signal));
  // The documents opened since the window unfolded, one click apart; the band hides itself below two (W-06). Folded there are no tabs.
  workspace.fill('tabs', (el) => mountTabs(el, handle, signal));
  // The inspector: a strip of the tabs registered (Links, then Outline: the headings with the words of each section, where a row jumps or moves its section, W-10; Metadata, W-17, and Versions, V-06, follow) and the selected panel. Folded there is none.
  registerInspectorTab(LINKS_TAB);
  registerInspectorTab(OUTLINE_TAB);
  // Metadata (W-17): the file, its front matter (a value edited in place), how it was read, what is hidden in it and what Read reshaped.
  registerInspectorTab(METADATA_TAB);
  // Versions (V-06, ADR-0072): Changed since you read, the file's earlier versions, a diff from each, Restore to a copy beside it.
  registerInspectorTab(VERSIONS_TAB);
  workspace.fill('inspector', (el) => mountInspector(el, handle, signal));
  // `⌃⌘I`: a quiet preview of the file's metadata in Read's left margin, folded or unfolded; where there is no margin the tab opens instead (W-17).
  installMetadataMargin(handle, signal);
  // The status bar: the file's kind, one measure, where you are and its encoding on the left, the theme and text size on the right; an item with a tab behind it opens that tab (W-11). Folded there is none.
  workspace.fill('status-bar', (el) => mountStatusBar(el, handle, signal));
  // Folded, the pointer resting at an edge shows that edge's panel (W-03); the listeners exist only while folded.
  installPeek(workspace);
  // A changelog's version dates and a notes file's date line are quiet, folded or not: a highlight over the page's own characters (K-22).
  installQuietDates(handle);
}
