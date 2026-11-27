// Palette commands for the reader's collection: add the open document's folder, or one chosen
// in the system's picker (the Library's Add a folder…), to collection.toml, and open collection.toml in Source.
import { appendRoot, COLLECTION_TEMPLATE } from '@marxy/core/src/index-model/collection.ts';
import { basename, dirname, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { isUntitled, NO_FOLDER_YET } from '../document/untitled.ts';
import { collectionFile, collectionOf, isFilesystemRoot } from '../collection/load.ts';
import { COLLECTION_SAYS, type Said } from '../notices/config-copy.ts';
import { notify } from '../notices/index.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const say = (said: Said | string): void => {
  notify(typeof said === 'string' ? { kind: 'refused', text: said } : said);
};

const notFound = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'not-found';

/** Appends the open document's repository root to collection.toml, creating the file if absent. */
async function addThisFolder(): Promise<void> {
  const handle = appHandle();
  const path = handle?.currentPath() ?? null;
  if (!handle || path === null) return;
  if (isUntitled(path)) return say(NO_FOLDER_YET);
  await addRoot(await handle.index.rootFor(path));
}

/** Asks for a folder with the system's picker and adds it; cancelling adds nothing and says nothing. */
async function addChosenFolder(): Promise<void> {
  const picked = await appHandle()?.shell.openDialog?.({ directory: true });
  const folder = picked?.[0];
  if (folder !== undefined) await addRoot(folder);
}

/** Appends `folder` to collection.toml as a place, creating the file if absent. */
async function addRoot(folder: string): Promise<void> {
  const handle = appHandle();
  if (!handle) return;
  const shell = handle.shell;
  const file = await collectionFile(shell);
  if (file === undefined || !shell.configPaths) {
    say(COLLECTION_SAYS.noConfigAdd());
    return;
  }
  const root = normalizePath(folder);
  if (isFilesystemRoot(root)) {
    say(COLLECTION_SAYS.wholeDisk());
    return;
  }
  // Marxy's own config and data folders hold its state (trust, positions, snapshots): never indexed.
  const paths = await shell.configPaths();
  const own = [dirname(paths.config), paths.data === '' ? '' : normalizePath(paths.data)].filter((d) => d !== '');
  if (own.some((dir) => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`))) {
    say(COLLECTION_SAYS.ownFolder());
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(file);
  } catch (e) {
    if (!notFound(e)) {
      say(COLLECTION_SAYS.readFailed(e));
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
    say(COLLECTION_SAYS.notChanged(e));
    return;
  }
  if (next === bytes) {
    say(COLLECTION_SAYS.already());
    return;
  }
  try {
    await shell.writeFileAtomic(file, next);
  } catch (e) {
    say(COLLECTION_SAYS.writeFailed(e));
    return;
  }
  // Not left to the collection.toml watch: the Library redraws when this resolves, and must show the place.
  await collectionOf(handle)?.reload();
  say(COLLECTION_SAYS.added(basename(root)));
}

/** Opens collection.toml (written from the template first when absent) in Source. */
async function editCollection(): Promise<void> {
  const handle = appHandle();
  if (!handle) return;
  const shell = handle.shell;
  const file = await collectionFile(shell);
  if (file === undefined) {
    say(COLLECTION_SAYS.noConfigEdit());
    return;
  }
  try {
    await shell.readFile(file);
  } catch (e) {
    if (!notFound(e)) {
      say(COLLECTION_SAYS.editReadFailed(e));
      return;
    }
    try {
      await shell.writeFileAtomic(file, new TextEncoder().encode(COLLECTION_TEMPLATE));
    } catch (w) {
      say(COLLECTION_SAYS.createFailed(w));
      return;
    }
  }
  // Over unsaved edits the open waits for the reader's choice: Source is shown only once collection.toml is
  // the document, never on the one still on screen.
  await handle.open(file, { onLanded: () => void handle.jumpToSource(0) });
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
      id: 'collection.add-place',
      title: 'Add a folder to the Library…',
      group: 'app',
      when: () => appHandle()?.shell.openDialog !== undefined,
      unavailable: () => (appHandle()?.shell.openDialog === undefined ? 'This window has no folder picker: add the folder in collection.toml' : null),
      run: async (ctx) => {
        ctx.closePalette();
        await addChosenFolder();
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
