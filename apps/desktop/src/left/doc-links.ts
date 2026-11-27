// Where a file's links and written paths lead, against the files here (the index's, and every open file), and which other
// files name this one ("Pointing here"), looked for with the shell's content search when asked and kept only by the
// window's `rev`. Links come from the parse (`frame/model/links`), written paths from core's rule (`pathMentions`) over the
// same parse, the store's: nothing here parses the file again.
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { fileTypeOf, isMarkdownPath } from '@marxy/core/src/kind/registry.ts';
import { pathMentions, pathMentionsIn } from '@marxy/core/src/transforms/extract.ts';
import type { AppHandle } from '../app-types.ts';
import type { DocumentStore } from '../document/store.ts';
import { linksSoon } from '../frame/model/links.ts';
import { linesNaming, placeLinks, resolveFrom, tokenAround, type PlacedLink } from './doc-model.ts';
import { lineOfByte, lineStarts } from './doc-shared.ts';
import type { PaneView } from './types.ts';

export interface FileLinks {
  readonly all: readonly PlacedLink[];
  readonly markdown: boolean;
}

const kept = new Map<string, { sig: string; v: FileLinks | null }>();

/** What one version of a store's text says, found once: its links and written paths, by line. Where they lead is not here: that depends on the files here. */
interface Said {
  readonly version: number;
  readonly markdown: boolean;
  readonly links: readonly { readonly url: string; readonly line: number }[];
  readonly written: readonly { readonly w: string; readonly line: number }[];
}
const said = new WeakMap<DocumentStore, Said>();

/** The files here: every path the index holds, and every file open in a pane. */
export function filesHere(handle: AppHandle): Set<string> {
  const set = new Set<string>();
  for (const e of handle.index.entries()) set.add(e.path);
  for (const p of handle.panes().panes) {
    const path = p.path();
    if (path !== null) set.add(path);
  }
  return set;
}

/** The links of `pane`'s file, placed; undefined while a large page's links are still being found; null for no text. */
export function linksOfPane(handle: AppHandle, pane: PaneView, path: string): FileLinks | null | undefined {
  const viewer = pane.content.viewer();
  if (viewer?.owns(pane.view.mode)) return null;
  const store = pane.content.store();
  if (!store) return null;
  const snap = store.snapshot();
  const here = filesHere(handle);
  const sig = `${snap.version}:${snap.buffer.bytes.length}:${here.size}`;
  const hit = kept.get(path);
  if (hit && hit.sig === sig) return hit.v;
  const s = saidOf(store, path);
  if (s === undefined) return undefined;
  const v: FileLinks = {
    markdown: s.markdown,
    all: placeLinks({ docPath: path, links: s.links, written: s.written, has: (p) => here.has(p), roots: handle.index.roots() }),
  };
  kept.set(path, { sig, v });
  if (kept.size > 40) kept.delete(kept.keys().next().value!);
  return v;
}

/**
 * The links and written paths of the store's current text, found once per version: a file opening elsewhere or the index
 * changing does not find them again. Undefined while a large page's links are still being found.
 */
function saidOf(store: DocumentStore, path: string): Said | undefined {
  const snap = store.snapshot();
  const held = said.get(store);
  if (held && held.version === snap.version) return held;
  const markdown = store.parsed();
  const found = markdown ? linksSoon(store) : [];
  if (found === undefined) return undefined;
  const starts = lineStarts(snap.buffer);
  const text = snap.buffer.text.replace(/\r\n?/g, '\n');
  let mentions: string[];
  if (!markdown) mentions = pathMentionsIn(text.split('\n'));
  else {
    // The store's parse, with the text it is of: LF Markdown lends it with `textParse`; a Markdown file with CR line ends
    // has its parse read over its own text (core checks the two agree). Only text the store parsed some other way (a
    // code file, a byte the decode replaced) is parsed here, as Markdown, for its written paths.
    const pair = store.textParse() ?? (isMarkdownPath(path) ? { text: snap.buffer.text, doc: snap.ast } : null);
    mentions = pair ? pathMentions(pair.text, pair.doc) : pathMentions(text);
  }
  const s: Said = {
    version: snap.version,
    markdown,
    links: (found ?? []).map((l) => ({ url: l.url, line: lineOfByte(starts, l.start) })),
    written: linesNaming(text, mentions),
  };
  said.set(store, s);
  return s;
}

/** How many links and written paths the file has, for Metadata's row; null while they are being found or for no text. */
export function linkCount(handle: AppHandle, pane: PaneView, path: string): number | null {
  const l = linksOfPane(handle, pane, path);
  return l ? l.all.length : null;
}

export interface Inbound {
  readonly from: string;
  readonly line: number;
  readonly w: string;
}

interface InboundEntry {
  rev: number;
  v: Promise<readonly Inbound[] | 'failed'>;
  done: readonly Inbound[] | 'failed' | null;
}

const inbound = new Map<string, InboundEntry>();

const TEXTISH = /\.(md|markdown|mdx|txt|rst|adoc|org|ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|c|h|cc|cpp|cs|swift|php|sh|toml|ya?ml|json|jsonl|xml|html?|css|scss|log|csv|tsv|ini|cfg|conf|sql|tex|patch|diff|ipynb)$/i;
/** A file that may write a path to this one: every Markdown page and prose name the registry knows, and the text above. */
const linksFrom = (path: string): boolean => isMarkdownPath(path) || fileTypeOf(path)?.reading === 'prose' || TEXTISH.test(path);

/**
 * The places in other files here that name `path`: the shell's content search for its name over the files here, each hit
 * kept only when the written path around it leads to `path` from the file it is in. Null until worked out; `redraw` is
 * called when it is. 'failed' when the search failed: said once, and the next call looks again.
 */
export function pointingHere(handle: AppHandle, path: string, rev: number, redraw: () => void): readonly Inbound[] | 'failed' | null {
  const have = inbound.get(path);
  if (have && have.rev === rev) {
    if (have.done === 'failed') inbound.delete(path);
    return have.done;
  }
  const name = basename(path);
  const roots = handle.index.roots();
  const files = [...filesHere(handle)].filter((p) => p !== path && linksFrom(p));
  const entry: InboundEntry = { rev, v: Promise.resolve([]), done: null };
  entry.v = (async (): Promise<readonly Inbound[]> => {
    if (!handle.shell.searchContent || files.length === 0 || name === '') return [];
    const found = await handle.shell.searchContent(files, name, { roots: roots.length ? roots : [dirname(path)], limit: 400, perFile: 20 });
    const out: Inbound[] = [];
    for (const hit of found.hits) {
      const w = tokenAround(hit.preview, hit.matchStart, hit.matchEnd);
      const target = w.replace(/[#:].*$/, '').replace(/^\(|\)$/g, '');
      const leads = target === name ? dirname(hit.path) === dirname(path) : resolveFrom(hit.path, target, roots).includes(path);
      if (leads) out.push({ from: hit.path, line: hit.line, w });
    }
    return out;
  })().catch((): 'failed' => 'failed');
  void entry.v.then((v) => {
    entry.done = v;
    if (inbound.get(path) === entry) redraw();
  });
  inbound.set(path, entry);
  if (inbound.size > 20) inbound.delete(inbound.keys().next().value!);
  return null;
}
