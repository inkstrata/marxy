// Concatenates feature command lists; operations come from core.
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { appearanceCommands } from './appearance.ts';
import { besideCommands } from './beside.ts';
import { showRenderedCommands } from '../read-as/show-rendered.ts';
import { blockEditCommands } from './block-edit.ts';
import { collectionCommands } from './collection.ts';
import { compareCommands } from './compare.ts';
import { exportCommands } from './export.ts';
import { dataCommands } from './data.ts';
import { kindCommands } from './kind.ts';
import { kindToolCommands } from './kind-tools.ts';
import { logCommands } from './log.ts';
import { copyAsCommands } from './copy-as.ts';
import { copyTextCommands } from './copy-text.ts';
import { documentCommands } from './document.ts';
import { editorCommands } from './editor.ts';
import { findCommands } from './find.ts';
import { navigationCommands } from './navigation.ts';
import { noticeCommands } from './notices.ts';
import { outlineCommands } from './outline.ts';
import { pasteCommands } from './paste.ts';
import { readPartCommands } from './read-part.ts';
import { paneLayoutCommands } from './pane-layout.ts';
import { paneFocusCommands } from './pane-focus.ts';
import { paneCloseCommands } from './pane-close.ts';
import { paneOpenCommands } from './pane-open.ts';
import { paneSplitSameCommands } from './pane-split-same.ts';
import { fromOperation, type Command } from './registry.ts';
import { selectionNavigationCommands } from './selection-nav.ts';
import { cursorCommands } from './cursor.ts';
import { depthCommands } from './depths.ts';
import { changesCommands } from './changes.ts';
import { sourceEditCommands } from './source-edit.ts';
import { sourceViewCommands } from './source-view.ts';
import { transformCommands } from './transform.ts';
import { transformClipboardCommands } from './transform-clipboard.ts';
import { trustRevokeCommands } from './trust.ts';
import { viewModeCommands } from './view-mode.ts';
import { frameCommands } from './frame.ts';
import { partsAware, partsCommands } from '../parts/commands.ts';
import { lookCommands } from '../look/commands.ts';
import { lineCommands } from '../line/commands.ts';

export type { AppContext, Command } from './registry.ts';
export { fromOperation } from './registry.ts';

export function commands(): readonly Command[] {
  // The cursor's commands answer for a kind's parts too (parts/commands.ts).
  return partsAware([
    ...selectionNavigationCommands(),
    ...cursorCommands(),
    ...depthCommands(),
    ...partsCommands(),
    ...changesCommands(),
    ...documentCommands(),
    ...sourceViewCommands(),
    ...sourceEditCommands(),
    ...blockEditCommands(),
    ...readPartCommands(),
    ...trustRevokeCommands(),
    ...navigationCommands(),
    ...besideCommands(),
    ...showRenderedCommands(),
    ...noticeCommands(),
    ...paneFocusCommands(),
    ...appearanceCommands(),
    ...outlineCommands(),
    ...paneLayoutCommands(),
    ...paneCloseCommands(),
    ...paneOpenCommands(),
    ...paneSplitSameCommands(),
    ...viewModeCommands(),
    ...frameCommands(),
    ...editorCommands(),
    ...collectionCommands(),
    ...kindCommands(),
    ...logCommands(),
    ...kindToolCommands(),
    ...dataCommands(),
    ...copyTextCommands(),
    ...copyAsCommands(),
    ...pasteCommands(),
    ...findCommands(),
    ...compareCommands(),
    ...exportCommands(),
    ...transformCommands(),
    ...transformClipboardCommands(),
    ...lookCommands(),
    ...lineCommands(),
    ...OPERATIONS.map(fromOperation),
  ]);
}
