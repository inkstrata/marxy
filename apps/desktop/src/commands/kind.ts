// Palette commands for how a file is read: *Show as* for the open file, kept in
// `kinds.json` in Marxy's data directory, and *Always open this folder as*, a `[[kind]]` table appended to
// `config.toml` without touching another byte. No dialog, no settings page, no key. Neither writes to the
// document. A file's kind is decided once when it opens, so a choice that was written reopens the open file
// at once and it takes effect now: `AppHandle.open` is the same path an ordinary open takes, so unsaved
// edits meet its own prompt and the chip adds none. A choice that could not be written reopens nothing.
import { isUntitled, NO_FOLDER_YET } from '../document/untitled.ts';
import { KINDS } from '@marxy/core/src/contracts/kinds.ts';
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import { dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import {
  clearShowAs,
  emptyKindsEnvelope,
  folderKindGlob,
  parseKindsFile,
  quarantinePathFor,
  serializeKindsFile,
  setShowAs,
  showAsFor,
} from '@marxy/core/src/kind/show-as.ts';
import type { KindsEnvelope } from '@marxy/core/src/kind/show-as.ts';
import { appendKindRule } from '@marxy/theme/src/config.ts';
import { KIND_SAYS, type Said } from '../notices/config-copy.ts';
import { notify } from '../notices/index.ts';
import { kindChipCommands } from './kind-chip.ts';
import { editConfig } from '../theme/reader-config.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { appHandle } from './app-handle.ts';
import { readReaderKinds } from '../index/reader-kinds.ts';
import type { Command } from './registry.ts';

const say = (said: Said | string): void => {
  notify(typeof said === 'string' ? { kind: 'refused', text: said } : said);
};

const notFound = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'not-found';

/** kinds.json in the data directory, read with its quarantine and version guard; null for a newer file. */
async function loadKinds(
  shell: NonNullable<ReturnType<typeof appHandle>>['shell'],
  file: string,
): Promise<KindsEnvelope | null> {
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(file);
  } catch (e) {
    if (notFound(e)) return emptyKindsEnvelope();
    throw e;
  }
  const loaded = parseKindsFile(bytes);
  if (loaded.kind === 'quarantined') {
    // Keep the bad bytes beside it, start empty: the app opens.
    await shell.writeFileAtomic(quarantinePathFor(file), loaded.quarantineBytes);
    await shell.writeFileAtomic(file, serializeKindsFile(loaded.envelope));
    say(KIND_SAYS.quarantined());
    return loaded.envelope;
  }
  if (loaded.newerVersion) return null;
  return loaded.envelope;
}

/** Records or forgets *show as* for the open file. `kind` undefined forgets. */
async function showAs(kind: Kind | undefined): Promise<void> {
  const handle = appHandle();
  const path = handle?.currentPath() ?? null;
  if (!handle || path === null) return;
  if (isUntitled(path)) return say(NO_FOLDER_YET);
  const shell = handle.shell;
  if (!shell.configPaths) {
    say(KIND_SAYS.noDataFolder());
    return;
  }
  const { data } = await shell.configPaths();
  if (data === '') {
    say(KIND_SAYS.noDataFolder());
    return;
  }
  const file = joinPath(data, 'kinds.json');
  try {
    const kinds = await loadKinds(shell, file);
    if (kinds === null) {
      say(KIND_SAYS.newerKinds());
      return;
    }
    let next: KindsEnvelope;
    if (kind === undefined) {
      if (showAsFor(kinds, path) === undefined) {
        say(KIND_SAYS.nothingToForget());
        return;
      }
      next = clearShowAs(kinds, path);
    } else {
      const result = setShowAs(kinds, path, kind);
      if (!result.ok) {
        say(KIND_SAYS.refusedShowAs(result.notice));
        return;
      }
      next = result.envelope;
    }
    await shell.writeFileAtomic(file, serializeKindsFile(next));
  } catch (e) {
    say(KIND_SAYS.updateFailed(e));
    return;
  }
  say(kind === undefined ? KIND_SAYS.forgotten() : KIND_SAYS.shownAs(kind));
  await reopen(handle, path);
}

/**
 * The kind is decided at open, so a choice takes effect by opening the file again (the same path as any open). Show as is
 * the file's, not a pane's: every pane showing it opens it again, so two panes on one file read it alike (their shared
 * store is parsed again under the choice, `DocumentStore.rechoose`).
 */
async function reopen(handle: NonNullable<ReturnType<typeof appHandle>>, path: string): Promise<void> {
  // The index decides kinds as Open does: it hears of the choice too, without a walk.
  void readReaderKinds(handle.shell).then((kinds) => handle.index.setKinds(kinds));
  const { panes, focused } = handle.panes();
  const others = panes.filter((pane) => pane !== focused && pane.path() === path);
  try {
    await handle.open(path);
    for (const pane of others) if (pane.path() === path) await pane.content.open(path);
  } catch (e) {
    say(KIND_SAYS.reopenFailed(path, e));
  }
}

/** Appends a `[[kind]]` rule for the open document's folder to config.toml, creating the file if absent. */
async function alwaysOpenFolderAs(kind: Kind): Promise<void> {
  const handle = appHandle();
  const path = handle?.currentPath() ?? null;
  if (!handle || path === null) return;
  if (isUntitled(path)) return say(NO_FOLDER_YET);
  const shell = handle.shell;
  if (!shell.configPaths) {
    say(KIND_SAYS.noConfigFolder());
    return;
  }
  const { config } = await shell.configPaths();
  if (config === '') {
    say(KIND_SAYS.noConfigFolder());
    return;
  }
  const home = inferHomeFromConfig(config);
  const folder = dirname(path);
  // One read-modify-write on editConfig's queue, so a Settings change made at the same moment is not lost to this one.
  let refusal: unknown;
  let changed = false;
  let edited = false;
  try {
    await editConfig(
      shell,
      (bytes) => {
        edited = true;
        try {
          const next = appendKindRule(bytes, { glob: folderKindGlob(folder, home), is: kind }, { home });
          changed = next !== bytes;
          return next;
        } catch (e) {
          // Unparseable, not a list of tables, or a rule already there: the file is the reader's, left as it is.
          refusal = e;
          return bytes;
        }
      },
      {},
    );
  } catch (e) {
    say(edited ? KIND_SAYS.configWriteFailed(e) : KIND_SAYS.configReadFailed(e));
    return;
  }
  if (refusal !== undefined) {
    say(KIND_SAYS.configNotChanged(refusal));
    return;
  }
  if (!changed) {
    say(KIND_SAYS.folderAlready(kind));
    return;
  }
  say(KIND_SAYS.folderRule(kind));
  await reopen(handle, path);
}

const hasDocument = (): boolean => appHandle()?.currentPath() != null;

export function kindCommands(): readonly Command[] {
  return [
    ...kindChipCommands(),
    ...KINDS.map((kind): Command => ({
      id: `kind.show-as.${kind}`,
      title: `Read this file as ${kind}`,
      group: 'document',
      when: hasDocument,
      run: async (ctx) => {
        ctx.closePalette();
        await showAs(kind);
      },
    })),
    {
      id: 'kind.show-as.detected',
      title: 'Read this file as Marxy would',
      group: 'document',
      when: hasDocument,
      run: async (ctx) => {
        ctx.closePalette();
        await showAs(undefined);
      },
    },
    ...KINDS.map((kind): Command => ({
      id: `kind.folder.${kind}`,
      title: `Always open this folder as ${kind}`,
      group: 'app',
      when: hasDocument,
      run: async (ctx) => {
        ctx.closePalette();
        await alwaysOpenFolderAs(kind);
      },
    })),
  ];
}
