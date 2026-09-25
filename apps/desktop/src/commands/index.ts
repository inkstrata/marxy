// Concatenates feature command lists; operations come from core (MARXY-42, MARXY-43).
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { documentCommands, startDocumentEditingWire } from './document.ts';
import { fromOperation, type Command } from './registry.ts';
import { selectionNavigationCommands } from './selection-nav.ts';

export type { AppContext, Command } from './registry.ts';
export { fromOperation } from './registry.ts';

startDocumentEditingWire();

export function commands(): readonly Command[] {
  return [...selectionNavigationCommands(), ...documentCommands(), ...OPERATIONS.map(fromOperation)];
}
