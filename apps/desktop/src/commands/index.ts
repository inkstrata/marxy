// Concatenates feature command lists; operations come from core (MARXY-42, MARXY-43, C-06).
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { appearanceCommands } from './appearance.ts';
import { blockEditCommands } from './block-edit.ts';
import { collectionCommands } from './collection.ts';
import { compareCommands } from './compare.ts';
import { kindCommands } from './kind.ts';
import { copyAsCommands } from './copy-as.ts';
import { copyTextCommands } from './copy-text.ts';
import { documentCommands } from './document.ts';
import { editorCommands } from './editor.ts';
import { findCommands } from './find.ts';
import { navigationCommands } from './navigation.ts';
import { outlineCommands } from './outline.ts';
import { pasteCommands } from './paste.ts';
import { paneLayoutCommands } from './pane-layout.ts';
import { paneFocusCommands } from './pane-focus.ts';
import { paneCloseCommands } from './pane-close.ts';
import { paneOpenCommands } from './pane-open.ts';
import { paneSplitSameCommands } from './pane-split-same.ts';
import { fromOperation, type Command } from './registry.ts';
import { selectionNavigationCommands } from './selection-nav.ts';
import { sourceEditCommands } from './source-edit.ts';
import { sourceViewCommands } from './source-view.ts';
import { transformCommands } from './transform.ts';
import { transformClipboardCommands } from './transform-clipboard.ts';
import { trustRevokeCommands } from './trust.ts';
import { viewModeCommands } from './view-mode.ts';
import { panelCommands } from './panels.ts';
import { workspaceCommands } from './workspace.ts';

export type { AppContext, Command } from './registry.ts';
export { fromOperation } from './registry.ts';

export function commands(): readonly Command[] {
  return [
    ...selectionNavigationCommands(),
    ...documentCommands(),
    ...sourceViewCommands(),
    ...sourceEditCommands(),
    ...blockEditCommands(),
    ...trustRevokeCommands(),
    ...navigationCommands(),
    ...paneFocusCommands(),
    ...appearanceCommands(),
    ...outlineCommands(),
    ...paneLayoutCommands(),
    ...paneCloseCommands(),
    ...paneOpenCommands(),
    ...paneSplitSameCommands(),
    ...viewModeCommands(),
    ...workspaceCommands(),
    ...panelCommands(),
    ...editorCommands(),
    ...collectionCommands(),
    ...kindCommands(),
    ...copyTextCommands(),
    ...copyAsCommands(),
    ...pasteCommands(),
    ...findCommands(),
    ...compareCommands(),
    ...transformCommands(),
    ...transformClipboardCommands(),
    ...OPERATIONS.map(fromOperation),
  ];
}
