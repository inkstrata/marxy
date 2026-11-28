// A folder as a page: everything on disk in it as rows, how each file would be read by its name, and at the foot one
// folded line for what search leaves out here and why. A folder that is mostly images starts each row with its picture
// (folder-pictures.ts). It is an app page (app-page.ts), as a folder is no file; it is read with readDir when it opens,
// and nothing is written. A file's row opens the file; a folder's opens that folder's page.
import { folderOrder } from '@marxy/core/src/index-model/folder-order.ts';
import { DENY_DIRECTORY_NAMES, isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { viewerOf } from '@marxy/core/src/kind/registry.ts';
import type { FileStat } from '@marxy/shell-api';
import type { AppHandle } from '../app-types.ts';
import { openAppPage } from './app-page.ts';
import { el, plural } from './dom.ts';
import { folderPictures, imageWords, isImageFolder } from './folder-pictures.ts';
import { modifiedWords } from './model/metadata.ts';
import { leftOutWhy, readAsWords } from './model/places.ts';

const count = (n: number): string => n.toLocaleString('en-GB');

const dateWords = (ms: number): string => (ms ? modifiedWords(ms) : '');

/** Opens `dir`'s page over the page area, in place of any other app page. */
/** Why a folder could not be listed, in words: a drive's or a share's own root is never read as a whole. */
export function folderUnread(dir: string, e: unknown): string {
  if ((e as { code?: unknown } | null)?.code === 'outside') {
    return `${dir} is a drive's or a share's own root, which Marxy does not read as a whole · open a folder inside it`;
  }
  return `This folder could not be read · ${e instanceof Error ? e.message : String(e)}`;
}

/** The open folder page's pictures, stopped when the page closes or lists another folder. */
let stopPictures: (() => void) | null = null;

export async function openFolderPage(handle: AppHandle, dir: string): Promise<void> {
  stopPictures?.();
  stopPictures = null;
  const page = openAppPage(`folder:${dir}`, `${basename(dir)}/`, { wide: true });
  const { column } = page;
  const parent = dirname(dir);
  const crumbs = page.crumb;
  crumbs.replaceChildren(`${basename(dir)}/`);
  if (parent && parent !== dir) {
    const up = el('button', 'marxy-btn', `${parent}/`);
    up.type = 'button';
    up.dataset.marxyBtn = 'link';
    up.addEventListener('click', () => void openFolderPage(handle, parent));
    crumbs.replaceChildren('in ', up, ` · ${basename(dir)}/`);
  }
  const title = el('h1', 'marxy-apppage-title', `${basename(dir)}/`);
  column.replaceChildren(title, el('p', 'marxy-dnote', 'Reading the folder…'));
  let stats: readonly FileStat[];
  try {
    // Opening a folder as a page is the reader's choice of it: the shell reads it once told (read-only).
    await handle.shell.markOpened?.(dir, 'root').catch(() => undefined);
    stats = await handle.shell.readDir(dir);
  } catch (e) {
    column.replaceChildren(title, el('p', 'marxy-apppage-lead', folderUnread(dir, e)));
    return;
  }
  if (!column.isConnected) return;
  const entries = folderOrder(stats);
  let files = 0;
  let folders = 0;
  let bytes = 0;
  let out = 0;
  let foldersOut = 0;
  const unread: string[] = [];
  /** Files search does not read here, by why: `binary` and the rest. */
  const skippedBy = new Map<string, number>();
  // A folder of images lists its pictures; what Read as and Size said goes on a line under each name.
  const pictured = isImageFolder(entries);
  const pictures = pictured ? folderPictures(handle.shell, column.closest('.marxy-apppage')) : null;
  if (pictures) {
    const stop = (): void => {
      pictures.dispose();
      if (stopPictures === stop) stopPictures = null;
    };
    stopPictures = stop;
    page.onClose(stop);
  }
  if (pictured) await handle.shell.allowAssetScope(dir).catch(() => {});
  if (!column.isConnected) return;
  const table = el('table', pictured ? 'marxy-folderpage-table marxy-folderpage-pictures' : 'marxy-folderpage-table');
  const head = el('tr');
  for (const h of pictured ? ['', 'Name', 'Modified'] : ['Name', 'Read as', 'Size', 'Modified']) {
    const th = el('th', h === 'Size' ? 'marxy-num' : '', h);
    if (h === '') th.setAttribute('aria-label', 'Picture');
    head.append(th);
  }
  table.append(head);
  for (const stat of entries) {
    const name = basename(stat.path);
    const tr = el('tr', 'marxy-folderpage-row');
    tr.tabIndex = 0;
    const nameCell = el('td', 'marxy-folderpage-name', stat.isDir ? `${name}/` : name);
    let words: string;
    let why: string | null;
    if (stat.isDir) {
      folders++;
      why = leftOutWhy(name);
      if (why) foldersOut++;
      words = 'folder';
    } else {
      files++;
      bytes += stat.size;
      const r = readAsWords(stat.path);
      words = r.words;
      why = r.skipped;
      if (r.skipped !== null) {
        unread.push(name);
        skippedBy.set(r.skipped, (skippedBy.get(r.skipped) ?? 0) + 1);
      }
    }
    if (why) out++;
    const date = el('td', '', dateWords(stat.mtimeMs));
    if (pictures) {
      const facts = el('span', 'marxy-folderpage-why', stat.isDir ? words : viewerOf(stat.path) === 'image' ? imageWords(stat) : `${words} · ${plural(stat.size, 'byte', 'bytes')}`);
      nameCell.append(facts);
      tr.append(pictures.cell(stat, facts), nameCell, date);
    } else {
      // Why a row is left out is said once, in the fold at the foot; the row is only quieter.
      if (why) tr.classList.add('marxy-dim');
      tr.append(nameCell, el('td', 'marxy-folderpage-read', words), el('td', 'marxy-num', stat.isDir ? '' : `${count(stat.size)} B`), date);
    }
    const go = (): void => {
      if (stat.isDir) {
        void openFolderPage(handle, stat.path);
        return;
      }
      page.close();
      void handle.open(stat.path);
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    table.append(tr);
  }
  const facts = el(
    'p',
    'marxy-apppage-lead',
    `${plural(entries.length, 'entry', 'entries')} on disk: ${plural(files, 'file', 'files')} and ${plural(folders, 'folder', 'folders')} · ${count(bytes)} bytes here · ${out ? `${count(out)} left out of search` : 'everything here is searched'}`,
  );
  // Why search leaves anything out here, rule by rule, and what each leaves out of this folder now.
  const names = entries.map((s) => basename(s.path));
  const rules = el('table', 'marxy-folderpage-rules');
  const rule = (from: string, what: string, hits: readonly string[]): void => {
    const tr = el('tr');
    const res = el('td', 'marxy-folderpage-res', hits.length ? `leaves out ${hits.join(', ')}` : 'matches nothing here now');
    tr.append(el('td', '', from), el('td', '', what), res);
    rules.append(tr);
  };
  const dirs = new Set(entries.filter((s) => s.isDir).map((s) => basename(s.path)));
  rule('Folders of tools and builds', DENY_DIRECTORY_NAMES.join(', '), names.filter((n) => dirs.has(n) && isDeniedName(n)));
  rule('Dot folders', 'a name that starts with a dot, unless Settings says to search dot folders', names.filter((n) => dirs.has(n) && n.startsWith('.') && !isDeniedName(n)));
  rule('Kinds of file', 'search reads text: Markdown, prose, code, logs, patches and data; never binaries', unread);
  const said = [foldersOut ? plural(foldersOut, 'folder', 'folders') : '', out - foldersOut ? plural(out - foldersOut, 'file', 'files') : ''].filter(Boolean);
  // The reading page's fold key, with a state of its own: the rules open here, not on every page's account.
  const fold = el('div', 'marxy-account marxy-account-own marxy-folderpage-fold');
  const key = el('button', 'marxy-account-key', `Search leaves out ${said.length ? said.join(' and ') : 'nothing'} here`);
  key.type = 'button';
  key.setAttribute('aria-expanded', 'false');
  key.addEventListener('click', () => key.setAttribute('aria-expanded', String(key.getAttribute('aria-expanded') !== 'true')));
  const body = el('div', 'marxy-account-body');
  body.append(
    rules,
    ...[...skippedBy].map(([why, n]) => el('p', 'marxy-dnote', `${plural(n, 'file', 'files')} not searched: ${why}`)),
    el('p', 'marxy-dnote', 'Left-out files are still on disk and open like any other: search only does not look in them.'),
  );
  fold.append(key, body);
  column.replaceChildren(title, facts, entries.length ? table : el('p', 'marxy-dnote', 'Nothing is on disk here.'), fold);
}
