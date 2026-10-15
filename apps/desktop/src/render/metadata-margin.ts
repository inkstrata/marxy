// The margin preview (W-17, ruling 21; mock-v2 01-workspace "Metadata"): `⌃⌘I` or *Show metadata* puts a quiet block in Read's empty
// left margin, beside the first line: the front matter's keys and values, then the modified date and the size, in small chrome
// type, sticky as the page scrolls, with *More…* opening the inspector's Metadata tab. Where the margin is too narrow (Split, Source,
// a window or a text size that leaves less than `MIN_ROOM`) the same command opens the tab instead. Off, Read is what it always was.
//
// Nothing is ever placed above or inside the text (ADR-0070, F-45): the block is a zero-height sticky layer that is the pane's first
// child, so it takes no room in the column's flow, and its content is positioned in the margin beside the first line. It is made
// when the preview is on and there is room, and taken out when either stops being so. It is the app's, not the document's: it holds
// the file's facts as text (never markup), and clicking nothing in it changes a byte.
//
// Pure parts first (`previewRows`, `roomNeeded`), then `installMetadataMargin`, called from `workspace/fill.ts`.
import type { FrontMatterValues } from '@marxy/core/src/operations/front-matter-value.ts';
import type { AppHandle } from '../app.ts';
import { isUntitled } from '../document/untitled.ts';
import { selectInspectorTab } from '../workspace/inspector.ts';
import { frontMatterOf, modifiedWords } from '../workspace/metadata-tab.ts';
import { formatCount } from '../source/frame-facts.ts';
import type { DocumentSignal } from '../workspace/toolbar.ts';
import { notify } from '../notices/index.ts';

/** The most rows the preview draws, the facts below the front matter among them (the mock's 14). */
export const PREVIEW_MAX_ROWS = 14;
/** The margin the preview needs to be drawn, at the default 13 px chrome; it scales with the chrome size. */
export const MIN_ROOM = 230;

/** The room (px) a margin needs for the chrome size in force. */
export function roomNeeded(chromePx: number): number {
  return Math.round((MIN_ROOM * chromePx) / 13);
}

export interface PreviewRow {
  readonly key: string;
  readonly value: string;
}

/**
 * The rows: each front-matter key with its value (a longer value by its first line), then Modified and Size; at most `max`, the
 * front matter giving way first. `more` counts the keys left out.
 */
export function previewRows(values: FrontMatterValues | null, facts: readonly PreviewRow[], max = PREVIEW_MAX_ROWS): { rows: PreviewRow[]; more: number } {
  const keys = values?.values ?? [];
  const room = Math.max(0, max - facts.length);
  const shown = keys.slice(0, room).map((v): PreviewRow => {
    const line = v.value.split('\n', 1)[0]!;
    return { key: v.key, value: v.value.includes('\n') ? `${line} …` : line };
  });
  return { rows: [...shown, ...facts], more: Math.max(0, keys.length - shown.length) };
}

export interface MetadataMargin {
  /** Whether the preview is on (it may be on and not drawn, where there is no room). */
  readonly on: boolean;
  /** `⌃⌘I`: turns the preview off, or on where there is room, else opens the Metadata tab. */
  toggle(): Promise<void>;
  /** Opens the inspector on the Metadata tab (the preview's *More…*). */
  openTab(): Promise<void>;
}

const controllers = new WeakMap<AppHandle, MetadataMargin>();

/** The margin preview's controller for `handle`, once `installMetadataMargin` has run. */
export function metadataMargin(handle: AppHandle | null | undefined): MetadataMargin | undefined {
  return handle ? controllers.get(handle) : undefined;
}

const px = (value: string): number => Number.parseFloat(value) || 0;

/** The room (px) to the left of the first block of text in `pane`'s page, or 0 when there is no Rendered page to speak of. */
export function marginRoom(host: HTMLElement): number {
  if (host.getAttribute('data-marxy-mode') !== 'rendered') return 0;
  const article = host.querySelector<HTMLElement>(':scope > .marxy-article');
  const first = article?.firstElementChild;
  if (!article || !first || article.hidden) return 0;
  const left = first.getBoundingClientRect().left - host.getBoundingClientRect().left;
  return left > 0 ? left : 0;
}

export function installMetadataMargin(handle: AppHandle, signal: DocumentSignal): MetadataMargin {
  const existing = controllers.get(handle);
  if (existing) return existing;
  const panes = handle.panes();
  let on = false;
  let frame = 0;
  const drawn = new Map<HTMLElement, { layer: HTMLElement; key: string }>();
  const stats = new Map<string, { key: string; mtimeMs: number | null; asked: boolean }>();
  const observers = new Map<HTMLElement, { resize: ResizeObserver; mode: MutationObserver }>();

  const chromePx = (): number => px(getComputedStyle(document.documentElement).getPropertyValue('--marxy-size-chrome')) || 13;

  const remove = (host: HTMLElement): void => {
    drawn.get(host)?.layer.remove();
    drawn.delete(host);
  };

  const factsFor = (path: string, bytes: number, version: number): PreviewRow[] => {
    const out: PreviewRow[] = [];
    if (!isUntitled(path)) {
      const seen = stats.get(path);
      const key = `${path}\0${version}`;
      if (seen === undefined || seen.key !== key) {
        // The modified time is the file's: asked of the disk after a change, drawn when it arrives.
        const entry = { key, mtimeMs: seen?.mtimeMs ?? null, asked: true };
        stats.set(path, entry);
        void handle.shell.stat(path).then((stat) => {
          if (stats.get(path) !== entry) return;
          entry.mtimeMs = stat?.mtimeMs ?? null;
          schedule();
        }, () => {});
      }
      const ms = stats.get(path)?.mtimeMs ?? null;
      if (ms !== null) out.push({ key: 'modified', value: modifiedWords(ms) });
    }
    out.push({ key: 'size', value: `${formatCount(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}` });
    return out;
  };

  const draw = (pane: (typeof panes.panes)[number]): void => {
    const host = pane.host;
    const store = pane.content.store();
    const path = pane.path();
    const room = marginRoom(host);
    if (!on || !store || path === null || room < roomNeeded(chromePx())) return remove(host);
    const snap = store.snapshot();
    const found = frontMatterOf(store);
    const facts = factsFor(path, snap.buffer.bytes.length, snap.version);
    const { rows, more } = previewRows(found?.values ?? null, facts);
    const unit = chromePx() / 13;
    const article = host.querySelector<HTMLElement>(':scope > .marxy-article')!;
    const first = article.firstElementChild!;
    // The first line's distance below the article's top edge, which is where the layer sits: both move with a scroll, so it is constant.
    const offset = Math.max(0, first.getBoundingClientRect().top - article.getBoundingClientRect().top);
    const width = Math.max(0, room - 40 * unit);
    const key = JSON.stringify([rows, more, Math.round(offset), Math.round(width), Math.round(unit * 100)]);
    const current = drawn.get(host);
    if (current && current.key === key && current.layer.isConnected) return;
    current?.layer.remove();
    const layer = document.createElement('div');
    layer.className = 'marxy-metadata-margin';
    const block = document.createElement('div');
    block.className = 'marxy-metadata-preview';
    block.setAttribute('role', 'complementary');
    block.setAttribute('aria-label', 'File metadata');
    block.style.left = `${18 * unit}px`;
    block.style.width = `${width}px`;
    block.style.top = `${offset}px`;
    const list = document.createElement('dl');
    list.className = 'marxy-metadata-preview-list';
    for (const row of rows) {
      const dt = document.createElement('dt');
      dt.textContent = row.key;
      const dd = document.createElement('dd');
      dd.textContent = row.value;
      dd.title = row.value;
      list.append(dt, dd);
    }
    block.append(list);
    if (more > 0) {
      const extra = document.createElement('div');
      extra.className = 'marxy-metadata-preview-more';
      extra.textContent = `+${more} more`;
      block.append(extra);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'marxy-metadata-preview-link';
    open.textContent = 'More…';
    open.addEventListener('mousedown', (event) => event.preventDefault());
    open.addEventListener('click', () => void controller.openTab());
    block.append(open);
    layer.append(block);
    host.insertBefore(layer, host.firstChild);
    drawn.set(host, { layer, key });
  };

  const refresh = (): void => {
    frame = 0;
    const live = new Set(panes.panes.map((p) => p.host));
    for (const host of [...drawn.keys()]) if (!live.has(host)) remove(host);
    for (const pane of panes.panes) {
      watch(pane.host, pane.article);
      draw(pane);
    }
    for (const [host, o] of [...observers]) {
      if (live.has(host)) continue;
      o.resize.disconnect();
      o.mode.disconnect();
      observers.delete(host);
    }
  };

  function schedule(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(refresh);
  }

  /** A pane's size and mode are what decide whether there is room: looked at again when either changes. */
  function watch(host: HTMLElement, article: HTMLElement): void {
    if (observers.has(host)) return;
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    resize.observe(article);
    const mode = new MutationObserver(schedule);
    mode.observe(host, { attributes: true, attributeFilter: ['data-marxy-mode', 'data-marxy-kind'] });
    observers.set(host, { resize, mode });
  }

  const openTab = async (): Promise<void> => {
    const workspace = handle.workspace();
    selectInspectorTab('metadata');
    if (workspace.mode === 'folded') await workspace.dock('inspector');
    if (workspace.inspectorHidden()) {
      notify({ kind: 'info', text: 'The inspector is not shown over Source or Split in a window this narrow; widen the window or go back to Read.' });
    }
  };

  const controller: MetadataMargin = {
    get on() {
      return on;
    },
    async toggle() {
      if (on) {
        on = false;
        refresh();
        return;
      }
      const pane = panes.focused;
      if (marginRoom(pane.host) >= roomNeeded(chromePx())) {
        on = true;
        refresh();
        return;
      }
      await openTab();
    },
    openTab,
  };
  controllers.set(handle, controller);

  signal.onChange(schedule);
  handle.workspace().onChange(() => {
    // The panes settle into their new size after the fold; the observers see it, and this looks once more for good measure.
    schedule();
  });
  schedule();
  return controller;
}
