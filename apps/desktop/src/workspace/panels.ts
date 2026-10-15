// The panels the workspace's regions are filled with (W-05): the toolbar, the kind chip and strip, the sidebar,
// the tabs, the inspector and its tabs, the status bar. The window is folded until the reader unfolds it, so
// none of this is needed at first text; it is one chunk, read on the first unfold or peek (workspace/fill.ts
// loads it, F-111). Nothing but fill.ts imports this file.
import { mountKindChip, mountStrip } from './kind-chip.ts';
import { mountInspector, registerInspectorTab } from './inspector.ts';
import { LINKS_TAB } from './links-tab.ts';
import { METADATA_TAB } from './metadata-tab.ts';
import { OUTLINE_TAB } from './outline-tab.ts';
import { VERSIONS_TAB } from './versions-tab.ts';
import { mountSidebar } from './sidebar-view.ts';
import { mountTabs } from './tabs-view.ts';
import { mountStatusBar } from './status-bar.ts';
import { mountToolbar } from './toolbar.ts';

// The inspector's strip of tabs: Links, then Outline (the headings with the words of each section, where a row jumps
// or moves its section, W-10) and Versions (V-06, ADR-0072: Changed since you read, the file's earlier versions, a
// diff from each, Restore to a copy beside it). A second id replaces the first, so loading twice is harmless.
registerInspectorTab(LINKS_TAB);
registerInspectorTab(OUTLINE_TAB);
// Metadata (W-17): the file, its front matter (a value edited in place), how it was read, what is hidden in it and what Read reshaped.
registerInspectorTab(METADATA_TAB);
registerInspectorTab(VERSIONS_TAB);

export { mountInspector, mountKindChip, mountSidebar, mountStatusBar, mountStrip, mountTabs, mountToolbar };
