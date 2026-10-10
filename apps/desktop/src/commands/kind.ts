// Palette commands for how a file is read (K-04, ADR-0060 item 9): *Show as* for the open file, kept in
// `kinds.json` in Marxy's data directory, and *Always open this folder as*, a `[[kind]]` table appended to
// `config.toml` without touching another byte. No dialog, no settings page, no key. Neither writes to the
// document. A file's kind is decided once when it opens (item 6): the choice takes effect the next time the
// file is opened (K-05 reads `kinds.json` and the rules at open; K-07's chip reopens it).
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
import { notify } from '../notices/index.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const say = (text: string): void => {
  notify({ kind: 'info', text });
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
    // Keep the bad bytes beside it, start empty: the app opens (design 11).
    await shell.writeFileAtomic(quarantinePathFor(file), loaded.quarantineBytes);
    await shell.writeFileAtomic(file, serializeKindsFile(loaded.envelope));
    say('kinds.json could not be read; it was kept aside and a fresh one started.');
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
  const shell = handle.shell;
  if (!shell.configPaths) {
    say('This build keeps no data folder, so a choice of kind cannot be kept.');
    return;
  }
  const { data } = await shell.configPaths();
  if (data === '') {
    say('This build keeps no data folder, so a choice of kind cannot be kept.');
    return;
  }
  const file = joinPath(data, 'kinds.json');
  try {
    const kinds = await loadKinds(shell, file);
    if (kinds === null) {
      say('kinds.json was written by a newer Marxy, so it was not changed.');
      return;
    }
    let next: KindsEnvelope;
    if (kind === undefined) {
      if (showAsFor(kinds, path) === undefined) {
        say('This file has no chosen kind to forget.');
        return;
      }
      next = clearShowAs(kinds, path);
    } else {
      const result = setShowAs(kinds, path, kind);
      if (!result.ok) {
        say(result.notice);
        return;
      }
      next = result.envelope;
    }
    await shell.writeFileAtomic(file, serializeKindsFile(next));
  } catch (e) {
    say(`kinds.json could not be updated (${String(e)}); nothing was changed.`);
    return;
  }
  say(kind === undefined ? 'This file will be read as detected, or by its folder rule, when next opened.' : `This file will open as ${kind}.`);
}

/** Appends a `[[kind]]` rule for the open document's folder to config.toml, creating the file if absent. */
async function alwaysOpenFolderAs(kind: Kind): Promise<void> {
  const handle = appHandle();
  const path = handle?.currentPath() ?? null;
  if (!handle || path === null) return;
  const shell = handle.shell;
  if (!shell.configPaths) {
    say('This build keeps no configuration folder, so a rule cannot be added.');
    return;
  }
  const { config } = await shell.configPaths();
  if (config === '') {
    say('This build keeps no configuration folder, so a rule cannot be added.');
    return;
  }
  const home = inferHomeFromConfig(config);
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(config);
  } catch (e) {
    if (!notFound(e)) {
      say(`config.toml could not be read (${String(e)}); nothing was changed.`);
      return;
    }
    bytes = new Uint8Array(0);
  }
  const folder = dirname(path);
  let next: Uint8Array;
  try {
    next = appendKindRule(bytes, { glob: folderKindGlob(folder, home), is: kind }, { home });
  } catch (e) {
    // Unparseable, not a list of tables, or a rule already there: the file is the reader's, left as it is.
    say(`config.toml was not changed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (next === bytes) {
    say(`This folder is already opened as ${kind}.`);
    return;
  }
  try {
    await shell.writeFileAtomic(config, next);
  } catch (e) {
    say(`config.toml could not be written (${String(e)}); nothing was changed.`);
    return;
  }
  say(`Files in this folder will open as ${kind}.`);
}

const hasDocument = (): boolean => appHandle()?.currentPath() != null;

export function kindCommands(): readonly Command[] {
  return [
    ...KINDS.map((kind): Command => ({
      id: `kind.show-as.${kind}`,
      title: `Show this file as ${kind}`,
      group: 'document',
      when: hasDocument,
      run: async (ctx) => {
        ctx.closePalette();
        await showAs(kind);
      },
    })),
    {
      id: 'kind.show-as.detected',
      title: 'Show this file as detected',
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
