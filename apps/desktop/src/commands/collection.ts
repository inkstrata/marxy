// Two palette commands for the reader's collection (C-14, ADR-0053): add the open document's folder
// to collection.toml, and open collection.toml in Source. No dialog, no settings pane, no key.
import { appendRoot, COLLECTION_TEMPLATE } from '@marxy/core/src/index-model/collection.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { collectionFile, isFilesystemRoot } from '../collection/load.ts';
import { notify } from '../notices/index.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const say = (text: string): void => {
  notify({ kind: 'info', text });
};

const notFound = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'not-found';

/** Appends the open document's repository root to collection.toml, creating the file if absent. */
async function addThisFolder(): Promise<void> {
  const handle = appHandle();
  const path = handle?.currentPath() ?? null;
  if (!handle || path === null) return;
  const shell = handle.shell;
  const file = await collectionFile(shell);
  if (file === undefined || !shell.configPaths) {
    say('This build keeps no configuration folder, so there is no collection to add to.');
    return;
  }
  const root = await handle.index.rootFor(path);
  if (isFilesystemRoot(root)) {
    say('This is a whole disk, too large to index; it was not added to the collection.');
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(file);
  } catch (e) {
    if (!notFound(e)) {
      say(`collection.toml could not be read (${String(e)}); nothing was changed.`);
      return;
    }
    bytes = new Uint8Array(0);
  }
  const home = inferHomeFromConfig((await shell.configPaths()).config);
  let next: Uint8Array;
  try {
    next = appendRoot(bytes, root, { home });
  } catch (e) {
    // Unparseable or not a list of tables: the file is the reader's, left exactly as it is.
    say(`collection.toml was not changed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (next === bytes) {
    say('Already in the collection');
    return;
  }
  try {
    await shell.writeFileAtomic(file, next);
  } catch (e) {
    say(`collection.toml could not be written (${String(e)}); nothing was changed.`);
    return;
  }
  say(`Added ${basename(root)} to the collection`);
}

/** Opens collection.toml (written from the template first when absent) in Source. */
async function editCollection(): Promise<void> {
  const handle = appHandle();
  if (!handle) return;
  const shell = handle.shell;
  const file = await collectionFile(shell);
  if (file === undefined) {
    say('This build keeps no configuration folder, so there is no collection to edit.');
    return;
  }
  try {
    await shell.readFile(file);
  } catch (e) {
    if (!notFound(e)) {
      say(`collection.toml could not be read (${String(e)}).`);
      return;
    }
    try {
      await shell.writeFileAtomic(file, new TextEncoder().encode(COLLECTION_TEMPLATE));
    } catch (w) {
      say(`collection.toml could not be created (${String(w)}).`);
      return;
    }
  }
  await handle.open(file);
  await handle.jumpToSource(0);
}

export function collectionCommands(): readonly Command[] {
  return [
    {
      id: 'collection.add-folder',
      title: 'Add this folder to the collection',
      group: 'app',
      // A document is open; whether its folder is already declared is answered when it runs.
      when: () => appHandle()?.currentPath() != null,
      run: async (ctx) => {
        ctx.closePalette();
        await addThisFolder();
      },
    },
    {
      id: 'collection.edit',
      title: 'Edit collection',
      group: 'app',
      when: () => appHandle() !== null,
      run: async (ctx) => {
        ctx.closePalette();
        await editCollection();
      },
    },
  ];
}
