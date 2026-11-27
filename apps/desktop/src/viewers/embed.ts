// A small reading of some bytes inside another page: an archive's preview, and later a
// sheet's tile. Made by the functions the pane itself uses, so a preview can never disagree with the opened tab: a text
// kind is core's own page (a reading, Markdown through the one allow-list, code through the code parse and the pane's
// highlighter) in an `article` wearing that kind's look; any other kind is the very viewer a tab makes (`createViewer`),
// drawn in the embed's host with no pane of its own. Nothing is written, fetched or run: a picture a Markdown entry names
// is its alt text, a link is followed only to another entry of the archive (the page hears `EMBED_LINK`), an HTML
// entry is the safe page with scripts off, a notebook's outputs are as saved.
import { KIND_HEAD_BYTES, PAGE_VIEWERS, detectKind, fileTypeFor } from '@marxy/core';
import { ENTRY_OPEN_CAP, shortSize } from '@marxy/core/src/viewer/archive.ts';
import { magicOf, textTest } from '@marxy/core/src/viewer/bytes.ts';
import { resolve } from '@marxy/theme';
import type { AppShell } from '../app-types.ts';
import { entryGone, entrySignals, heldEntry } from '../document/entries.ts';
import { el } from '../frame/dom.ts';
import { lookContext } from '../look/painted.ts';
import { lookState, looksOn } from '../look/store.ts';
import { readingParts, readingRoot } from '../parts/reading-parts.ts';
import { fillEmbedPage } from '../render/embed-page.ts';
import type { PaneViewer, PartUnit } from './types.ts';

export { EMBED_LINK } from '../render/embed-page.ts';

export interface Embed {
  readonly el: HTMLElement;
  /** Its parts, addressed from the entry: the archive splices them under the entry's unit. */
  parts(): readonly PartUnit[];
  destroy(): void;
}

export interface EmbedOptions {
  /** Already the entry's shell (`entryShell`). */
  readonly shell: AppShell;
  /** An `archive-entry:` path, held. */
  readonly path: string;
  /** False: only its beginning is held, and the embed says how far it read. */
  readonly whole: boolean;
  readonly host: HTMLElement;
  /** `mini`: inert, no parts, for a tile. */
  readonly size: 'page' | 'mini';
  /** What a part that opens should do. */
  open(): void;
}

/** A tile's text is its opening: the rest of a long entry is not needed in the DOM. */
const MINI_BYTES = 8 * 1024;

const sizeWords = (n: number): string => (n >= 1024 && n < 1024 * 1024 && n % 1024 === 0 ? `${n / 1024} KB` : shortSize(n));

/** The sentence over an entry held only in part: how far it was read, and why no further. */
export function farWords(read: number, size: number): string {
  const first = `The first ${sizeWords(read)} of ${shortSize(size)}`;
  return size > ENTRY_OPEN_CAP
    ? `${first}. It is over ${shortSize(ENTRY_OPEN_CAP)}, so it does not open in a tab: this is how far it is read.`
    : `${first}: o opens all of it in a tab.`;
}

/** The look the entry's kind wears, on `target`: the pane's painter's rule, applied to an element inside a page. */
function paintLook(target: HTMLElement, kind: string, path: string): void {
  target.setAttribute('data-marxy-kind', kind);
  if (!looksOn()) return;
  const r = resolve(lookState(), { ...lookContext(), kind, path, width: target.clientWidth || 640 });
  for (const [k, v] of Object.entries(r.tokens)) target.style.setProperty(k, v);
  target.setAttribute('data-marxy-look', r.look.id);
  target.setAttribute('data-marxy-scheme', r.scheme);
  if (r.look.para === 'indent' && r.subject === 'prose') target.setAttribute('data-marxy-look-para', 'indent');
  if (r.tokens['--marxy-justify'] === '1') target.setAttribute('data-marxy-look-align', 'justify');
}

/** Bytes that are not text: a format's magic, or a NUL near the start. */
const isBinary = (bytes: Uint8Array): boolean => bytes.length > 0 && (magicOf(bytes.subarray(0, 8192)) !== null || textTest(bytes.subarray(0, 8192)).nul > 0);

export async function createEmbed(o: EmbedOptions): Promise<Embed> {
  const root = el('div', o.size === 'mini' ? 'marxy-embed marxy-embed-mini' : 'marxy-embed');
  if (o.size === 'mini') root.inert = true;
  o.host.append(root);
  let viewer: PaneViewer | null = null;
  let units: readonly PartUnit[] | null = null;
  let partsOf: () => readonly PartUnit[] = () => [];
  let dead = false;
  const embed: Embed = {
    el: root,
    parts: () => (o.size === 'mini' ? [] : (units ??= partsOf())),
    destroy() {
      dead = true;
      viewer?.destroy();
      viewer = null;
      root.remove();
    },
  };
  const done = (): Embed => embed;

  const held = heldEntry(o.path);
  if (!held) {
    root.append(el('p', 'marxy-embed-note', entryGone(o.path)));
    return done();
  }
  const name = held.name;
  const all = held.bytes;
  if (!o.whole && o.size === 'page') root.append(el('p', 'marxy-embed-note', farWords(all.length, held.size ?? all.length)));
  const binary = isBinary(all);
  const type = fileTypeFor(name);
  // A kind a viewer draws (or one whose name says so, whatever text it holds): the tab's own viewer. A message, a page
  // and an SVG are text the viewer is handed; everything else it reads through the entry's shell.
  const textual = !binary && (type.viewer === 'mail' || type.viewer === 'html' || type.viewer === 'image' || (type.viewer === 'office' && /\.rtf$/i.test(name)) || type.id === 'certificate');
  if (binary || textual || PAGE_VIEWERS.has(type.viewer)) {
    const box = el('div', 'marxy-embed-viewer');
    root.append(box);
    // An archive held only in part goes to its viewer all the same, whose card says why it is not listed.
    try {
      if (binary && !o.whole && type.viewer !== 'archive') {
        // Its beginning alone is no picture, PDF or database: the bytes are what can be shown of it.
        const [{ createCardViewer }, { gatherFile }] = await Promise.all([import('./card.ts'), import('./file.ts')]);
        viewer = createCardViewer({ shell: o.shell, file: await gatherFile(o.shell, o.path, entrySignals(o.path)) });
      } else {
        const { createViewer } = await import('./index.ts');
        viewer = await createViewer({ shell: o.shell, path: o.path, signals: entrySignals(o.path), paneHost: o.host, text: textual ? () => all : undefined, embed: { open: () => o.open() } });
      }
    } catch (err) {
      // A viewer is made by reading the entry through its shell, which may take a while (a font's facts, a database's
      // tables): the page may go meanwhile and its preview pool let the entry go. The embed says so; it never rejects.
      if (!dead) box.append(el('p', 'marxy-embed-note', err instanceof Error ? err.message : String(err)));
      return done();
    }
    if (dead) {
      viewer.destroy();
      viewer = null;
      return done();
    }
    viewer.show('rendered', box);
    const v = viewer;
    partsOf = () => {
      const tree = v.parts?.('rendered') ?? null;
      // A page drawn a window at a time (the bytes) makes its parts as they are asked for: none to splice.
      return tree && !tree.sibling ? tree.top() : [];
    };
    return done();
  }

  // A text kind: the pane's own page of it.
  const bytes = o.size === 'mini' ? all.subarray(0, MINI_BYTES) : all;
  const kind = detectKind({ path: name, head: bytes.subarray(0, KIND_HEAD_BYTES) }).kind;
  const page = el('div', 'marxy-embed-text');
  const article = el('article', 'marxy-article');
  page.append(article);
  root.append(page);
  paintLook(page, kind, name);
  const { code } = await fillEmbedPage(article, name, bytes, kind);
  partsOf = () => {
    const root0 = (readingRoot(article) as HTMLElement | null) ?? (code ? article.querySelector<HTMLElement>('pre.marxy-run') : article);
    if (!root0) return [];
    const tree = readingParts({ article, root: root0, path: name, bytes, readOnly: true, xray: () => {}, startAt: (u) => u[0] ?? null });
    return tree?.top() ?? [];
  };
  return done();
}
