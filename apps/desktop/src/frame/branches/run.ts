// Running a registered command from a branch, in the focused pane's context, as the finder would.
import type { AppHandle } from '../../app-types.ts';
import type { Command } from '../../commands/registry.ts';
import { buildAppContext } from '../../selection/bind.ts';

export function commandById(handle: AppHandle, id: string): Command | undefined {
  return (handle.commands() as readonly Command[]).find((c) => c.id === id);
}

/** Whether `id` is registered and may run now. */
export function canRun(handle: AppHandle, id: string): boolean {
  const command = commandById(handle, id);
  return command !== undefined && command.when(buildAppContext(handle));
}

export async function runCommand(handle: AppHandle, id: string): Promise<void> {
  const command = commandById(handle, id);
  if (!command) return;
  const ctx = buildAppContext(handle);
  if (command.when(ctx)) await command.run(ctx);
}
