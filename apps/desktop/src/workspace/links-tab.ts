// The inspector's Links tab (W-09): for the focused document, every link in the text as written, and every path the text
// names with whether it exists. Pure parts first (`linksOf`, `resolveMentioned`), then `mountLinksTab`.
//
// Nothing here is fetched or opened: an external destination is drawn as text, never as an anchor, and a path is looked at
// with `shell.stat` only. A file that opens in Source and has not been parsed (`store.parsed()` false) is never parsed for
// this: its paths are listed from the bytes and the link list says why it is absent (V-11.1). Backlinks are not here.
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import type { Document, Inline, Link, Node } from '@marxy/core/src/contracts/ast.ts';
import { linkHostMismatchLabel } from '@marxy/core/src/render/link-host.ts';
import { pathMentions } from '@marxy/core/src/transforms/extract.ts';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { AppHandle } from '../app.ts';
import type { DocumentStore } from '../document/store.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import type { InspectorContext, InspectorTab } from './inspector.ts';

/** One link of the document: the text as written, the real target, and where it starts (a byte offset). */
export interface LinkEntry {
  readonly text: string;
  readonly url: string;
  readonly start: number;
  readonly end: number;
  /** The host the destination really has, when the text names a different one (commitment 4). */
  readonly mismatch: string | null;
}

const textOf = (nodes: readonly Inline[]): string =>
  nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code' || n.type === 'html' || n.type === 'mathInline') return n.value;
      if (n.type === 'image') return n.alt;
      if (n.type === 'softBreak' || n.type === 'hardBreak') return ' ';
      return 'children' in n ? textOf((n as { children: readonly Inline[] }).children) : '';
    })
    .join('');

/** The links of `ast` in document order. No DOM; a link inside a table cell or a list item is found like any other. */
export function linksOf(ast: Document): LinkEntry[] {
  const out: LinkEntry[] = [];
  walk(ast, (node: Node) => {
    if (node.type !== 'link') return;
    const link = node as Link;
    const text = textOf(link.children).trim();
    out.push({ text, url: link.url, start: link.src.start, end: link.src.end, mismatch: linkHostMismatchLabel(text, link.url)?.text ?? null });
  });
  return out;
}

export type Mentioned = 'found' | 'not-found' | 'not-checked';

interface FileStat {
  readonly isDir?: boolean;
}
export type StatFn = (path: string) => Promise<FileStat | null>;

const join = (dir: string, rest: string): string => {
  const out: string[] = dir.split('/').filter((p) => p !== '');
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
};

/**
 * Whether a path the text names exists. It is looked for beside the document and in its repository root (`~/` in the
 * home folder). `stat` answers null for a path that is missing and also for a symlink and a deny-listed folder, so a
 * missing file is called "not found" only when every folder above it is a real, listed one; otherwise nothing is claimed:
 * "not checked". A `~/` path with no known home, and a path that climbs out of its base, are not checked either.
 */
export async function resolveMentioned(path: string, docPath: string, root: string, home: string | null, stat: StatFn): Promise<Mentioned> {
  let bases: string[];
  let rest = path;
  let limit = root; // nothing above it is looked at: the document's repository root (or folder), or the home folder
  if (path.startsWith('~/')) {
    if (home === null) return 'not-checked';
    bases = [home];
    limit = home;
    rest = path.slice(2);
  } else {
    bases = [...new Set([dirname(docPath), root])];
  }
  let checkable = true;
  for (const base of bases) {
    const target = join(base, rest);
    if (target === limit || !target.startsWith(limit === '/' ? '/' : `${limit}/`)) {
      checkable = false; // climbs out of what is ours to look at
      continue;
    }
    try {
      if ((await stat(target)) !== null) return 'found';
      // Missing, or hidden by a link or the deny list: only a listed chain of folders makes it "missing".
      const names = target.slice(limit === '/' ? 1 : limit.length + 1).split('/');
      let at = limit;
      let listed = (await stat(limit))?.isDir === true;
      for (const name of names.slice(0, -1)) {
        if (!listed) break;
        at = join(at, name);
        listed = (await stat(at))?.isDir === true;
      }
      if (!listed) checkable = false;
    } catch {
      checkable = false;
    }
  }
  return checkable ? 'not-found' : 'not-checked';
}

/** What the tab shows for one document state. */
export interface LinksModel {
  /** Null for a store that has not been parsed: Links are listed for Markdown. */
  readonly links: readonly LinkEntry[] | null;
  readonly paths: readonly string[];
}

/** Reads `store` without ever making its parse: the AST only when `parsed()` already says it exists. */
export function linksModelOf(store: DocumentStore): LinksModel {
  const snap = store.snapshot();
  const paths = pathMentions(snap.buffer.text.replace(/\r\n?/g, '\n'));
  return { links: store.parsed() ? linksOf(snap.ast) : null, paths };
}

const MAX_PATHS = 60;
const STATUS: Record<Mentioned, string> = { found: 'found', 'not-found': 'not found', 'not-checked': 'not checked' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function mountLinksTab(host: HTMLElement, ctx: InspectorContext): () => void {
  const handle: AppHandle = ctx.handle;
  const body = el('div', 'marxy-links');
  host.append(body);
  let home: Promise<string | null> | null = null;
  const homeOf = (): Promise<string | null> =>
    (home ??= (handle.shell.configPaths?.() ?? Promise.resolve(null)).then((p) => (p ? inferHomeFromConfig(p.config) : null)).catch(() => null));

  let drawnKey = '';
  let token = 0;
  let unsubscribeStore: (() => void) | null = null;
  let watched: DocumentStore | null = null;

  const draw = (): void => {
    if (!ctx.visible()) return;
    const pane = handle.panes().focused;
    const store = pane.content.store();
    const path = pane.path();
    if (watched !== store) {
      unsubscribeStore?.();
      watched = store;
      unsubscribeStore = store ? store.subscribe(() => draw()) : null;
    }
    if (!store || path === null) {
      drawnKey = '';
      token++;
      body.replaceChildren(el('p', 'marxy-links-empty', 'No document is open.'));
      return;
    }
    const snap = store.snapshot();
    const parsed = store.parsed();
    const key = `${path}\0${snap.version}\0${parsed}`;
    if (key === drawnKey) return;
    drawnKey = key;
    const mine = ++token;
    const model = linksModelOf(store);
    const root = handle.imageRoot(path);
    const rows = model.paths.slice(0, MAX_PATHS);

    const sections: HTMLElement[] = [];
    const heading = (text: string, id: string): HTMLElement => {
      const h = el('h3', 'marxy-links-heading', text);
      h.id = `marxy-links-${id}-${mine}`;
      return h;
    };

    // Links, as written.
    const linkSection = el('section', 'marxy-links-section');
    if (model.links === null) {
      linkSection.append(heading('Links', 'links'), el('p', 'marxy-links-empty', 'Links are listed for Markdown'));
    } else {
      linkSection.append(heading(`Links (${model.links.length})`, 'links'));
      if (model.links.length === 0) linkSection.append(el('p', 'marxy-links-empty', 'No links in this document.'));
      const list = el('ul', 'marxy-links-list');
      list.setAttribute('aria-labelledby', `marxy-links-links-${mine}`);
      for (const link of model.links) {
        const item = el('li', 'marxy-links-item');
        const row = el('button', 'marxy-link-row');
        row.type = 'button';
        row.tabIndex = -1;
        row.setAttribute('data-marxy-link-row', 'link');
        const label = link.text === '' ? '(no text)' : link.text;
        const name = el('span', 'marxy-link-text', label);
        const dest = el('span', 'marxy-link-dest', link.url);
        row.append(name, dest);
        let accessible = `${label}, goes to ${link.url}`;
        if (link.mismatch !== null) {
          row.append(el('span', 'marxy-link-mismatch', `goes to ${link.mismatch}`));
          accessible += `. Warning: the text names a different site; it goes to ${link.mismatch}`;
        }
        row.setAttribute('aria-label', accessible);
        row.title = link.url;
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => void handle.open(path, { at: link.start }));
        item.append(row);
        list.append(item);
      }
      linkSection.append(list);
    }
    sections.push(linkSection);

    // Paths the text names, then each looked at.
    const pathSection = el('section', 'marxy-links-section');
    pathSection.append(heading(`Paths mentioned (${model.paths.length})`, 'paths'));
    if (rows.length === 0) pathSection.append(el('p', 'marxy-links-empty', 'No paths are named in this document.'));
    const statuses: HTMLElement[] = [];
    const plist = el('ul', 'marxy-links-list');
    plist.setAttribute('aria-labelledby', `marxy-links-paths-${mine}`);
    for (const p of rows) {
      const item = el('li', 'marxy-links-item');
      const row = el('div', 'marxy-link-row');
      row.tabIndex = -1;
      row.setAttribute('data-marxy-link-row', 'path');
      row.setAttribute('aria-label', `${p}, checking`);
      const status = el('span', 'marxy-link-status', 'checking');
      row.append(el('span', 'marxy-link-text', p), status);
      statuses.push(status);
      item.append(row);
      plist.append(item);
    }
    if (rows.length > 0) pathSection.append(plist);
    if (model.paths.length > rows.length) pathSection.append(el('p', 'marxy-links-empty', `${model.paths.length - rows.length} more not listed.`));
    sections.push(pathSection);

    body.replaceChildren(...sections);
    const stat: StatFn = (p) => handle.shell.stat(p);
    void homeOf().then(async (h) => {
      for (let i = 0; i < rows.length; i++) {
        const result = await resolveMentioned(rows[i]!, path, root, h, stat).catch((): Mentioned => 'not-checked');
        if (token !== mine) return;
        statuses[i]!.textContent = STATUS[result];
        statuses[i]!.setAttribute('data-marxy-link-status', result);
        statuses[i]!.parentElement!.setAttribute('aria-label', `${rows[i]}, ${STATUS[result]}`);
      }
    });
  };

  const offSignal = ctx.signal.onChange(draw);
  const offShown = ctx.onShown(draw);
  // Rendered's first parse (V-11.1) is not a store transition: the mode attribute is the cue to look again.
  const modeWatch = new MutationObserver(draw);
  modeWatch.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  draw();
  return () => {
    token++;
    offSignal();
    offShown();
    modeWatch.disconnect();
    unsubscribeStore?.();
    body.remove();
  };
}

export const LINKS_TAB: InspectorTab = { id: 'links', title: 'Links', mount: mountLinksTab };
