// The words of the notices the collection and kind commands, the layout restore and the disk-conflict choice say, each
// with the kind it is (U-02.1). One template (X-21 ruling 10): what happened · what is unchanged · what to do. A part
// that has nothing to say is left out, never padded. Nothing here claims a write that did not happen: an outcome says what
// was written, and every refusal and failure says the file is as it was.
import { notify as defaultNotify, type NoticeInput, type NoticeKind } from './index.ts';

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
    text: said('This build keeps no configuration folder, so there is no collection to add to', 'collection.toml is unchanged'),
  }),
  noConfigEdit: (): Said => ({
    kind: 'refused',
    text: said('This build keeps no configuration folder, so there is no collection to edit', 'nothing was changed'),
  }),
  wholeDisk: (): Said => ({
    kind: 'refused',
    text: said('This is a whole disk, too large to index, so it was not added to the collection', 'collection.toml is unchanged', 'Open a document in a smaller folder.'),
  }),
  ownFolder: (): Said => ({
    kind: 'refused',
    text: said("This folder holds Marxy's own settings and state, so it was not added to the collection", 'collection.toml is unchanged'),
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

/** collection.toml: *Save as smart collection* and *Edit in collection.toml* (Q-07). Every refusal says the file is as it was. */
export const SMART_SAYS = {
  noConfig: (): Said => ({
    kind: 'refused',
    text: said('This build keeps no configuration folder, so a smart collection cannot be saved', 'nothing was changed'),
  }),
  readFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml could not be read (${String(e)})`, 'it is unchanged', 'Check that the file can be read, then try again.'),
  }),
  noName: (): Said => ({
    kind: 'refused',
    text: said('A smart collection needs a name, so it was not saved', 'collection.toml is unchanged', 'Type a name, then save again.'),
  }),
  noTerms: (): Said => ({
    kind: 'refused',
    text: said('The search has no terms yet, so it was not saved', 'collection.toml is unchanged', 'Type a search in the library, then save it.'),
  }),
  duplicate: (name: string): Said => ({
    kind: 'refused',
    text: said(`A smart collection named "${name}" already exists, so this one was not saved`, 'collection.toml is unchanged', 'Choose another name.'),
  }),
  notToml: (): Said => ({
    kind: 'refused',
    text: said('collection.toml cannot be read as TOML, so the smart collection was not saved', 'the file is exactly as you left it', 'Fix it with Edit collection, then try again.'),
  }),
  notSaved: (e: unknown): Said => ({
    kind: 'refused',
    text: said(`The smart collection was not saved: ${why(e).replace(/\.$/, '')}`, 'collection.toml is unchanged', 'Fix it, then save again.'),
  }),
  stale: (): Said => ({
    kind: 'refused',
    text: said('collection.toml changed on disk while you were naming this, so the smart collection was not saved', 'the file is unchanged by this save', 'Save again to add it to the file as it is now.'),
  }),
  writeFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`The smart collection could not be saved (${String(e)})`, 'collection.toml is unchanged', 'Check that the folder can be written to, then try again.'),
  }),
  saved: (name: string): Said => ({ kind: 'done', text: said(`Saved "${name}" as a smart collection`) }),
  noConfigEdit: (): Said => ({
    kind: 'refused',
    text: said('This build keeps no configuration folder, so there is no collection.toml to edit', 'nothing was changed'),
  }),
  editReadFailed: (e: unknown): Said => ({
    kind: 'error',
    text: said(`collection.toml could not be read (${String(e)})`, 'it is unchanged', 'Check that the file can be read, then try again.'),
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
    text: said('This build keeps no data folder, so a choice of kind cannot be kept', 'the file is shown as before'),
  }),
  newerKinds: (): Said => ({
    kind: 'refused',
    text: said('kinds.json was written by a newer Marxy', 'the file is unchanged', 'Update Marxy to change it.'),
  }),
  nothingToForget: (): Said => ({ kind: 'refused', text: said('This file has no chosen kind to forget', 'nothing was changed') }),
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
    text: said('This build keeps no configuration folder, so a rule cannot be added', 'config.toml is unchanged'),
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
  text: said('You took the version on disk', 'your unsaved edits were discarded and Undo cannot bring them back', 'This file now shows what is on disk.'),
};

export const CONFLICT_COPY_FAILED = (reason: string): Said => ({
  kind: 'error',
  text: said(`Could not save a copy: ${reason.replace(/\.$/, '')}`, 'nothing was changed; your edits are still here', 'Try again, or save somewhere else.'),
});

// K-07.1: `[strip]` and `[[kind]]` parse warnings of config.toml, shown once.

const MAX_SHOWN = 3;
const FIX = 'fix it in config.toml';

/** The refusal text for one parser warning, or null when it is not about `[strip]` or `[[kind]]`. Said in plain words, not the parser's. */
export function configWarningText(warning: string): string | null {
  const rule = /^kind (\d+) (.*)$/.exec(warning);
  if (rule !== null) {
    const [, n, rest] = rule;
    const label = `[[kind]] rule ${n}`;
    let m: RegExpExecArray | null;
    if (/^is not a table/.test(rest!)) return `${label} is not a table, so it is skipped · the other rules apply · ${FIX}`;
    if (/^has no glob/.test(rest!)) return `${label} has no glob, so it is skipped · the other rules apply · ${FIX}`;
    if ((m = /^\(glob "(.*)"\) is(?: "(.*)")? not one of the kinds/.exec(rest!)) !== null) {
      const named = m[2] === undefined ? 'has no kind named in is' : `names "${m[2]}", which is not a kind`;
      return `${label} (glob "${m[1]}") ${named}, so it is skipped · the other rules apply · ${FIX}`;
    }
    if ((m = /^glob "(.*)" is not an absolute path/.exec(rest!)) !== null) {
      return `${label} has a glob ("${m[1]}") that is not an absolute path or one opening with **, so it is skipped · the other rules apply · ${FIX}`;
    }
    if (/^read was not true or false/.test(rest!)) return `${label} has a read that is not true or false, so read is ignored · the rest of the rule applies · ${FIX}`;
    return `${label} is skipped · the other rules apply · ${FIX}`;
  }
  const dropped = /^more than (\d+) kind rules; kind (\d+) dropped$/.exec(warning);
  if (dropped !== null) return `[[kind]] rule ${dropped[2]} is dropped, since only ${dropped[1]} rules are read · the first ${dropped[1]} apply · ${FIX}`;
  if (warning.startsWith('kind must be')) return `[[kind]] is not a list of tables, so it is ignored · no kind rules apply · ${FIX}`;
  if (warning.startsWith('strip must be')) return `[strip] is not a table of kind = [tools], so it is ignored · every strip keeps its default tools · ${FIX}`;
  let m: RegExpExecArray | null;
  if ((m = /^strip\.(.+?) is not one of the kinds/.exec(warning)) !== null) return `[strip] ${m[1]} is not a kind, so the entry is ignored · the other entries apply · ${FIX}`;
  if ((m = /^strip\.(.+?) must be a list of tool names/.exec(warning)) !== null) return `[strip] ${m[1]} is not a list of tool names, so the entry is ignored · the other entries apply · ${FIX}`;
  if ((m = /^strip\.(.+?): "(.*)" is not a tool/.exec(warning)) !== null) return `[strip] ${m[1]} lists "${m[2]}", which is not a tool, so that tool is left out · the other tools apply · ${FIX}`;
  if ((m = /^strip\.(.+?): "(.*)" is listed twice/.exec(warning)) !== null) return `[strip] ${m[1]} lists "${m[2]}" twice, so the repeat is left out · the other tools apply · ${FIX}`;
  if ((m = /^strip\.(.+?) lists more than (\d+) tools/.exec(warning)) !== null) return `[strip] ${m[1]} lists more than ${m[2]} tools, so the rest are left out · the first ${m[2]} apply · ${FIX}`;
  return null;
}

/**
 * Shows each `[strip]` / `[[kind]]` warning of a config read as a `refused` notice. The same set of warnings read again
 * (a reload of an unchanged file) shows nothing; a changed set shows afresh; a clean read forgets. Nothing is written.
 */
export function createConfigWarningReporter(notify: (input: NoticeInput) => unknown = defaultNotify): (warnings: readonly string[]) => void {
  let shown = '';
  return (warnings) => {
    const texts = warnings.map(configWarningText).filter((t): t is string => t !== null);
    const signature = texts.join('\n');
    if (signature === shown) return;
    shown = signature;
    for (const text of texts.slice(0, MAX_SHOWN)) notify({ kind: 'refused', text });
    if (texts.length > MAX_SHOWN) {
      notify({ kind: 'refused', text: `${texts.length - MAX_SHOWN} more problems in config.toml, in [strip] or [[kind]] · the rest of config.toml applies · fix them in config.toml, and any still wrong show when it is next read` });
    }
  };
}

/** The reporter the app uses: one per page, so a re-read of an unchanged config.toml stays quiet. */
export const reportConfigWarnings = createConfigWarningReporter();
