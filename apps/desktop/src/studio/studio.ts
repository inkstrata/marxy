// The Studio: the whole window becomes the
// place where a reader shapes how text looks. The reader's own page stands in the middle, set by the real engine and the
// real renderer; the themes (a shelf of rows, each drawn in itself), the reasons and the dials stand around it. The top
// bar only simulates (day or night, the pane's width, the kind of text); the dials change the look, live everywhere,
// through the store. Every theme is a look, so Ink, Polar and the bundled themes are on the
// shelf and can be changed here; the specimen is one long proof, not a grid; Colours sets any colour by hand.
import {
  LANG_PALETTES,
  allLooks,
  lookById,
  merged,
  resolve,
  rulesOf,
  saveAs,
  schemeOf,
  setLook,
  setMode,
  shownScheme,
  toggleRule,
  tweak,
  type LookContext,
  type LookState,
  type LookTweaks,
  type Over,
  type Resolved,
  type Scheme,
} from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { isMarkdownPath } from '@marxy/core/src/kind/registry.ts';
import { appHandle } from '../commands/app-handle.ts';
import { btn, el, segmented, toggle } from '../frame/dom.ts';
import { lookContext } from '../look/painted.ts';
import { flushLooks, holdLookChange, lookState, looksOn, onLookChange, setLookState } from '../look/store.ts';
import { themeLookId as themeLook } from '../look/theme-look.ts';
import { fillStudioPage } from '../render/studio-pages.ts';
import type { Leaf, SpecimenKind, StudioCtx, StudioView, TabId, Width } from './context.ts';
import { ESSAY, KIND_NAMES, KIND_OF, LANGUAGE_SPECIMENS, SPECIMENS } from './specimens.ts';
import css from './studio.css?inline';
import { mountTone } from './tab-tone.ts';
import { mountType } from './tab-type.ts';
import { mountPage } from './tab-page.ts';
import { mountCode } from './tab-code.ts';
import { mountAdapts } from './tab-adapts.ts';
import { mountFile } from './tab-file.ts';
import { mountCompare } from './compare.ts';
import { mountGalley } from './galley.ts';
import { dropFit, startFit } from './fit.ts';
import { makeShelf, type Shelf } from './shelf.ts';
import { mountColours } from './tab-colours.ts';

const TABS: readonly (readonly [TabId, string])[] = [['tone', 'Tone'], ['colours', 'Colours'], ['type', 'Type'], ['page', 'Page'], ['code', 'Code'], ['adapts', 'Adapts'], ['file', 'File']];
const TAB_PIECES = { tone: mountTone, colours: mountColours, type: mountType, page: mountPage, code: mountCode, adapts: mountAdapts, file: mountFile } as const;
const COMMIT_MS = 250;


const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const thousands = (n: number): string => Math.round(n).toLocaleString('en-GB');

let current: { close(): void; open(arg?: string): void } | null = null;

export const studioIsOpen = (): boolean => current !== null;

/** Opens the Studio, or (open already) turns it to `arg`: a dock tab, `fit` or `sheet`. */
export function openStudioSurface(arg?: string): void {
  if (current) {
    current.open(arg);
    return;
  }
  current = build(arg);
}

export function closeStudioSurface(): void {
  current?.close();
}

/** The reader's prose for the canvas: the focused pane's Markdown, else the essay. */
function proseSource(): { readonly text: string; readonly path: string; readonly name: string } {
  const store = appHandle()?.document();
  const snap = store?.snapshot();
  const path = snap?.path ?? '';
  if (snap && isMarkdownPath(path)) {
    const text = new TextDecoder().decode(snap.buffer.bytes);
    // The opening of a long document is enough to read a look by; the canvas does not need all of it.
    return { text: text.length > 60_000 ? text.slice(0, text.indexOf('\n', 60_000) + 1 || 60_000) : text, path, name: path.slice(path.lastIndexOf('/') + 1) };
  }
  return { text: ESSAY, path: '', name: 'On margins (a specimen)' };
}

function build(arg?: string): { close(): void; open(arg?: string): void } {
  adoptRuntimeSheet(document, 'marxy-studio-style', css);
  const before = document.activeElement;
  const prose = proseSource();
  const env = lookContext();
  // With the theme painting the page (Ink, dark, by default), the Studio starts in the variant on screen, not the system's.
  const onScreen = (): Scheme => (document.documentElement.getAttribute('data-marxy-variant') === 'light' ? 'day' : 'night');
  const themeAtOpen = !looksOn();
  const atOpen = themeLook();
  let view: StudioView = {
    scheme: themeAtOpen ? onScreen() : schemeOf(lookState(), env),
    width: 'column',
    kind: 'prose',
    sheet: false,
    compare: false,
    hover: null,
    tab: 'tone',
    lang: null,
  };
  let live: { readonly id: string; tweaks: LookTweaks } | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  let avail = 900;
  let scale = 1;
  let canvasLeaf: Leaf | null = null;
  let stageCleanup: (() => void) | null = null;
  let tabCleanup: (() => void) | null = null;
  let keyOwner: ((e: KeyboardEvent) => boolean) | null = null;
  let resolvedNow: Resolved | null = null;
  let measureShown: number | null = null;
  let closed = false;
  const paintListeners = new Set<() => void>();
  // Taken before anything moves: Compare's before is the look as the Studio found it.
  const openedLook = (() => {
    const s = lookState();
    const r = resolve(s, { ...env, kind: 'article', path: prose.path, width: 900 });
    const id = atOpen ?? r.look.id;
    if (!themeAtOpen) return { id, tweaks: { ...(s.tweaks[id] ?? {}) } };
    // No look has the theme's colours: Compare's before is the theme itself, its values read off the page now.
    const cs = getComputedStyle(document.documentElement);
    const theme = Object.fromEntries(Object.keys(r.tokens).map((k) => [k, cs.getPropertyValue(k).trim() || 'initial']));
    return { id, tweaks: { ...(s.tweaks[id] ?? {}) }, theme };
  })();
  /**
   * The first change made while the theme paints the page starts from the theme's own look (Ink's, by default) and keeps
   * the window in the variant on screen: the page does not jump when the looks take it over.
   */
  const seeded = (s: LookState, chosen = false): LookState => {
    const own = themeLook();
    // A look chosen outright (a row on the shelf, a look saved) is kept; a dial or a switch starts from the theme's own.
    const next = own && !chosen && s.id !== own ? setLook(s, own) : s;
    return schemeOf(next, lookContext()) === onScreen() ? next : setMode(next, onScreen());
  };

  // ---- the state, with the live change laid over ----------------------------------------------------------------------
  const state = (): LookState => {
    const s = lookState();
    if (!live) return s;
    return { ...s, tweaks: { ...s.tweaks, [live.id]: { ...(s.tweaks[live.id] ?? {}), ...live.tweaks } } };
  };
  const contextOf = (kind: SpecimenKind, width: number): LookContext => ({
    ...env,
    kind: KIND_OF[kind],
    path: kind === 'prose' ? prose.path : '',
    width,
  });
  const natural = (): number => Math.round(clamp(avail, 520, 1000));
  const logicalWidth = (): number => (view.width === 'narrow' ? 520 : view.width === 'wide' ? 1600 : natural());
  const canvasContext = (): LookContext => contextOf(view.kind, logicalWidth());
  // While the theme paints the page, the canvas shows the theme's own look, as the page is: no rule of the looks applies yet.
  const editId = (): string => themeLook() ?? resolve(state(), canvasContext(), { scheme: view.scheme }).look.id;
  const canvasOver = (): Over => {
    // A theme the pointer is over is shown as the shelf draws it: in the appearance it is known by.
    if (view.hover) return { id: view.hover, scheme: shownScheme(lookById(state(), view.hover)) };
    const own = themeLook();
    return own ? { id: own, scheme: view.scheme } : { scheme: view.scheme };
  };

  function commit(): void {
    clearTimeout(commitTimer);
    commitTimer = undefined;
    if (!live) return;
    const { id, tweaks } = live;
    live = null;
    let s = lookState();
    for (const [k, v] of Object.entries(tweaks)) s = tweak(s, k as keyof LookTweaks, v as never, id);
    setLookState(looksOn() ? s : seeded(s));
  }

  function paintEl(target: HTMLElement, ctx: LookContext, over: Over = {}): Resolved {
    const r = resolve(state(), ctx, over);
    for (const [k, v] of Object.entries(r.tokens)) if (target.style.getPropertyValue(k) !== v) target.style.setProperty(k, v);
    target.setAttribute('data-marxy-look', r.look.id);
    target.setAttribute('data-marxy-scheme', r.scheme);
    // Only a leaf is indented or justified: on the dialog they would reach Compare's before, which may be the theme.
    const leaf = target !== root;
    if (leaf && r.look.para === 'indent' && r.subject === 'prose') target.setAttribute('data-marxy-look-para', 'indent');
    else target.removeAttribute('data-marxy-look-para');
    if (leaf && r.tokens['--marxy-justify'] === '1') target.setAttribute('data-marxy-look-align', 'justify');
    else target.removeAttribute('data-marxy-look-align');
    if (ctx.kind) target.setAttribute('data-marxy-kind', ctx.kind);
    return r;
  }

  function makeLeaf(kind: SpecimenKind, opts: { readonly lang?: string; readonly short?: boolean | number; readonly width?: number } = {}): Leaf {
    const leaf = el('div', 'marxy-studio-leaf');
    const scroller = el('div', 'marxy-studio-scroll');
    const article = el('article', 'marxy-article');
    scroller.append(article);
    leaf.append(scroller);
    leaf.style.width = `${opts.width ?? logicalWidth()}px`;
    let text = opts.lang ? (LANGUAGE_SPECIMENS[opts.lang] ?? SPECIMENS.code) : kind === 'prose' ? prose.text : SPECIMENS[kind];
    // A short page shows its first screenful (or about as many characters as asked, to a paragraph's end): the rest of a
    // long page is not needed in the DOM.
    const most = typeof opts.short === 'number' ? opts.short : 4000;
    if (opts.short && text.length > most) text = text.slice(0, text.indexOf('\n\n', most) + 1 || text.indexOf('\n', most) + 1 || most);
    const ready = fillStudioPage(article, text).catch(() => undefined);
    return { el: leaf, scroller, article, ready };
  }

  // ---- the DOM ------------------------------------------------------------------------------------------------------
  const root = el('dialog', 'marxy-studio');
  root.setAttribute('aria-label', 'The Studio');
  const top = el('div', 'marxy-studio-top');
  const shelf = el('aside', 'marxy-studio-shelf');
  shelf.setAttribute('aria-label', 'Looks');
  const stageWrap = el('div', 'marxy-studio-stagewrap');
  const stage = el('div', 'marxy-studio-stage');
  const capL = el('div', 'marxy-studio-cap-l');
  const capR = el('div', 'marxy-studio-cap-r');
  const caption = el('div', 'marxy-studio-cap');
  caption.append(capL, capR);
  stageWrap.append(stage, caption);
  const why = el('aside', 'marxy-studio-why');
  why.setAttribute('aria-label', 'Why this page looks as it does');
  const middle = el('div', 'marxy-studio-middle');
  middle.append(shelf, stageWrap, why);
  const dock = el('div', 'marxy-studio-dock');
  const dockTabs = el('div', 'marxy-studio-tabs');
  dockTabs.setAttribute('role', 'tablist');
  const dockBody = el('div', 'marxy-studio-dockbody');
  dock.append(dockTabs, dockBody);
  const line = el('div', 'marxy-studio-say');
  line.setAttribute('role', 'status');
  root.append(top, middle, dock, line);

  // ---- the top bar ----------------------------------------------------------------------------------------------------
  function drawTop(): void {
    const name = el('div', 'marxy-studio-name', 'Studio');
    const which = segmented<'doc' | 'sheet'>('What the canvas shows', [['doc', 'This document'], ['sheet', 'Specimen']], view.sheet ? 'sheet' : 'doc', (v) => setView({ sheet: v === 'sheet', compare: false }));
    const scheme = segmented('Day or night', [['day', 'Day'], ['night', 'Night']], view.scheme, (v) => setView({ scheme: v }));
    const width = segmented<Width>('The pane’s width', [['narrow', 'Narrow'], ['column', 'Column'], ['wide', 'Wide']], view.width, (v) => setView({ width: v }));
    const compare = btn('marxy-btn', 'Compare', () => setView({ compare: !view.compare, sheet: false }));
    compare.title = 'Before and now, either side of a seam';
    compare.setAttribute('aria-pressed', String(view.compare));
    const fit = btn('marxy-btn', 'Fit…', () => startFit(ctx));
    fit.title = 'An eye test for your own reading: nothing changes until you keep it';
    const done = btn('marxy-btn', 'Done', () => close());
    done.setAttribute('data-marxy-primary', '');
    done.title = 'Back to reading (Esc)';
    const see = el('div', 'marxy-studio-see');
    // The kinds of text live in the specimen, each with "work on it alone"; the bar keeps what simulates the reader's place.
    see.append(which, el('span', 'marxy-studio-sp'), scheme, width, el('span', 'marxy-studio-sp'));
    const acts = el('div', 'marxy-studio-acts');
    acts.append(compare, fit, done);
    top.replaceChildren(name, see, acts);
  }

  // ---- the stage: the canvas, the sheet, or Compare --------------------------------------------------------------------
  function layout(): void {
    const aw = stage.clientWidth;
    const ah = stage.clientHeight;
    if (aw > 0) avail = aw - 48;
    if (!canvasLeaf || view.sheet) return;
    const W = logicalWidth();
    scale = Math.min(1, avail / W);
    const holder = canvasLeaf.el.parentElement as HTMLElement | null;
    if (holder) {
      holder.style.width = `${Math.round(W * scale)}px`;
      holder.style.height = `${Math.max(120, ah - 24)}px`;
    }
    canvasLeaf.el.style.width = `${W}px`;
    canvasLeaf.el.style.height = `${Math.ceil((ah - 24) / scale)}px`;
    canvasLeaf.el.style.transform = scale < 0.995 ? `scale(${scale})` : '';
  }

  function buildStage(): void {
    dropFit();
    const keep = canvasLeaf?.scroller.scrollTop ?? 0;
    stageCleanup?.();
    stageCleanup = null;
    canvasLeaf = null;
    stage.replaceChildren();
    if (view.sheet) {
      const host = el('div', 'marxy-studio-sheethost');
      stage.append(host);
      stageCleanup = mountGalley(host, ctx);
      return;
    }
    canvasLeaf = makeLeaf(view.kind, view.lang ? { lang: view.lang } : {});
    canvasLeaf.el.classList.add('marxy-studio-now');
    // Painted at once: a new page waits for no frame, so it never shows unset for one.
    paintEl(canvasLeaf.el, canvasContext(), canvasOver());
    const paper = el('div', 'marxy-studio-paper');
    paper.append(canvasLeaf.el, measureRule());
    stage.append(paper);
    void canvasLeaf.ready.then(() => {
      if (canvasLeaf) canvasLeaf.scroller.scrollTop = keep;
      queuePaint();
    });
    if (view.compare) stageCleanup = mountCompare(paper, ctx);
    layout();
  }

  // ---- the measure: a rule on the column's right edge, and a handle that drags it --------------------------------------
  const rule = el('div', 'marxy-studio-measure');
  const ruleLabel = el('span', 'marxy-studio-measure-n');
  const handle = el('div', 'marxy-studio-measure-handle');
  handle.title = 'Drag to set the measure';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', 'Measure');
  rule.append(ruleLabel, handle);
  function measureRule(): HTMLElement {
    return rule;
  }
  function placeMeasure(): void {
    const leaf = canvasLeaf;
    const p = leaf?.article.querySelector<HTMLElement>(':scope > p');
    const res = resolvedNow;
    if (!leaf || !p || !res || res.subject !== 'prose' || view.sheet) {
      rule.hidden = true;
      return;
    }
    rule.hidden = false;
    const paper = rule.parentElement!;
    const pr = paper.getBoundingClientRect();
    const r = p.getBoundingClientRect();
    rule.style.left = `${Math.round(r.right - pr.left)}px`;
    const chars = res.facts.chars ?? 0;
    handle.setAttribute('aria-valuenow', String(chars));
    ruleLabel.textContent = `${measureShown ?? chars} characters`;
    rule.toggleAttribute('data-marxy-held', measureShown !== null);
  }
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
    const p = canvasLeaf?.article.querySelector<HTMLElement>(':scope > p');
    const res = resolvedNow;
    if (!p || !res || !res.facts.chars) return;
    const startX = e.clientX;
    const startPx = p.getBoundingClientRect().width;
    const startChars = merged(state(), editId()).measure;
    const perChar = startPx / (res.facts.chars || 1);
    const move = (ev: PointerEvent): void => {
      const chars = Math.round(clamp(startChars + (ev.clientX - startX) / perChar, 45, 80));
      measureShown = chars;
      set('measure', chars);
    };
    const up = (): void => {
      measureShown = null;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      queuePaint();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  // ---- the shelf -----------------------------------------------------------------------------------------------------
  let shelfBody: Shelf | null = null;
  let shelfCount = 0;
  let saving = false;
  /** The look that paints the page now: the one in use, or the theme's own while the theme paints it. */
  const inUse = (): string | null => (looksOn() ? lookState().id : themeLook());
  /** A theme chosen is seen as chosen: a dark one turns the page dark and a light one light, whatever the hour. */
  function chooseLook(id: string): void {
    const scheme = shownScheme(lookById(lookState(), id));
    commit();
    setLookState(setMode(setLook(lookState(), id), scheme));
    setView({ scheme, hover: null });
  }
  function fillShelf(): void {
    shelfBody ??= makeShelf(ctx, { inUse, choose: chooseLook, foot: shelfFoot });
    if (!shelf.contains(shelfBody.el)) shelf.replaceChildren(shelfBody.el);
    shelfBody.fill();
    shelfCount = allLooks(lookState()).length;
  }
  function shelfFoot(): Node[] {
    const foot = el('div', 'marxy-studio-shelf-foot');
    if (saving) {
      const input = el('input', 'marxy-studio-input');
      input.type = 'text';
      input.placeholder = 'Its name';
      input.setAttribute('aria-label', 'A name for the new theme');
      const keep = (): void => {
        const name = input.value.trim();
        saving = false;
        if (!name) return fillShelf();
        commit();
        // The look the canvas shows (a rule's, perhaps), not only the one in use: as Fit keeps.
        const base = looksOn() ? lookState() : seeded(lookState());
        const { state: next, look } = saveAs({ ...base, id: editId() }, name);
        apply(next, { mine: look.id });
        say(`${look.name} is a theme of your own now, kept in looks/${look.id}.look.toml beside config.toml.`);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') keep();
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          saving = false;
          fillShelf();
        }
      });
      foot.append(input, btn('marxy-btn', 'Save', keep));
      queueMicrotask(() => input.focus());
    } else {
      const save = btn('marxy-btn', 'Save as a new theme…', () => {
        saving = true;
        fillShelf();
      });
      save.title = 'The theme on the canvas, with your changes, kept under a name of your own';
      foot.append(save);
    }
    return [foot];
  }

  // ---- the why column ------------------------------------------------------------------------------------------------
  function drawWhy(res: Resolved): void {
    const s = state();
    const list = el('ul', 'marxy-studio-whylist');
    for (const w of res.why) {
      const li = el('li', w.head ? 'marxy-studio-why-head' : '');
      li.append(el('span', '', w.text));
      const r = w.rule ? rulesOf(s).find((x) => x.id === w.rule) : undefined;
      if (r) li.append(toggle(r.label, r.on, (on) => apply(toggleRule(lookState(), r.id, on))));
      list.append(li);
    }
    // While the theme paints the page the canvas shows it as it is; a rule that will pick another look once the looks
    // paint the page is said, with its switch, so the change it makes then is no surprise.
    const own = themeLook();
    if (own && !view.hover) {
      const then = resolve(s, canvasContext(), { scheme: view.scheme });
      const rule = then.why[0]?.rule ? rulesOf(s).find((x) => x.id === then.why[0]!.rule) : undefined;
      if (then.look.id !== own && rule) {
        const li = el('li', 'marxy-studio-why-then');
        li.append(el('span', '', `Once a look paints the page, this file takes ${then.look.name}: ${rule.label.charAt(0).toLowerCase()}${rule.label.slice(1)}`));
        li.append(toggle(rule.label, rule.on, (on) => apply(toggleRule(lookState(), rule.id, on))));
        list.append(li);
      }
    }
    const f = res.facts;
    const facts = el('dl', 'marxy-studio-facts');
    const fact = (k: string, v: string, note?: string): void => {
      const dd = el('dd', '', v);
      if (note) dd.append(el('small', '', note));
      facts.append(el('dt', '', k), dd);
    };
    fact('Size', `${f.size} px on ${f.line} px lines`);
    fact('A line', f.chars ? `${f.chars} characters` : 'as the file has it', f.chars ? ' measured from the face, not ch' : undefined);
    fact('Face', f.face);
    fact('Text', `${f.contrast.toFixed(1)} : 1`, f.held ? ` against 7 : 1; held (the tone cannot give ${f.target} : 1)` : ' against 7 : 1');
    fact('Faintest', `${f.faint.toFixed(1)} : 1`, ' against 4.5 : 1');
    if (res.moved.length) fact('Held', `${res.moved.length} colour${res.moved.length === 1 ? '' : 's'}`, ' set under its floor and walked to it (Colours)');
    const credit = res.look.credit ? [el('p', 'marxy-studio-credit', res.look.credit)] : [];
    why.replaceChildren(el('div', 'marxy-studio-h', 'Why this page'), list, ...credit, el('div', 'marxy-studio-h', 'Measured'), facts);
  }

  // ---- the dock ------------------------------------------------------------------------------------------------------
  function drawDock(): void {
    dockTabs.replaceChildren(
      ...TABS.map(([id, label]) => {
        const b = btn('marxy-studio-tab', label, () => setView({ tab: id }));
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(view.tab === id));
        return b;
      }),
    );
    tabCleanup?.();
    dockBody.replaceChildren();
    tabCleanup = TAB_PIECES[view.tab](dockBody, ctx);
  }

  // ---- painting ------------------------------------------------------------------------------------------------------
  function queuePaint(): void {
    if (raf || closed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paintNow();
    });
  }
  function paintNow(): void {
    if (closed) return;
    const id = editId();
    paintEl(root, { ...env, kind: null, path: null, width: 900 }, { id, scheme: view.scheme, noRules: true });
    const res = resolve(state(), canvasContext(), canvasOver());
    resolvedNow = res;
    if (canvasLeaf) paintEl(canvasLeaf.el, canvasContext(), canvasOver());
    if (!shelfBody || shelfCount !== allLooks(lookState()).length) fillShelf();
    shelfBody!.paint();
    drawWhy(res);
    drawCaption();
    placeMeasure();
    for (const cb of [...paintListeners]) cb();
  }
  function drawCaption(): void {
    const W = logicalWidth();
    if (view.sheet) {
      capL.replaceChildren(el('b', '', 'The specimen'), document.createTextNode(` in ${lookById(state(), view.hover ?? editId()).name}: seven kinds of text and eight languages, one after another`));
      capR.textContent = `Each a ${thousands(W)} px pane`;
      return;
    }
    const name = view.lang ? `A few lines in ${LANG_PALETTES[view.lang]?.name ?? view.lang}` : view.kind === 'prose' ? prose.name : `A specimen: ${KIND_NAMES.find(([k]) => k === view.kind)![1].toLowerCase()}`;
    capL.replaceChildren(el('b', '', name));
    // A specimen in place of the reader's own page: the way back is beside its name.
    if (view.kind !== 'prose' || view.lang) capL.append(btn('marxy-studio-link marxy-studio-caphint', 'back to this document', () => setView({ kind: 'prose', lang: null })));
    if (view.compare) capL.append(el('span', 'marxy-studio-caphint', 'Drag the seam'));
    capR.textContent = scale < 0.995 ? `A ${thousands(W)} px pane, shown at ${Math.round(scale * 100)}%` : `A ${thousands(W)} px pane`;
  }

  // ---- the context ---------------------------------------------------------------------------------------------------
  function set<K extends keyof LookTweaks>(key: K, value: LookTweaks[K]): void {
    const id = editId();
    if (live && live.id !== id) commit();
    live ??= { id, tweaks: {} };
    live.tweaks = { ...live.tweaks, [key]: value };
    queuePaint();
    if (commitTimer === undefined) commitTimer = setTimeout(commit, COMMIT_MS);
  }
  function apply(next: LookState, opts: { readonly mine?: string; readonly removed?: string } = {}): void {
    const theme = !looksOn();
    const chosen = next.id !== lookState().id;
    commit();
    setLookState(theme ? seeded(next, chosen) : next, opts);
  }
  function say(text: string): void {
    line.textContent = text;
    line.hidden = false;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => (line.hidden = true), 4000);
  }
  let sayTimer: ReturnType<typeof setTimeout> | undefined;

  function setView(patch: Partial<StudioView>): void {
    const was = view;
    view = { ...view, ...patch };
    // On the specimen a kind is scrolled to, not built again.
    const restage = was.sheet !== view.sheet || (!view.sheet && was.kind !== view.kind) || was.compare !== view.compare || was.lang !== view.lang;
    if (restage) buildStage();
    else if (was.width !== view.width) layout();
    if (was.tab !== view.tab) drawDock();
    if (was.scheme !== view.scheme || was.width !== view.width || restage || was.compare !== view.compare || was.sheet !== view.sheet) drawTop();
    queuePaint();
  }

  const ctx: StudioCtx = {
    root,
    view: () => view,
    setView,
    state,
    editId,
    look: () => merged(state(), editId()),
    opened: () => openedLook,
    own: (key) => lookById(state(), editId())[key as keyof ReturnType<typeof lookById>] as never,
    set,
    reset(key) {
      if (live?.tweaks && key in live.tweaks) {
        const { [key]: _gone, ...rest } = live.tweaks;
        live.tweaks = rest;
      }
      const theme = !looksOn();
      commit();
      const next = tweak(lookState(), key, undefined, editId());
      setLookState(theme ? seeded(next) : next);
    },
    apply,
    canvasContext,
    canvasOver,
    resolved: () => resolvedNow ?? resolve(state(), canvasContext(), canvasOver()),
    logicalWidth,
    paint: paintEl,
    makeLeaf,
    contextOf,
    canvas: () => canvasLeaf,
    stage: () => stage,
    onPaint(cb) {
      paintListeners.add(cb);
      return () => paintListeners.delete(cb);
    },
    rebuild: buildStage,
    showMeasure(chars) {
      measureShown = chars;
      placeMeasure();
    },
    say,
    setKeyOwner(owner) {
      keyOwner = owner;
      root.toggleAttribute('data-marxy-fit', owner !== null);
      // Dimmed for the pointer by CSS; inert keeps Tab and Enter out of them too.
      for (const r of [top, shelf, why, dock]) r.inert = owner !== null;
    },
    close,
  };

  // ---- keys, opening, closing --------------------------------------------------------------------------------------
  function escape(): void {
    if (view.compare) setView({ compare: false });
    else close();
  }
  root.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (keyOwner && keyOwner(new KeyboardEvent('keydown', { key: 'Escape' }))) return;
    escape();
  });
  root.addEventListener('keydown', (e) => {
    if (keyOwner && keyOwner(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      escape();
    }
  });
  const offStore = onLookChange(() => queuePaint());
  const resize = new ResizeObserver(() => {
    layout();
    queuePaint();
  });

  function close(): void {
    if (closed) return;
    closed = true;
    dropFit();
    commit();
    holdLookChange(null);
    void flushLooks();
    cancelAnimationFrame(raf);
    offStore();
    resize.disconnect();
    tabCleanup?.();
    stageCleanup?.();
    paintListeners.clear();
    clearTimeout(sayTimer);
    root.close();
    root.remove();
    document.body.classList.remove('marxy-in-studio');
    current = null;
    if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
  }

  function open(a?: string): void {
    if (a === 'sheet') setView({ sheet: true, compare: false });
    else if (a === 'fit') startFit(ctx);
    else if (a && TABS.some(([id]) => id === a)) setView({ tab: a as TabId });
  }

  holdLookChange(commit);
  document.body.append(root);
  document.body.classList.add('marxy-in-studio');
  root.showModal();
  line.hidden = true;
  drawTop();
  drawDock();
  buildStage();
  fillShelf();
  resize.observe(stage);
  paintNow();
  open(arg);
  return { close, open };
}
