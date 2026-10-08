// Concatenates feature command lists; operations come from core (MARXY-42, MARXY-43).
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { appearanceCommands } from './appearance.ts';
import { collectionCommands } from './collection.ts';
import { documentCommands } from './document.ts';
import { editorCommands } from './editor.ts';
import { navigationCommands } from './navigation.ts';
import { outlineCommands } from './outline.ts';
import { fromOperation, type Command } from './registry.ts';
import { selectionNavigationCommands } from './selection-nav.ts';
import { sourceViewCommands } from './source-view.ts';
import { trustRevokeCommands } from './trust.ts';

export type { AppContext, Command } from './registry.ts';
export { fromOperation } from './registry.ts';

export function commands(): readonly Command[] {
  return [
    ...selectionNavigationCommands(),
    ...documentCommands(),
    ...sourceViewCommands(),
    ...trustRevokeCommands(),
    ...navigationCommands(),
    ...appearanceCommands(),
    ...outlineCommands(),
    ...editorCommands(),
    ...collectionCommands(),
    ...OPERATIONS.map(fromOperation),
  ];
}
