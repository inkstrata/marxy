// A pane's head: the address of what the pane shows. Back and forward through this pane's own history,
// the crumbs (crumbs.ts), then the kind's tools as quiet chips: how the bytes are read, and Read / Source. Where the app
// guessed is kept current here but said in the Reading card. The window's tabs are the row (tab-row.ts).
import { appHandle } from '../commands/app-handle.ts';
import { tierHeadWords } from '@marxy/core/src/highlight/tier.ts';
import { readingOf, TREE_TIER_WORDS } from '@marxy/core/src/reading/index.ts';
import { langOfPath } from '../kind-icons/icons.ts';
import { onColourChoice, tierOf } from '../render/colour-tier.ts';
import { onAloneChoice } from '../viewers/table-choices.ts';
import { onPartChoice } from '../render/parts.ts';
import type { HeadSay } from '../viewers/types.ts';
import { onViewerChange } from '../viewers/signal.ts';
import { guessMarkOf } from './guess-now.ts';
import { encodingMarkOf, followEncodingChoices } from './encoding.ts';
import { onEncodingChoice } from '../document/encoding.ts';
import type { GuessMark, GuessPlace } from './model/guess.ts';
import { GONE } from '../notices/disk.ts';
import { WORKING, workingSay } from '../render/working.ts';
import { mountCrumbs } from './crumbs.ts';
import { mountHeadChips } from './head-chips.ts';
import { icon } from './icons.ts';
import { anchorBelow, openMenu, type MenuItem } from './menu.ts';
import { mountSpine } from './spine.ts';
import { followSpineJoins } from './spine-joins.ts';
import type { Frame, FramePane, Head } from './types.ts';

function button(className: string, label: string, child?: Node): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('aria-label', label);
  b.title = label;
  if (child) b.append(child);
  // A press in the head never takes focus or the selection from the page.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

/** A code file shown in a lower tier says so: "Plain text · no colour past 2 MB", in grey. */
function tierSay(pane: FramePane): HeadSay | null {
  const store = pane.content.store();
  const path = pane.path();
  if (!store || path === null) return null;
  // A data tree drawn in part says so in Read: "The first 5,000 values"; Source keeps the colour tier.
  if (pane.view.mode !== 'source' && readingOf(path, store.snapshot().buffer.bytes, pane.kind())?.tree?.capped) {
    return { text: TREE_TIER_WORDS, tone: 'tier', title: 'Drawn in part, by its size · Metadata says why, and what else' };
  }
  const tier = tierOf(path, store.snapshot().buffer.bytes);
  const text = tier ? tierHeadWords(tier) : null;
  return text ? { text, tone: 'tier', title: 'Shown in a lower tier, by its size · Metadata says why, and what else' } : null;
}

export function mountHead(pane: FramePane, frame: Frame, opts: { readonly sayGuess: () => boolean }): Head {
  const handle = appHandle()!;
  const el = document.createElement('header');
  el.className = 'marxy-head';
  el.setAttribute('data-marxy-head', String(pane.slot));

  const back = button('marxy-head-step', 'Back', icon('back'));
  const forward = button('marxy-head-step', 'Forward', icon('forward'));
  const history = document.createElement('div');
  history.className = 'marxy-head-history';
  history.append(back, forward);

  const crumbs = mountCrumbs(pane, handle, frame);

  const ktools = document.createElement('div');
  ktools.className = 'marxy-ktools';
  const guess = button('marxy-guess', 'Read this file as…');
  guess.hidden = true;
  // How the bytes are read: a guessed encoding in blue, a chosen one as yours. A BOM is a fact, said in Facts.
  const encoding = button('marxy-guess marxy-guess-encoding', 'How this file’s bytes are read');
  encoding.hidden = true;
  const modes = document.createElement('div');
  modes.className = 'marxy-rs';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Read or Source');
  const read = button('marxy-rs-read', 'Read');
  read.textContent = 'Read';
  const source = button('marxy-rs-source', 'Source (\\)');
  source.setAttribute('aria-label', 'Source');
  source.textContent = 'Source';
  modes.append(read, source);
  const chips = mountHeadChips(pane, handle);
  ktools.append(guess, encoding, chips.reveal, modes, chips.unsaved);

  el.append(history, crumbs.el, ktools);
  pane.host.prepend(el);
  const spine = mountSpine(pane);
  const offSpineJoins = followSpineJoins(pane);

  const panes = () => handle.panes();
  let shownMark: GuessMark | null = null;

  const head: Head = {
    el,
    pane,
    back: () => frame.tabs.step(pane.slot, -1),
    forward: () => frame.tabs.step(pane.slot, 1),
    render,
    destroy() {
      offDocument();
      offColourChoice();
      offAloneChoice();
      offPartChoice();
      offViewer();
      offEncodingChoice();
      offReread();
      observer.disconnect();
      crumbs.destroy();
      chips.destroy();
      offSpineJoins();
      spine.destroy();
      pane.host.removeEventListener('wheel', keepOnRead);
      pane.host.removeEventListener('touchmove', keepOnRead);
      el.remove();
    },
  };

  function render(): void {
    const tabs = frame.tabs.model;
    back.disabled = !tabs.canBack(pane.slot);
    forward.disabled = !tabs.canForward(pane.slot);
    crumbs.render();
    const mode = pane.view.mode;
    const has = pane.path() !== null;
    read.setAttribute('aria-pressed', String(mode === 'rendered'));
    source.setAttribute('aria-pressed', String(mode === 'source'));
    read.disabled = source.disabled = !has;
    // A page of the app's own says its own: a guess from the bytes in blue, a tier in grey; no reading is quiet.
    const viewerSay = workingSay(pane.host) ?? pane.content.viewer()?.headSay() ?? tierSay(pane);
    const saySay = viewerSay !== null && (opts.sayGuess() || viewerSay.tone !== 'guess');
    const mark = viewerSay === null && opts.sayGuess() ? guessMarkOf(pane) : null;
    shownMark = mark;
    guess.hidden = !saySay && mark === null;
    if (saySay) {
      const what = document.createElement('span');
      what.className = 'marxy-guess-what';
      what.textContent = viewerSay.text;
      guess.replaceChildren(what);
      // A reading the reader chose for a page of the app's own (an HTML file read as a page) is said as any choice is.
      if (viewerSay.how) {
        const how = document.createElement('span');
        how.className = 'marxy-guess-how';
        how.textContent = ` · ${viewerSay.how}`;
        guess.append(how);
      }
      guess.toggleAttribute('data-marxy-mine', viewerSay.tone === 'mine');
      guess.toggleAttribute('data-marxy-tier', viewerSay.tone === 'tier');
      guess.title = viewerSay.title;
      guess.setAttribute('aria-label', `${viewerSay.text}. ${viewerSay.title}`);
    } else if (mark) {
      const one = mark.places.length === 1 ? mark.places[0]! : null;
      const what = document.createElement('span');
      what.className = 'marxy-guess-what';
      what.textContent = mark.label;
      const how = document.createElement('span');
      how.className = 'marxy-guess-how';
      how.textContent = ` · ${mark.how}`;
      guess.replaceChildren(what, how);
      guess.toggleAttribute('data-marxy-mine', mark.mine);
      guess.removeAttribute('data-marxy-tier');
      const tip = !one ? 'Where the app guessed, or you chose · each place, and why' : `How the app reads this${one.id === 'file' ? ' file' : ' part'} · why, and other ways`;
      guess.title = `${mark.label} · ${mark.how}. ${tip}`;
      guess.setAttribute('aria-label', `${mark.label}, ${mark.how}. ${tip}`);
    } else {
      // Hidden keeps nothing of what it last said, a finished "Reading N MB…" least of all.
      guess.replaceChildren();
      guess.removeAttribute('data-marxy-mine');
      guess.removeAttribute('data-marxy-tier');
      guess.title = 'Read this file as…';
      guess.setAttribute('aria-label', guess.title);
    }
    const enc = opts.sayGuess() && pane.content.store() !== null ? encodingMarkOf(pane.path()) : null;
    encoding.hidden = enc === null;
    if (enc) {
      const what = document.createElement('span');
      what.className = 'marxy-guess-what';
      what.textContent = enc.label;
      const how = document.createElement('span');
      how.className = 'marxy-guess-how';
      how.textContent = ` · ${enc.how}`;
      encoding.replaceChildren(what, how);
      encoding.toggleAttribute('data-marxy-mine', enc.mine);
      encoding.title = `${enc.label} · ${enc.how}. How the app reads its bytes · why, and other encodings`;
      encoding.setAttribute('aria-label', encoding.title);
    } else encoding.replaceChildren();
    // The kind said in the head takes its language's accent when the file is code in a known language.
    const path = pane.path();
    const lang = mark?.places[0]?.id === 'file' && path !== null && pane.content.detected()?.kind === 'code' ? langOfPath(path) : undefined;
    if (lang === undefined) delete guess.dataset.marxyLang;
    else guess.dataset.marxyLang = lang;
    chips.render();
    spine.draw();
  }

  function sync(): void {
    frame.tabs.note(pane);
    render();
  }

  // A glance is kept once the reader scrolls it: it is being read, not looked at.
  const keepOnRead = (): void => {
    const t = frame.tabs.model.tabIn(pane.slot);
    if (t?.glance) {
      frame.tabs.model.keep(t.id);
      frame.tabs.render();
    }
  };
  pane.host.addEventListener('wheel', keepOnRead, { passive: true });
  pane.host.addEventListener('touchmove', keepOnRead, { passive: true });
  const offColourChoice = onColourChoice((path) => {
    if (path === pane.path()) render();
  });
  // A database read alone, or with its log again: its tier changes.
  const offAloneChoice = onAloneChoice((path) => {
    if (path === pane.path()) render();
  });
  const offPartChoice = onPartChoice((path) => {
    if (path === pane.path()) render();
  });
  // A page's tier can be learned after it is drawn (a face the font checker refused, a codec the player could not play).
  const offViewer = onViewerChange(() => {
    if (pane.content.viewer()) render();
  });
  const offEncodingChoice = onEncodingChoice((path) => {
    if (path === pane.path()) render();
  });
  // A choice reads the file again in this pane (once for every pane that shows it).
  const offReread = followEncodingChoices(pane, () => appHandle());

  back.addEventListener('click', () => void head.back());
  forward.addEventListener('click', () => void head.forward());
  guess.addEventListener('click', () => {
    const mark = shownMark;
    if (!mark) return frame.showPanel({ card: 'reading' });
    if (mark.places.length === 1) return goToPlace(mark.places[0]!);
    const items: MenuItem[] = mark.places.map((p) => ({
      title: p.id === 'file' ? 'The whole file' : p.words.charAt(0).toUpperCase() + p.words.slice(1),
      detail: p.mine ? 'your choice' : 'guessed',
      run: () => goToPlace(p),
    }));
    openMenu(anchorBelow(guess), 'Where the app guessed', items);
  });
  /** The Reading card at the place, opened on it; a part's start brought into view. */
  function goToPlace(place: GuessPlace): void {
    const path = pane.path();
    if (path === null) return;
    if (panes().focused !== pane) panes().focus(pane);
    frame.showPanel({ card: 'reading' });
    if (place.start !== null) void handle.open(path, { at: place.start });
  }
  read.addEventListener('click', () => void setMode('rendered'));
  source.addEventListener('click', () => void setMode('source'));
  encoding.addEventListener('click', () => {
    if (panes().focused !== pane) panes().focus(pane);
    frame.showPanel({ card: 'reading' });
  });
  el.addEventListener('mousedown', () => {
    if (panes().focused !== pane) panes().focus(pane);
  });

  async function setMode(mode: 'rendered' | 'source'): Promise<void> {
    if (panes().focused !== pane) panes().focus(pane);
    await pane.view.setMode(mode);
    if (mode === 'source') pane.view.focusSource();
    render();
  }

  // The view writes its mode on its host (the first pane's is <body>); either way the head redraws its switch.
  // The row says a file gone from disk on its tab, so it is drawn again too.
  const observer = new MutationObserver(() => {
    render();
    frame.tabs.render();
  });
  observer.observe(pane.host, { attributes: true, attributeFilter: ['data-marxy-mode', 'data-marxy-kind', GONE, WORKING] });
  if (pane.slot === 0) observer.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  const offDocument = pane.content.onDocumentChange(sync);
  sync();
  return head;
}
