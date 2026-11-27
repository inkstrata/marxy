// Save from the native menu and from Source's own Mod-s: the same rule Rendered's Mod+S follows
// (`changes.save`): on a changes page Save is its document's, and with review_changes on a document's Save first opens
// its patch. Anything else saves at once.
import { appHandle } from '../commands/app-handle.ts';
import type { Command } from '../commands/registry.ts';
import { save } from '../save.ts';
import { buildAppContext } from '../selection/bind.ts';
import { reviewChangesOn } from './review.ts';

/** True when `changes.save` took the press (it opened the patch, or saved the page's document). */
export async function saveThroughChanges(): Promise<boolean> {
  const handle = appHandle();
  if (!handle) return false;
  // Typing in Source reaches the store only when folded: the patch must hold it.
  if (reviewChangesOn()) await handle.foldSource();
  const command = (handle.commands() as readonly Command[]).find((c) => c.id === 'changes.save');
  const ctx = buildAppContext(handle);
  if (!command?.when(ctx)) return false;
  await command.run(ctx);
  return true;
}

export async function saveOrReadChanges(): Promise<void> {
  if (await saveThroughChanges()) return;
  await save();
}
