// The verb bar: one line at the foot of the focused pane while the cursor is set, as the prototype's
// `.verbbar` draws it. The part's address and its plain word, then the verbs it can take as key and word, each a button
// that runs the same command as its key. It floats over the page: the page under it is never moved, and the article's
// own room at its end keeps the last line clear of it.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { partRange } from '../commands/cursor.ts';
import { lineSpan, partAddress, partLabel, runLabel } from './cursor.ts';
import { runBlocks } from './selection.ts';
import type { RenderedSelection } from './view.ts';
import { onVerbs, verbsOn } from './verbs-on.ts';
import { BAR_VERBS } from './verbs.ts';
import { onPartsChange, partsHere } from '../parts/cursor.ts';
import { hereAddress, hereLabel } from '../parts/commands.ts';
import { setMarked } from '../frame/model/metadata-marks.ts';

/** The verbs over a kind's parts: a kind read from bytes, or from inside another file, offers no change verbs. */
const PART_VERBS: readonly (readonly [id: string, word: string, only?: 'section'])[] = [
  ['cursor.copy', 'copy'],
  ['cursor.copy-cite', 'cite'],
  ['depths.xray', 'x-ray'],
  ['cursor.open', 'open'],
  ['cursor.source', 'source'],
  ['read.as', 'read as'],
  ['tray.collect', 'collect'],
  ['note.write', 'note'],
  ['cursor.menu', 'all'],
];

/** How a command's key is drawn on its button: the character it types, or the key's name. */
export function verbKeyLabel(spec: string): string {
  const key = spec.split('+').at(-1)!;
  return spec.startsWith('Shift+') && key.length === 1 ? key.toUpperCase() : key;
}

interface PaneLike {
  readonly host: HTMLElement;
  readonly article: HTMLElement;
}

export interface VerbBarDeps {
  selection(): RenderedSelection | null;
  panes(): { readonly focused: PaneLike } | null;
  commands(): readonly Command[];
  run(cmd: Command): void;
  context(): AppContext;
}

/** What the bar says for the selection now, or null when it is not drawn. */
function contentFor(sel: RenderedSelection): { readonly where: string; readonly what: string } | null {
  if (!verbsOn() || !sel.cursorReady()) return null;
  const state = sel.state().selection;
  const runtime = sel.runtime();
  const range = partRange(state);
  if (!runtime || !range) return null;
  const { bytes, path } = runtime.buffer;
  const where = partAddress(basename(path), lineSpan(bytes, range.start, range.end));
  const what = state.kind === 'blocks' ? runLabel(runBlocks(runtime.document, state.first, state.last).length) : partLabel(state);
  return what === null ? null : { where, what };
}

const SHOWS_BAR = 'data-marxy-verb-bar';
/**
 * While the bar stands over the one pane, whose page the window scrolls, the root keeps this much scroll padding at the
 * foot: the band's height (`--marxy-verb-room` in base.css, 64 px at 13 px chrome), in bar font sizes. A length set on the
 * root, never a rule that reads `var()` or a `:root:has()` over the pane's mark: either made Chromium restyle every
 * element of the window as the bar came and went.
 */
const ROOM_EMS = 64 / 12;

const span = (cls: string, text = ''): HTMLSpanElement => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
};

/** Marks the pane the bar stands over, so its page keeps a foot for it (the theme's `.marxy-pane::after`); none, with null. */
function showsBar(host: HTMLElement | null, bar: HTMLElement): void {
  for (const pane of document.querySelectorAll<HTMLElement>(`section.marxy-pane[${SHOWS_BAR}]`)) if (pane !== host) pane.removeAttribute(SHOWS_BAR);
  if (host && !host.hasAttribute(SHOWS_BAR)) host.setAttribute(SHOWS_BAR, '');
  const style = document.documentElement.style;
  const one = host !== null && host.parentElement?.id === 'marxy-main' && !host.parentElement.hasAttribute('data-marxy-split');
  if (!one) {
    if (style.scrollPaddingBottom) style.removeProperty('scroll-padding-bottom');
  } else if (!style.scrollPaddingBottom) {
    style.scrollPaddingBottom = `${parseFloat(getComputedStyle(bar).fontSize) * ROOM_EMS}px`;
  }
}

/** Mounts the bar once for the window; it follows whichever selection and pane `deps` name when it redraws. */
export function installVerbBar(deps: VerbBarDeps, signal: AbortSignal): { refresh(): void } {
  const bar = document.createElement('div');
  bar.className = 'marxy-verb-bar marxy-surface';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'The part under the cursor');
  bar.hidden = true;
  document.body.append(bar);
  // A press on the bar must not take focus off the page, where the keys are.
  bar.addEventListener('mousedown', (event) => event.preventDefault());

  let following: RenderedSelection | null = null;
  let offSelection = (): void => {};
  let watchedHost: HTMLElement | null = null;
  const resized = new ResizeObserver(() => place());

  const place = (): void => {
    const host = deps.panes()?.focused?.host;
    if (!host || bar.hidden) return;
    const r = host.getBoundingClientRect();
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, window.innerWidth);
    bar.style.left = `${(left + right) / 2}px`;
    // A table page's parts bar sits at the pane's foot and is the pointer's way between tables and sheets: stand above it.
    const parts = host.querySelector('.marxy-pbar')?.getBoundingClientRect();
    const floor = parts && parts.height > 0 && parts.bottom > r.top ? Math.min(r.bottom, parts.top - 8) : r.bottom;
    bar.style.bottom = `${window.innerHeight - Math.min(floor, window.innerHeight) + 16}px`;
    bar.style.maxWidth = `${Math.max(right - left - 40, 120)}px`;
  };

  const draw = (): void => {
    // A stand-in handle (the selection harness's) has no cursor to draw.
    const found = deps.selection();
    const sel = found && typeof found.onChange === 'function' ? found : null;
    if (sel !== following) {
      offSelection();
      following = sel;
      offSelection = sel ? sel.onChange(draw) : () => {};
    }
    const host = deps.panes()?.focused?.host ?? null;
    if (host !== watchedHost) {
      if (watchedHost) resized.unobserve(watchedHost);
      if (host) resized.observe(host);
      watchedHost = host;
    }
    const parts = verbsOn() ? partsHere() : null;
    const content = parts ? (parts.head ? { where: hereAddress(parts), what: hereLabel(parts) } : null) : sel ? contentFor(sel) : null;
    if (!content) {
      if (!bar.hidden) bar.hidden = true;
      bar.replaceChildren();
      showsBar(null, bar);
      return;
    }
    const ctx = deps.context();
    const registered = deps.commands();
    const buttons: HTMLElement[] = [];
    for (const [id, word, only] of parts ? PART_VERBS : BAR_VERBS) {
      const cmd = registered.find((c) => c.id === id);
      if (!cmd?.key || !cmd.when(ctx) || (only === 'section' && ctx.selection.kind !== 'section')) continue;
      if (id === 'cursor.menu') buttons.push(span('marxy-verb-bar-sep'));
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'marxy-verb-bar-verb';
      button.title = cmd.title;
      button.setAttribute('data-marxy-verb', id);
      const key = document.createElement('kbd');
      key.className = 'marxy-kbd';
      key.textContent = verbKeyLabel(cmd.key);
      button.append(key, ` ${word}`);
      button.addEventListener('click', () => deps.run(cmd));
      buttons.push(button);
    }
    const where = span('marxy-verb-bar-where');
    // A name is drawn as written: a character that reorders or hides the rest is shown.
    setMarked(where, content.where);
    const what = span('marxy-verb-bar-what');
    setMarked(what, content.what);
    bar.replaceChildren(where, what, span('marxy-verb-bar-sep'), ...buttons);
    if (bar.hidden) bar.hidden = false;
    showsBar(host, bar);
    place();
  };

  const offVerbs = onVerbs(draw);
  const offParts = onPartsChange(draw);
  window.addEventListener('resize', place, { signal });
  // Source and Read swap, a pane opens or closes: the bar is drawn for the page that shows now. Its own changes are not one.
  const mutations = new MutationObserver((records) => {
    if (records.some((r) => !bar.contains(r.target))) draw();
  });
  mutations.observe(document.getElementById('marxy-main') ?? document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'data-marxy-mode', 'data-marxy-split'] });
  signal.addEventListener(
    'abort',
    () => {
      offVerbs();
      offParts();
      offSelection();
      mutations.disconnect();
      resized.disconnect();
      bar.remove();
      showsBar(null, bar);
    },
    { once: true },
  );
  draw();
  return { refresh: draw };
}
