// Concatenates feature command lists; operations come from core (MARXY-42).
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { fromOperation, type Command } from './registry.ts';
import { selectionNavigationCommands } from './selection-nav.ts';

export type { AppContext, Command } from './registry.ts';
export { fromOperation } from './registry.ts';

export function commands(): readonly Command[] {
  return [...selectionNavigationCommands(), ...OPERATIONS.map(fromOperation)];
}
