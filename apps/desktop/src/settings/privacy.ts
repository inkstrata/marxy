// The Settings page's Privacy lists, computed from the code and not written as a promise (W-12, ADR-0075; commitment 2 of AGENTS.md:
// "every privacy promise names what that action sends and to whom").
//
// Two lists. *Stored on this Mac*: every file Marxy keeps, with its path, its size and what it holds, read from the folders themselves
// (nothing here writes). *What can leave this Mac*: every reader action that sends something, with what it sends and to whom, and
// the calls of `shell-api` each one stands on. `privacy.test.ts` holds those calls equal to the shell's network-capable ones, and
// holds every other member of the `Shell` interface in `LOCAL_ONLY_CALLS`, so a call added to the shell without a row here fails the
// test. "Nothing else leaves this Mac" is `NOTHING_ELSE`, and is drawn only beside that table.
import type { AppShell } from '../app.ts';

/** The sentence the page ends the list with. It is true while `privacy.test.ts` passes. */
export const NOTHING_ELSE = 'Nothing else leaves this Mac.';

export interface LeaveRow {
  readonly id: string;
  /** The reader action. */
  readonly action: string;
  /** The members of `Shell` (`packages/shell-api/src/index.ts`) this action goes through. */
  readonly calls: readonly string[];
  /**
   * Whether the desktop shell implements the calls today. `false`: the contract names the call and the page says plainly that the action
   * is not there yet, so a reader is told what it will send before it exists. `privacy.test.ts` reads `shell/tauri.ts` and fails when
   * this is not true, either way.
   */
  readonly built: boolean;
  /** What is sent. */
  readonly sends: string;
  /** To whom. */
  readonly to: string;
}

/**
 * Each reader action that can send something off this Mac. A row is a reader action: Marxy opens no connection of its own, and the
 * webview has no network (ADR-0027, `scripts/gate-no-network.mjs`).
 */
export const LEAVES_THIS_MAC: readonly LeaveRow[] = [
  {
    id: 'open-link',
    action: 'Opening a link',
    calls: ['openExternal'],
    built: true,
    sends: 'The address of the link, and nothing of the document. Only http, https and mailto addresses are opened.',
    to: 'The system, which opens it in your default browser or mail app. Marxy sends nothing itself.',
  },
  {
    id: 'remote-image',
    action: 'Allowing a remote image',
    calls: ['fetchRemoteImage'],
    built: false,
    sends: 'Nothing today: remote images stay blocked (ADR-0044). When you can allow one, it will be a request for the image\u2019s address over https, with no cookies, no Referer and no document text, made only after you allow that image in that document.',
    to: 'The server that hosts the image, which would see your IP address and the address asked for.',
  },
  {
    id: 'clipboard',
    action: 'Copying to the clipboard',
    calls: ['clipboardWrite', 'clipboardWriteItem'],
    built: true,
    sends: 'What you copied, as plain text, HTML or rich text. Marxy marks copies it makes as its own, and asks clipboard managers to skip those it marks transient.',
    to: 'The macOS pasteboard. Any app can read it, and your other Apple devices can if Universal Clipboard is on.',
  },
];

/**
 * Every other call of `shell-api`: each is local to this Mac (a file in a folder you open, a dialog, a window). A new call has to be
 * placed here or in `LEAVES_THIS_MAC` before `privacy.test.ts` passes, which is the check that it was thought about.
 * `revealInExternalEditor` runs the program you named as `external_editor` on a file path: what that program does is its own.
 */
export const LOCAL_ONLY_CALLS: readonly string[] = [
  'readFile', 'writeFileAtomic', 'writeFileNew', 'stat', 'readHead', 'watch', 'listRoot', 'fuzzy', 'repositoryRoot', 'openDialog',
  'revealInExternalEditor', 'clipboardTypes', 'clipboardRead', 'assetUrl', 'onOpenFiles', 'platform', 'startupMarks', 'args', 'mark',
  'quit', 'readDir', 'realPath', 'setTitle', 'setWindowControls', 'imageSize', 'webkitVersion', 'configPaths', 'allowAssetScope',
  'saveDialog', 'onCloseRequested', 'confirmClose', 'searchContent',
];

export interface FileKind {
  readonly id: string;
  /** The name, or the pattern for a family of files (`versions-<sha1>.json`). */
  readonly name: string;
  readonly folder: 'config' | 'data';
  readonly holds: string;
  /** Whether a file name in the folder belongs to this row. */
  readonly matches: (name: string) => boolean;
  /** For a family of files: which of them stands for one item (a snapshot, a file's manifest), and how many items are said. */
  readonly family?: { readonly item: (name: string) => boolean; readonly say: (items: number) => string };
}

/** Marxy's own files, in the order the page lists them. Documents are never among them. */
export const STORED_FILES: readonly FileKind[] = [
  { id: 'config', name: 'config.toml', folder: 'config', holds: 'Your settings. The one file this page writes, one line at a time.', matches: (n) => n === 'config.toml' },
  { id: 'collection', name: 'collection.toml', folder: 'config', holds: 'The folders Marxy searches besides the one you are in, and your saved queries.', matches: (n) => n === 'collection.toml' },
  { id: 'positions', name: 'positions.json', folder: 'data', holds: 'Where you stopped reading each file, by path. Up to 5,000 paths.', matches: (n) => n === 'positions.json' },
  { id: 'history', name: 'history.json', folder: 'data', holds: 'Files you opened, what you pinned and the folders you used recently, by path. Up to 500 opens.', matches: (n) => n === 'history.json' },
  { id: 'trust', name: 'trust.json', folder: 'data', holds: 'What you allowed for a file: its HTML, and the hosts of its images. Up to 2,000 paths.', matches: (n) => n === 'trust.json' },
  { id: 'workspace', name: 'workspace.json', folder: 'data', holds: 'Which panels are docked and which sidebar sections are folded.', matches: (n) => n === 'workspace.json' },
  { id: 'layout', name: 'layout.json', folder: 'data', holds: 'The split you left: the files in it, the ratio and which side had focus.', matches: (n) => n === 'layout.json' },
  { id: 'kinds', name: 'kinds.json', folder: 'data', holds: 'How you chose to show a file (Show as), by path.', matches: (n) => n === 'kinds.json' },
  {
    id: 'index',
    name: 'index-<id>.json',
    folder: 'data',
    holds: 'Titles, headings and paths of the files in a folder Marxy indexed, one snapshot per folder. Not the documents.',
    matches: (n) => /^index-[0-9a-f]+\.json$/.test(n),
    family: { item: () => true, say: (n) => `${n} ${n === 1 ? 'folder' : 'folders'}` },
  },
  {
    id: 'versions',
    name: 'versions-<id>.json and its slots',
    folder: 'data',
    holds: 'Byte-exact copies of files you read and save: up to 20 per file, for 30 days, 200 MB in all, oldest first. Never sent anywhere.',
    matches: (n) => /^versions-[0-9a-f]+(\.json|-\d\d)$/.test(n),
    // One manifest per file that has versions; its slots hold the copies.
    family: { item: (n) => n.endsWith('.json'), say: (n) => `of ${n} ${n === 1 ? 'file' : 'files'}` },
  },
];

export interface StoredFile {
  readonly kind: FileKind;
  /** The folder it lives in. */
  readonly folder: string;
  /** Files of this kind found, and their bytes together; 0 and 0 when none is written yet. */
  readonly count: number;
  readonly bytes: number;
  /** For a family: how many of its items there are (see `FileKind.family`); else the count. */
  readonly items: number;
}

type StoredShell = Pick<AppShell, 'readDir' | 'configPaths'>;

const trimDir = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p);
const dirname = (p: string): string => {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut > 0 ? p.slice(0, cut) : cut === 0 ? '/' : p;
};

/**
 * Looks in the two folders and reports each of Marxy's files, read-only: one `readDir` of each, names and sizes, no file opened. A folder
 * that cannot be listed reports its files as not written; the page says so.
 */
export async function storedOnThisMac(shell: StoredShell): Promise<readonly StoredFile[]> {
  const paths = shell.configPaths === undefined ? null : await shell.configPaths().catch(() => null);
  if (paths === null) return [];
  const folders = { config: dirname(paths.config), data: trimDir(paths.data) };
  // config.toml is whatever the shell says the config file is called; the rest are Marxy's own names.
  const configName = paths.config.split(/[\\/]/).pop() ?? 'config.toml';
  const listing = async (dir: string): Promise<readonly { readonly path: string; readonly size: number; readonly isDir: boolean }[]> =>
    shell.readDir(dir).catch(() => []);
  const [inConfig, inData] = [await listing(folders.config), folders.data === folders.config ? null : await listing(folders.data)];
  const within = (which: 'config' | 'data') => (which === 'config' ? inConfig : (inData ?? inConfig));
  return STORED_FILES.map((listed) => {
    const kind = listed.id === 'config' ? { ...listed, name: configName, matches: (n: string) => n === configName } : listed;
    const found = within(kind.folder).filter((f) => !f.isDir && kind.matches(f.path.split(/[\\/]/).pop() ?? ''));
    const items = kind.family ? found.filter((f) => kind.family!.item(f.path.split(/[\\/]/).pop() ?? '')).length : found.length;
    return { kind, folder: folders[kind.folder], count: found.length, bytes: found.reduce((n, f) => n + f.size, 0), items };
  });
}

/** `1.2 KB`, `340 B`, `18.0 MB`. */
export function bytesText(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The path of a stored file, or of a family of them (the name keeps its `<id>`). */
export function pathOf(file: StoredFile): string {
  return `${file.folder.replace(/\/+$/, '')}/${file.kind.name}`;
}
