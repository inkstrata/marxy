// The inspector's Links tab: for the focused document, every link in the text as written, and every path the text
// names with whether it exists. Pure parts first (`linksOf`, `resolveMentioned`), then `mountLinksTab`.
//
// Nothing here is fetched or opened: an external destination is drawn as text, never as an anchor, and a path is looked at
// with `shell.stat` only. A file that opens in Source and has not been parsed (`store.parsed()` false) is never parsed for
// this: the link list says why it is absent. Backlinks are not here.
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import type { Document, Inline, Link, Node } from '@marxy/core/src/contracts/ast.ts';
import { linkHostMismatchLabel } from '@marxy/core/src/render/link-host.ts';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { DocumentStore } from '../../document/store.ts';
import { linksFound } from './links-found.ts';

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

const linksByAst = new WeakMap<Document, readonly LinkEntry[]>();

/** `linksOf` once per parse: a redraw of the panel for the same document is not a second walk. */
function linksFor(ast: Document): readonly LinkEntry[] {
  let links = linksByAst.get(ast);
  if (links === undefined) linksByAst.set(ast, (links = linksOf(ast)));
  return links;
}

/** Pages past this find their links after the page is painted, so the panel's first draw does not walk them first. */
const LINKS_NOW_BYTES = 256 * 1024;
const pending = new WeakSet<Document>();

/**
 * The links of `store` for the Links card: now, when its page is small or they were found already; else undefined, and
 * they are found once the page is painted, when `onLinksFound` hears of it. Null when the store has not been parsed.
 */
export function linksSoon(store: DocumentStore): readonly LinkEntry[] | null | undefined {
  if (!store.parsed()) return null;
  const snap = store.snapshot();
  const held = linksByAst.get(snap.ast);
  if (held !== undefined || snap.buffer.bytes.length <= LINKS_NOW_BYTES) return held ?? linksFor(snap.ast);
  if (!pending.has(snap.ast)) {
    pending.add(snap.ast);
    const ast = snap.ast;
    // After the next frame is painted, then a turn of its own.
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 0);
    frame(() =>
      setTimeout(() => {
        linksFor(ast);
        linksFound();
      }, 0),
    );
  }
  return undefined;
}
