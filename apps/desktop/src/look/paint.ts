// The look on the page: the window's chrome painted once from the look in use, and each pane
// painted from `resolve` with its own context (the kind its document was read as, its path, its width), so a rule such
// as "files in reading/ use Book" or "in a narrow pane, tighten the page" holds pane by pane. Repainted when the look
// changes, a pane opens, closes or changes width, the system turns dark, or more contrast is asked for. First text never
// waits on it: the default theme's values are inlined in index.html as before, and the looks are read after the launch.
import { resolve, resolveWindow, type Resolved } from '@marxy/theme';
import type { AppShell } from '../app-types.ts';
import type { AppPanes } from '../pane/index.ts';
import { paneKind } from '../pane/dom.ts';
import { applyVariant } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { paintLangColour, setLookVars } from '../theme/lang-colour.ts';
import { onReaderConfigApplied, reapplyReaderConfig } from '../theme/reader-config.ts';
import { loadLooks, lookState, looksOn, onLookChange } from './store.ts';
import css from './look.css?inline';
import { lookContext, notePainted } from './painted.ts';

const LOOK_ATTR = 'data-marxy-look';
const PARA_ATTR = 'data-marxy-look-para';
const SCHEME_ATTR = 'data-marxy-scheme';
const ALIGN_ATTR = 'data-marxy-look-align';

/** Every property and attribute painted on an element, so the theme comes back whole when the looks go off. */
const painted = new WeakMap<HTMLElement, { readonly props: string[]; readonly type: string }>();
/** The type part of a resolve: when it changes, the typesetter measures the page again. */
const typeKey = (r: Resolved): string =>
  Object.entries(r.tokens)
    .filter(([k]) => !/^--marxy-(color|tok|pl)-/.test(k))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

function paintEl(el: HTMLElement, r: Resolved): boolean {
  const before = painted.get(el);
  // A type token found changed under the same look was written over (a config.toml write): measured again too.
  let retyped = false;
  for (const [k, v] of Object.entries(r.tokens)) {
    if (el.style.getPropertyValue(k) === v) continue;
    el.style.setProperty(k, v);
    if (!/^--marxy-(color|tok|pl)-/.test(k)) retyped = true;
  }
  el.setAttribute(LOOK_ATTR, r.look.id);
  el.setAttribute(SCHEME_ATTR, r.scheme);
  // Only a pane is indented or justified: on the root they would reach every article under it (a pane a rule paints in
  // another look, the Studio's before).
  const pane = el !== document.documentElement;
  if (pane && r.look.para === 'indent' && r.subject === 'prose') el.setAttribute(PARA_ATTR, 'indent');
  else el.removeAttribute(PARA_ATTR);
  // Justified prose (Book): base.css justifies it, and the ragged line breaker stands aside for it.
  if (pane && r.tokens['--marxy-justify'] === '1') el.setAttribute(ALIGN_ATTR, 'justify');
  else el.removeAttribute(ALIGN_ATTR);
  const type = typeKey(r);
  painted.set(el, { props: Object.keys(r.tokens), type });
  notePainted(el === document.documentElement ? null : el, r);
  return before !== undefined && (before.type !== type || retyped);
}

function clearEl(el: HTMLElement): void {
  const was = painted.get(el);
  if (!was) return;
  for (const k of was.props) el.style.removeProperty(k);
  el.removeAttribute(LOOK_ATTR);
  el.removeAttribute(PARA_ATTR);
  el.removeAttribute(ALIGN_ATTR);
  el.removeAttribute(SCHEME_ATTR);
  painted.delete(el);
  notePainted(el === document.documentElement ? null : el, null);
}

export interface LookPainter {
  /** Paints now (a test, or the Studio after a change it holds back). */
  paint(): void;
  stop(): void;
}

let current: LookPainter | null = null;
/** The painter of this window, once the panes have one. */
export const lookPainter = (): LookPainter | null => current;

export function installLookPainter(panes: Pick<AppPanes, 'panes' | 'onChange'>, deps: { readonly shell: AppShell; readonly ready: Promise<unknown> }): LookPainter {
  const doc = document;
  const root = doc.documentElement;
  let wasOn = false;
  let queued = false;
  let relayoutTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function relayout(): void {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      for (const pane of panes.panes) void pane.view.relayoutForTheme();
    }, 60);
  }

  function paint(): void {
    queued = false;
    if (stopped) return;
    const hosts = panes.panes.map((p) => p.host);
    if (!looksOn()) {
      if (!wasOn) return;
      wasOn = false;
      clearEl(root);
      for (const h of hosts) clearEl(h);
      setLookVars(false, doc);
      // The look painted over config.toml's sizes, measure and variant: they come back as the file says them now.
      reapplyReaderConfig(root);
      relayout();
      return;
    }
    const firstTime = !wasOn;
    wasOn = true;
    const state = lookState();
    const env = lookContext(doc);
    const win = resolveWindow(state, { ...env, width: doc.documentElement.clientWidth });
    let moved = paintEl(root, win);
    const variant = win.scheme === 'night' ? 'dark' : 'light';
    if (root.getAttribute('data-marxy-variant') !== variant) applyVariant(variant, doc);
    for (const pane of panes.panes) {
      const r = resolve(state, { ...env, scheme: win.scheme, kind: paneKind(pane.host), path: pane.path(), width: pane.host.clientWidth || doc.documentElement.clientWidth });
      moved = paintEl(pane.host, r) || moved;
    }
    setLookVars(true, doc);
    paintLangColour(doc);
    if (moved || firstTime) relayout();
  }

  function queue(): void {
    if (queued || stopped) return;
    queued = true;
    requestAnimationFrame(() => paint());
  }

  adoptRuntimeSheet(doc, 'marxy-look-style', css);
  const offStore = onLookChange(queue);
  const offPanes = panes.onChange(queue);
  const offConfig = onReaderConfigApplied(queue);
  const attrs = new MutationObserver(queue);
  attrs.observe(root, { attributes: true, attributeFilter: ['data-marxy-contrast', 'data-marxy-variant'] });
  const kinds = new MutationObserver(queue);
  const sizes = new ResizeObserver(queue);
  const watchHosts = (): void => {
    for (const pane of panes.panes) {
      kinds.observe(pane.host, { attributes: true, attributeFilter: ['data-marxy-kind'] });
      sizes.observe(pane.host);
    }
  };
  watchHosts();
  const offWatch = panes.onChange(watchHosts);
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  dark.addEventListener('change', queue);
  // The clock decides night in "clock" mode: looked at again every few minutes.
  const clock = setInterval(() => {
    if (looksOn() && lookState().mode === 'clock') queue();
  }, 300_000);

  void Promise.resolve(deps.ready)
    .catch(() => undefined)
    .then(() => loadLooks(deps.shell));

  const painter: LookPainter = {
    paint,
    stop() {
      stopped = true;
      offStore();
      offPanes();
      offConfig();
      offWatch();
      attrs.disconnect();
      kinds.disconnect();
      sizes.disconnect();
      dark.removeEventListener('change', queue);
      clearInterval(clock);
      clearTimeout(relayoutTimer);
      if (current === painter) current = null;
    },
  };
  current = painter;
  return painter;
}
