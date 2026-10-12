// The words of the notices the collection and kind commands, the layout restore and the disk-conflict choice say, each
// with the kind it is (U-02.1). One template (X-21 ruling 10): what happened · what is unchanged · what to do. A part
// that has nothing to say is left out, never padded. Nothing here claims a write that did not happen: an outcome says what
// was written, and every refusal and failure says the file is as it was.
import type { NoticeKind } from './index.ts';

/** A notice's kind and its words, said by `notify`. */
export interface Said {
  readonly kind: NoticeKind;
  readonly text: string;
}

/** The parts of a notice, in the template's order, joined as the other notices join them. */
export function said(happened: string, unchanged?: string, todo?: string): string {
  return [happened, unchanged, todo].filter((p): p is string => p !== undefined && p !== '').join(' · ');
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** collection.toml: the two palette commands of C-14. */
export const COLLECTION_SAYS = {
  noConfigAdd: (): Said => ({
    kind: 'refused',
    text: said('Not added to the collection: this build keeps no configuration folder', 'collection.toml is unchanged'),
  }),
  noConfigEdit: (): Said => ({
    kind: 'refused',
    text: said('Collection not opened: this build keeps no configuration folder', 'nothing was changed'),
  }),
  wholeDisk: (): Said => ({
    kind: 'refused',
    text: said('Not added to the collection: this is a whole disk, too large to index', 'collection.toml is unchanged', 'Open a document in a smaller folder.'),
  }),
  ownFolder: (): Said => ({
    kind: 'refused',
    text: said("Not added to the collection: this folder holds Marxy's own settings and state", 'collection.toml is unchanged'),
  }),
  readFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml could not be read (${String(e)})`, 'it is unchanged', 'Check that the file can be read, then try again.'),
  }),
  notChanged: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml was not changed: ${why(e)}`, 'the file is exactly as you left it', 'Fix it with Edit collection, then try again.'),
  }),
  already: (): Said => ({ kind: 'info', text: said('Already in the collection', 'collection.toml is unchanged') }),
  writeFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml could not be written (${String(e)})`, 'it is unchanged', 'Check that the folder can be written to, then try again.'),
  }),
  added: (name: string): Said => ({ kind: 'done', text: said(`Added ${name} to the collection`) }),
  editReadFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml could not be read (${String(e)})`, 'it is unchanged', 'Check that the file can be read, then try again.'),
  }),
  createFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml could not be created (${String(e)})`, 'nothing was written', 'Check that the configuration folder can be written to, then try again.'),
  }),
} as const;

/** kinds.json and config.toml: *Show as* and *Always open this folder as* (K-04). */
export const KIND_SAYS = {
  quarantined: (): Said => ({
    kind: 'error',
    text: said('kinds.json could not be read', 'the old file was kept beside it and a fresh one started', 'Your earlier "Show as" choices are in the kept copy.'),
  }),
  noDataFolder: (): Said => ({
    kind: 'refused',
    text: said('Not changed: this build keeps no data folder, so a choice of kind cannot be kept', 'the file is shown as before'),
  }),
  newerKinds: (): Said => ({
    kind: 'refused',
    text: said('Not changed: kinds.json was written by a newer Marxy', 'the file is unchanged', 'Update Marxy to change it.'),
  }),
  nothingToForget: (): Said => ({ kind: 'refused', text: said('Nothing to forget: this file has no chosen kind', 'nothing was changed') }),
  refusedShowAs: (notice: string): Said => ({ kind: 'refused', text: notice }),
  updateFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`kinds.json could not be updated (${String(e)})`, 'nothing was changed', 'Check that the data folder can be written to, then try again.'),
  }),
  forgotten: (): Said => ({ kind: 'done', text: said('This file is read as detected, or by its folder rule') }),
  shownAs: (kind: string): Said => ({ kind: 'done', text: said(`This file is shown as ${kind}`) }),
  reopenFailed: (path: string, e: unknown): Said => ({
    kind: 'error',
    text: said(`The choice was kept, but ${path} could not be opened again (${String(e)})`, 'the file on screen is as it was', 'Open the file again to see the choice.'),
  }),
  noConfigFolder: (): Said => ({
    kind: 'refused',
    text: said('Rule not added: this build keeps no configuration folder', 'config.toml is unchanged'),
  }),
  configReadFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`config.toml could not be read (${String(e)})`, 'nothing was changed', 'Check that the file can be read, then try again.'),
  }),
  configNotChanged: (e: unknown): Said => ({
    kind: 'error',
    text: said(`config.toml was not changed: ${why(e)}`, 'the file is exactly as you left it', 'Fix it in Source, then try again.'),
  }),
  folderAlready: (kind: string): Said => ({ kind: 'info', text: said(`This folder is already opened as ${kind}`, 'config.toml is unchanged') }),
  configWriteFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`config.toml could not be written (${String(e)})`, 'nothing was changed', 'Check that the file can be written to, then try again.'),
  }),
  folderRule: (kind: string): Said => ({ kind: 'done', text: said(`Files in this folder open as ${kind}`) }),
} as const;

/** A column of the saved layout that could not come back (a refusal: the layout is put back without it). */
export function layoutLeftOut(name: string, gone: boolean): string {
  return said(
    gone ? `${name} is no longer there` : `${name} could not be read`,
    'it was left out of the layout; your other documents are unchanged',
    'Open it again to bring it back.',
  );
}

/** What resolving a disk conflict did (V-07). Both are outcomes the reader chose. */
export function conflictCopySaved(copyName: string, stillDirty: boolean): Said {
  return {
    kind: 'done',
    text: said(
      `Your version was saved as ${copyName}`,
      stillDirty ? 'the file is gone from disk; your text is still open here' : 'this file now shows what is on disk',
    ),
  };
}

export const CONFLICT_DISCARDED: Said = {
  kind: 'done',
  text: said('Your unsaved edits were discarded and cannot be brought back with Undo', 'this file now shows what is on disk'),
};

export const CONFLICT_COPY_FAILED = (reason: string): Said => ({
  kind: 'error',
  text: said(`Could not save a copy: ${reason.replace(/\.$/, '')}`, 'nothing was changed; your edits are still here', 'Try again, or save somewhere else.'),
});
