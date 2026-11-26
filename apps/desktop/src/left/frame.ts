// The left section: a rail of eight panels in four groups with Look and Settings at its foot, and a
// drawer that shows one panel in one frame (head, top, body, and a foot that is the verb bar of the row under the
// panel cursor). The panel cursor has the page's keys; panels add no key listeners of their own. Contract:
// The frame (frame/frame.ts) places the rail and drawer; this draws them.
import { LEFT_PANELS, type CardId } from '@marxy/core/src/layout/frame-storage.ts';
import type { AppHandle } from '../app-types.ts';
import { chordText } from '../frame/branch-info.ts';
import { icon, railIcon } from '../frame/icons.ts';
import { anchorBelow, openMenu } from '../frame/menu.ts';
import type { FrameStore } from '../frame/state.ts';
import type { Frame } from '../frame/types.ts';
import { openStudio } from '../look/commands.ts';
import { notify } from '../notices/index.ts';
import { CARD_PANEL, EXTRA_NAMES, PANEL_LOADERS, PANEL_NAMES, RAIL_GROUPS, RAIL_LINES, addPanelCommands, panelKey } from './registry.ts';
import type { ExtraId, Left, PanelContext, PanelDef, PanelId, RailBadge, RowEvent, RowOptions, Verb } from './types.ts';
import { describeBody, describeLit, describeRow, nameControls } from './aria.ts';
import { enterOf, h, key as keyCap, onRowPress, rowOptions, scrollWithin } from './ui.ts';
import { hostExtra, type HostedBranch } from './host-branch.ts';
import { windowOf } from './row-window.ts';

export interface LeftHost {
  readonly handle: AppHandle;
  readonly frame: Frame;
  readonly store: FrameStore;
  /** The drawer was asked for: in a narrow window it comes over the page. */
  visit(): void;
  /** The visit is over (Escape, a press on the page). */
  leave(): void;
  /** Whether the drawer shows now, docked or over the page. */
  drawerShown(): boolean;
}

export interface LeftView extends Left {
  readonly rail: HTMLElement;
  readonly drawer: HTMLElement;
  /** The focused pane's document or focus changed: the panel draws again on the next frame. */
  soon(): void;
  /** The frame laid the window out again: the rail's marks and the drawer follow. */
  sync(): void;
  /** `b`, `Mod+B`: open, the rail alone, hidden, open. */
  cycle(): void;
  /** `Tab` from the page: the keys go to the panel (opening it if it is not shown). */
  focusPanel(): void;
  /** Settings or Clip in the drawer, or back to the panel when it already shows. */
  toggleExtra(id: ExtraId, focus?: boolean): void;
  extra(): ExtraId | null;
  /** The keys go back to the page; a drawer over the page goes. */
  toPage(): void;
  /** The panel that holds `card`'s content, shown (the head's guess mark, the crumbs' Facts). */
  showCard(card: CardId): void;
  destroy(): void;
  /** A panel's state once it has been drawn, else undefined: what another panel reads of it (Export, Places' ticks). */
  stateOf(id: PanelId): unknown;
}

const isPanel = (id: string): id is PanelId => (LEFT_PANELS as readonly string[]).includes(id);
const visible = (el: Element): boolean => el.getClientRects().length > 0;
const depthOf = (el: HTMLElement): number => (el.classList.contains('marxy-l-gh') ? -1 : Number(el.style.getPropertyValue('--marxy-l-depth') || '0'));
/** A tip shows after this long at rest on a rail button; once one has shown, the next shows at once until the pointer has been off the rail this long. */
const TIP_REST = 400;
const TIP_COOL = 600;
const caps = (bind: string): string => (bind.length === 1 ? bind : bind.replace(/^Alt\+/, 'Alt ').replace('ArrowUp', '↑').replace('ArrowDown', '↓'));

export function mountLeft(rail: HTMLElement, drawer: HTMLElement, host: LeftHost): LeftView {
  const { handle, store } = host;
  const defs = new Map<PanelId, PanelDef<any>>();
  const loading = new Map<PanelId, Promise<PanelDef<any> | null>>();
  const states = new Map<PanelId, unknown>();
  const contexts = new Map<PanelId, PanelContext<any>>();
  /** The cursor's row key in each panel, kept while the window lives. */
  const cursorOf = new Map<PanelId, string>();
  /** A row a panel asked the cursor onto (`ctx.cursorTo`, the Line's Tab): put there, with the page following, once drawn. */
  const aimed = new Map<PanelId, string>();
  let extra: { readonly id: ExtraId; readonly hosted: HostedBranch } | null = null;
  let gone = false;

  drawer.tabIndex = -1;
  const headEl = h('div', 'marxy-l-head');
  const topEl = h('div', 'marxy-l-top');
  const bodyEl = h('div', 'marxy-l-body');
  // Focusable by script only: with rows it holds the keys, so aria-activedescendant sits on a tree or listbox.
  bodyEl.tabIndex = -1;
  const footEl = h('div', 'marxy-l-foot');
  drawer.replaceChildren(headEl, topEl, bodyEl, footEl);

  const shownId = (): PanelId => store.state.leftPanel;

  // ---- the rail --------------------------------------------------------------------------------------------------
  const railButtons = new Map<string, HTMLButtonElement>();
  // One tip on <body>, not one per button: the rail is sticky with a z-index (a stacking context), so a tip inside it
  // went under the pane's head, the tab row and a drawer laid over the page, whatever its own z-index.
  const tip = h('span', 'marxy-l-tip');
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);
  // Sweeping down the rail must not flicker a tip at every button: the first waits, the rest follow while it is warm.
  let warm = false;
  let restTimer = 0;
  let coolTimer = 0;
  const hideTip = (): void => {
    clearTimeout(restTimer);
    tip.hidden = true;
  };
  const showTip = (b: HTMLElement, id: PanelId | 'look' | 'settings', name: string, chord: string): void => {
    clearTimeout(restTimer);
    tip.replaceChildren(h('span', 'marxy-l-tip-1', h('b', '', name), ' ', h('small', '', chordText(chord))), ' ', h('span', 'marxy-l-tip-2', RAIL_LINES[id]));
    const r = b.getBoundingClientRect();
    tip.style.left = `${Math.round(r.right + 6)}px`;
    tip.style.top = `${Math.round(r.top + r.height / 2)}px`;
    tip.hidden = false;
    warm = true;
  };
  const onRailEnter = (): void => clearTimeout(coolTimer);
  const onRailLeave = (): void => {
    clearTimeout(coolTimer);
    coolTimer = window.setTimeout(() => (warm = false), TIP_COOL);
  };
  rail.addEventListener('scroll', hideTip, { passive: true });
  rail.addEventListener('pointerenter', onRailEnter);
  rail.addEventListener('pointerleave', onRailLeave);
  const railButton = (id: PanelId | 'look' | 'settings', name: string, chord: string, run: () => void): HTMLButtonElement => {
    const b = h('button', 'marxy-l-rb');
    b.type = 'button';
    b.dataset.marxyLeft = id;
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', 'false');
    b.append(railIcon(id));
    b.addEventListener('pointerenter', () => {
      clearTimeout(restTimer);
      if (warm) showTip(b, id, name, chord);
      else restTimer = window.setTimeout(() => showTip(b, id, name, chord), TIP_REST);
    });
    b.addEventListener('pointerleave', hideTip);
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) showTip(b, id, name, chord);
    });
    b.addEventListener('blur', hideTip);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      hideTip();
      run();
    });
    railButtons.set(id, b);
    return b;
  };
  const badgeKeys = new Map<PanelId, string>();
  /** The rail's marks for state the reader made: each panel read so far is asked, cheaply. */
  function badges(): void {
    if (gone) return;
    for (const id of LEFT_PANELS) {
      const b = railButtons.get(id);
      const def = defs.get(id);
      if (!b) continue;
      const mark: RailBadge | null = def?.badge ? safe(() => def.badge?.(contextOf(def)) ?? null, null) : null;
      const key = mark ? `${mark.tone ?? 'faint'}|${mark.text ?? ''}|${mark.say}` : '';
      if ((badgeKeys.get(id) ?? '') === key) continue;
      badgeKeys.set(id, key);
      b.querySelector('.marxy-l-badge')?.remove();
      if (!mark) {
        b.setAttribute('aria-label', PANEL_NAMES[id]);
        continue;
      }
      const dot = !mark.text;
      b.append(h('span', `marxy-l-badge marxy-l-${mark.tone ?? 'faint'}${dot ? ' marxy-l-dot' : ''}`, dot ? '' : mark.text));
      b.setAttribute('aria-label', `${PANEL_NAMES[id]}, ${mark.say}`);
    }
  }
  rail.replaceChildren();
  RAIL_GROUPS.forEach((group, i) => {
    if (i > 0) rail.append(h('span', 'marxy-l-rule'));
    for (const id of group)
      rail.append(
        railButton(id, PANEL_NAMES[id], panelKey(id), () => {
          if (shownId() === id && extra === null && host.drawerShown()) {
            if (drawer.contains(document.activeElement)) toPage();
            store.update({ leftMode: 'rail' });
          } else view.show(id, undefined, false);
        }),
      );
  });
  rail.append(
    h('span', 'marxy-rail-grow'),
    // Look is the Studio: the whole window, not a branch of the drawer.
    railButton('look', EXTRA_NAMES.look, 'Mod+Alt+T', () => void openStudio()),
    railButton('settings', EXTRA_NAMES.settings, 'Mod+,', () => view.toggleExtra('settings', true)),
  );

  // ---- panels ----------------------------------------------------------------------------------------------------
  function contextOf(def: PanelDef<any>): PanelContext<any> {
    const known = contexts.get(def.id);
    if (known) return known;
    if (!states.has(def.id)) states.set(def.id, def.init ? def.init() : {});
    const ctx: PanelContext<any> = {
      handle,
      pane() {
        const p = handle.panes().focused;
        return p.path() === null ? null : p;
      },
      doc() {
        const p = handle.panes().focused;
        const path = p.path();
        const s = p.content.store();
        return path !== null && s ? { path, store: s } : null;
      },
      st: states.get(def.id),
      redraw: () => {
        if (shownId() === def.id) draw();
      },
      light: () => {
        if (shownId() === def.id) light();
      },
      rev() {
        let n = 0;
        for (const p of handle.panes().panes) n = (n * 31 + (p.content.store()?.snapshot().version ?? 0) + (p.path()?.length ?? 0)) | 0;
        return n;
      },
      cursorTo(key) {
        cursorOf.set(def.id, key);
        aimed.set(def.id, key);
      },
    };
    contexts.set(def.id, ctx);
    return ctx;
  }

  function ensure(id: PanelId): Promise<PanelDef<any> | null> {
    const have = defs.get(id);
    if (have) return Promise.resolve(have);
    let wait = loading.get(id);
    if (!wait) {
      wait = PANEL_LOADERS[id]().then(
        (m) => {
          view.register(m.default);
          addPanelCommands(safe(() => m.default.commands?.() ?? [], []));
          badges();
          return m.default;
        },
        (error: unknown) => {
          loading.delete(id);
          console.warn(`marxy: the ${id} panel could not be loaded`, error);
          notify({ kind: 'error', text: `${PANEL_NAMES[id]} could not be loaded · show it again to try once more.` });
          return null;
        },
      );
      loading.set(id, wait);
    }
    return wait;
  }

  const rows = (): HTMLElement[] => [...bodyEl.querySelectorAll<HTMLElement>('.marxy-l-prow')].filter(visible);
  /**
   * The rows the cursor walks, by place: a list drawn a window at a time (row-window.ts) is walked by its keys, each row
   * drawn and brought into view as the cursor reaches it; any other list is walked by the rows drawn.
   */
  function rowWalk(): { readonly n: number; at(i: number): HTMLElement | null; index(row: HTMLElement | null): number; depth(i: number): number } {
    const win = windowOf(bodyEl);
    if (win) return { n: win.keys.length, at: (i) => win.bring(i), index: (r) => (r ? win.indexOf(r.dataset.marxyLeftRow ?? '') : -1), depth: (i) => win.depthAt(i) };
    const rs = rows();
    return { n: rs.length, at: (i) => rs[i] ?? null, index: (r) => (r ? rs.indexOf(r) : -1), depth: (i) => (rs[i] ? depthOf(rs[i]) : 0) };
  }
  const curRow = (): HTMLElement | null => bodyEl.querySelector<HTMLElement>('.marxy-l-prow.marxy-l-cur');
  const keysHere = (): boolean => drawer.contains(document.activeElement);
  const keysEl = (): HTMLElement => (bodyEl.hasAttribute('role') ? bodyEl : drawer);
  function focusKeys(): void {
    keysEl().focus({ preventScroll: true });
  }
  /** Points the focused element at the cursor row; the drawer holds the keys itself where there are no rows. */
  function point(row: HTMLElement | null): void {
    const holder = keysEl();
    for (const el of [drawer, bodyEl]) if (el !== holder || !row?.id) el.removeAttribute('aria-activedescendant');
    if (row?.id) holder.setAttribute('aria-activedescendant', row.id);
    if (holder !== drawer && document.activeElement === drawer) holder.focus({ preventScroll: true });
  }

  function verbsOf(row: HTMLElement): Verb[] {
    const o = rowOptions(row);
    if (!o) return [];
    const vs = (o.verbs?.() ?? []).filter((v): v is Verb => v !== null);
    if (o.run && !vs.some((v) => v[0] === 'o')) vs.unshift(['o', o.go ?? 'open', (e) => o.run?.(e as RowEvent | undefined)]);
    return vs;
  }

  function nameOf(row: HTMLElement): string {
    return rowOptions(row)?.what ?? (row.querySelector('.marxy-l-nm, b, .marxy-l-tx') ?? row).textContent?.trim() ?? '';
  }

  function drawFoot(): void {
    footEl.replaceChildren();
    const row = curRow();
    if (extra) return;
    if (!row || !keysHere()) {
      footEl.append(h('span', 'marxy-l-what marxy-l-rest', defs.get(shownId())?.rest ?? 'Tab comes here. J K move, Enter lists the verbs.'));
      return;
    }
    const vs = verbsOf(row);
    const what = nameOf(row);
    const w = h('span', 'marxy-l-what', what);
    w.title = what;
    footEl.append(w);
    for (const [bind, label, run] of vs.slice(0, 4)) footEl.append(verbButton(bind, label, (e) => run(e)));
    if (vs.length > 4 && !rowOptions(row)?.enter) footEl.append(verbButton('Enter', 'all', () => verbMenu(row)));
  }

  /** A verb in the foot: its key cap and word, pressed as the key is (on the row under the cursor), keeping the keys here. */
  function verbButton(bind: string, label: string, run: (e: MouseEvent) => void): HTMLButtonElement {
    const b = h('button', 'marxy-l-vb', keyCap(caps(bind)), ` ${label}`);
    b.type = 'button';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      if (curRow()) run(e);
    });
    return b;
  }

  function verbMenu(row: HTMLElement): void {
    const vs = verbsOf(row);
    openMenu(anchorBelow(row), nameOf(row), vs.map(([bind, label, run]) => ({ title: label[0]!.toUpperCase() + label.slice(1), chord: bind.length === 1 && bind !== bind.toLowerCase() ? `Shift+${bind}` : bind, run: () => run() })));
  }

  function setCur(row: HTMLElement | null, byMouse = false): void {
    for (const r of bodyEl.querySelectorAll('.marxy-l-cur')) r.classList.remove('marxy-l-cur');
    windowOf(bodyEl)?.mark('marxy-l-cur', row?.dataset.marxyLeftRow ?? null, true);
    const id = shownId();
    aimed.delete(id);
    if (!row) {
      cursorOf.delete(id);
      point(null);
      drawFoot();
      return;
    }
    row.classList.add('marxy-l-cur');
    describeRow(row, row.getAttribute('role') === 'treeitem');
    point(row);
    if (row.dataset.marxyLeftRow !== undefined) cursorOf.set(id, row.dataset.marxyLeftRow);
    scrollWithin(row);
    drawFoot();
    if (!byMouse) rowOptions(row)?.at?.();
  }
  onRowPress((row) => {
    if (bodyEl.contains(row)) setCur(row, true);
  });

  function move(by: number): void {
    const w = rowWalk();
    if (w.n === 0) return;
    const at = w.index(curRow());
    const next = at < 0 ? (by > 0 ? 0 : w.n - 1) : Math.max(0, Math.min(w.n - 1, at + by));
    setCur(w.at(next));
  }

  // A draw makes the panel's controls again. One between a press and its release takes the pressed button away under
  // the pointer, and its click is lost (a search's result landing as Aa or word is pressed): such a draw waits for the click.
  let pressed = false;
  let owed = false;
  const listening = new AbortController();
  const release = (): void => {
    if (!pressed) return;
    pressed = false;
    if (owed) {
      owed = false;
      draw();
    }
  };
  drawer.addEventListener('pointerdown', (e) => {
    if (e.button === 0) pressed = true;
  }, { signal: listening.signal });
  // On the window, bubbling: after the control's own click handler. A release with no click (dragged off) frees it a task later.
  window.addEventListener('click', release, { signal: listening.signal });
  window.addEventListener('pointerup', () => setTimeout(release, 0), { capture: true, signal: listening.signal });
  window.addEventListener('pointercancel', release, { capture: true, signal: listening.signal });
  window.addEventListener('blur', release, { signal: listening.signal });

  let drawing = false;
  function draw(): void {
    if (gone || drawing) return;
    if (pressed) {
      owed = true;
      return;
    }
    if (extra) return drawExtra();
    drawer.dataset.marxyLeft = shownId();
    delete drawer.dataset.marxyBranch;
    if (!host.drawerShown()) return;
    const id = shownId();
    const def = defs.get(id);
    if (!def) {
      headEl.replaceChildren(h('b', '', PANEL_NAMES[id]));
      topEl.replaceChildren();
      bodyEl.replaceChildren();
      describeBody(bodyEl, PANEL_NAMES[id]);
      if (document.activeElement === bodyEl) drawer.focus({ preventScroll: true });
      point(null);
      drawFoot();
      void ensure(id).then((d) => {
        if (d && shownId() === id) draw();
      });
      return;
    }
    drawing = true;
    try {
      const ctx = contextOf(def);
      const act = document.activeElement;
      const inside = act instanceof HTMLElement && drawer.contains(act);
      const field = inside && act instanceof HTMLInputElement ? act.dataset.marxyLeftField : undefined;
      const caret = field !== undefined && act instanceof HTMLInputElement ? [act.selectionStart, act.selectionEnd] : null;
      const same = bodyEl.dataset.marxyLeft === id;
      const scroll = bodyEl.scrollTop;
      headEl.replaceChildren(h('b', '', def.name), h('span', 'marxy-l-subject', safe(() => def.subject(ctx), '')));
      for (const b of safe(() => def.buttons?.(ctx) ?? [], []).slice(0, 2)) {
        const button = h('button', 'marxy-l-hb', b.icon ? icon(b.icon) : b.label);
        button.type = 'button';
        button.title = b.title;
        button.setAttribute('aria-label', b.title);
        button.addEventListener('click', (e) => b.run(e));
        headEl.append(button);
      }
      topEl.replaceChildren();
      bodyEl.replaceChildren();
      bodyEl.dataset.marxyLeft = id;
      try {
        def.render(ctx, bodyEl, topEl);
      } catch (error) {
        bodyEl.append(h('div', 'marxy-l-empty', 'This panel could not be drawn.'));
        console.warn(`marxy: the ${id} panel could not be drawn`, error);
      }
      const win = windowOf(bodyEl);
      describeBody(bodyEl, def.name, win?.nests);
      // Rows coming or going moves the keys between the drawer and its list.
      if (document.activeElement === drawer || document.activeElement === bodyEl) focusKeys();
      nameControls(topEl);
      nameControls(bodyEl);
      bodyEl.scrollTop = same ? scroll : 0;
      win?.fill();
      const k = cursorOf.get(id);
      let back: HTMLElement | null | undefined;
      if (k !== undefined && win) {
        // The cursor's row is kept drawn by its mark, wherever the list is scrolled.
        const i = win.indexOf(k);
        if (i >= 0) win.mark('marxy-l-cur', k, true);
        back = i >= 0 ? win.drawn(i) : undefined;
      } else back = k === undefined ? undefined : rows().find((r) => r.dataset.marxyLeftRow === k);
      if (back) back.classList.add('marxy-l-cur');
      if (back && aimed.get(id) === k) {
        aimed.delete(id);
        setCur(back);
      }
      point(curRow());
      if (field !== undefined) {
        const input = topEl.querySelector<HTMLInputElement>(`input[data-marxy-left-field="${CSS.escape(field)}"]`) ?? bodyEl.querySelector<HTMLInputElement>(`input[data-marxy-left-field="${CSS.escape(field)}"]`);
        if (input) {
          input.focus({ preventScroll: true });
          if (caret) input.setSelectionRange(caret[0], caret[1]);
        } else focusKeys();
      } else if (inside) {
        // A hosted control kept across the draw keeps focus; anything else hands it to the drawer.
        if (act.isConnected) act.focus({ preventScroll: true });
        else focusKeys();
      }
    } finally {
      drawing = false;
    }
    drawFoot();
    badges();
  }

  function drawExtra(): void {
    if (!extra) return;
    drawer.dataset.marxyBranch = extra.id;
    delete drawer.dataset.marxyLeft;
    delete bodyEl.dataset.marxyLeft;
    bodyEl.removeAttribute('role');
    bodyEl.removeAttribute('aria-label');
    if (document.activeElement === bodyEl) drawer.focus({ preventScroll: true });
    point(null);
    const subject = extra.id === 'settings' ? 'config.toml' : (handle.panes().focused.path()?.split(/[\\/]/).pop() ?? '');
    headEl.replaceChildren(h('b', '', EXTRA_NAMES[extra.id]), h('span', 'marxy-l-subject', subject));
    topEl.replaceChildren();
    if (extra.hosted.el.parentElement !== bodyEl) bodyEl.replaceChildren(extra.hosted.el);
    footEl.replaceChildren(extra.hosted.foot);
  }

  function light(): void {
    if (extra || !host.drawerShown()) return;
    const def = defs.get(shownId());
    if (def?.light) {
      const was = [...bodyEl.querySelectorAll<HTMLElement>('.marxy-l-prow.marxy-l-at')];
      safe(() => def.light?.(contextOf(def), bodyEl), undefined);
      describeLit(bodyEl, def.name, was, windowOf(bodyEl)?.nests);
    }
  }

  function closeExtra(): void {
    if (!extra) return;
    extra.hosted.dispose();
    extra = null;
    footEl.replaceChildren();
    bodyEl.replaceChildren();
  }

  /** Focus to the panel's field (a hosted branch draws its own a moment later), else to its rows. */
  function focusFirst(id: PanelId, field: boolean, tries = 12): void {
    if (gone || shownId() !== id || extra) return;
    if (field) {
      const input = topEl.querySelector<HTMLInputElement>('input') ?? bodyEl.querySelector<HTMLInputElement>('input');
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
        return;
      }
      if (tries > 0 && bodyEl.querySelector('.marxy-l-host')) {
        focusKeys();
        requestAnimationFrame(() => focusFirst(id, field, tries - 1));
        return;
      }
    }
    focusKeys();
    // A row aimed at and not drawn yet (results worked out after the list draws) keeps its claim on the cursor.
    if (!curRow() && !aimed.has(id)) setCur(rowWalk().at(0), true);
    else drawFoot();
  }

  function toPage(): void {
    const had = drawer.contains(document.activeElement);
    host.leave();
    if (had || document.activeElement === document.body) handle.panes().focus(handle.panes().focused);
    drawFoot();
  }

  // ---- keys ------------------------------------------------------------------------------------------------------
  const keyOf = (e: KeyboardEvent): string => {
    const k = e.key === ' ' ? 'Space' : e.key;
    if (e.altKey) return `Alt+${e.shiftKey ? 'Shift+' : ''}${k}`;
    return e.shiftKey && k.length > 1 ? `Shift+${k}` : k;
  };

  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (e.altKey && !/^Arrow/.test(e.key)) return;
    if (document.querySelector('dialog[open], [role="menu"]')) return;
    const stop = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    const t = e.target;
    if (t instanceof HTMLInputElement && t.dataset.marxyLeftField !== undefined) {
      if (e.key === 'Escape') {
        if (t.value) {
          t.value = '';
          t.dispatchEvent(new Event('input', { bubbles: true }));
        } else focusKeys();
        stop();
      } else if (e.key === 'Enter' && enterOf(t)) {
        enterOf(t)?.(e);
        stop();
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        focusKeys();
        if (!curRow()) move(1);
        else drawFoot();
        stop();
      }
      return;
    }
    if (t !== drawer && t !== bodyEl) {
      // A control of a hosted page (a branch, a card): its own keys, but Escape gives the keys back. A field keeps it
      // while it has words to clear (Settings' "Find a setting" clears itself first); an empty one gives it back too.
      const holds = t instanceof HTMLElement && t.closest('textarea, select, [contenteditable]') !== null;
      const field = t instanceof HTMLInputElement && /^(text|search|url|email|tel|password)$/.test(t.type) && t.value !== '';
      if (e.key === 'Escape' && !holds && !field) {
        stop();
        if (extra) view.toggleExtra(extra.id);
        else toPage();
      }
      return;
    }
    const k = keyOf(e);
    const row = curRow();
    const o: RowOptions | undefined = row ? rowOptions(row) : undefined;
    if (k === 'j' || k === 'ArrowDown') move(1);
    else if (k === 'k' || k === 'ArrowUp') move(-1);
    else if (k === 'Home') setCur(rowWalk().at(0));
    else if (k === 'End') {
      const w = rowWalk();
      setCur(w.at(w.n - 1));
    }
    else if (k === 'Escape' || k === 'Tab') {
      if (extra && k === 'Escape') view.toggleExtra(extra.id);
      else toPage();
    } else if (k === '/') {
      const input = topEl.querySelector<HTMLInputElement>('input');
      if (input) {
        input.focus();
        input.select();
      }
    } else if (!row || !o) {
      if (k.length > 1) return;
    } else if ((k === 'J' || k === 'K') && o.tick) {
      o.tick(e);
      move(k === 'J' ? 1 : -1);
    } else if (k === 'Space' && o.tick) o.tick(e);
    else if (k === 'l' || k === 'ArrowRight') {
      if (o.toggle && !o.open) o.toggle({});
      else {
        const w = rowWalk();
        const i = w.index(row);
        if (i >= 0 && i + 1 < w.n && w.depth(i + 1) > w.depth(i)) setCur(w.at(i + 1));
      }
    } else if (k === 'h' || k === 'ArrowLeft') {
      if (o.toggle && o.open) o.toggle({});
      else {
        const w = rowWalk();
        const at = w.index(row);
        for (let i = at - 1; i >= 0; i--)
          if (w.depth(i) < w.depth(at)) {
            setCur(w.at(i));
            break;
          }
      }
    } else if (k === 'Enter' && o.enter) o.enter(e);
    else if (k === 'Enter') {
      const vs = verbsOf(row!);
      if (vs.length > 1) verbMenu(row!);
      else if (vs[0]) vs[0][2](e);
      else o.toggle?.({});
    } else if (k === 'O' && o.run) o.run({ ctrlKey: true, beside: true });
    else {
      const v = verbsOf(row!).find((x) => x[0] === k);
      if (v) v[2](e);
      else if (k.length > 1) return;
    }
    stop();
  }
  drawer.addEventListener('keydown', onKey);
  drawer.addEventListener('focusin', () => drawFoot());
  drawer.addEventListener('focusout', () => setTimeout(() => !gone && drawFoot(), 0));
  // A press on a row keeps the keys in the panel; a field or a hosted control takes focus as usual.
  drawer.addEventListener('mousedown', (e) => {
    if (e.target instanceof Element && e.target.closest('.marxy-l-prow') && !e.target.closest('input, textarea, select, button')) {
      e.preventDefault();
      focusKeys();
    }
  });

  // ---- what makes the panel draw again ---------------------------------------------------------------------------
  let queued = false;
  const later = (): void => {
    if (queued || gone) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
      badges();
    });
  };
  const scrollOffs = new Map<unknown, () => void>();
  const followScroll = (): void => {
    const panes = handle.panes().panes;
    const live = new Set<unknown>(panes);
    // A closed pane's subscription goes with it.
    for (const [p, off] of scrollOffs) {
      if (live.has(p)) continue;
      off();
      scrollOffs.delete(p);
    }
    for (const p of panes) {
      if (scrollOffs.has(p)) continue;
      let q = false;
      scrollOffs.set(
        p,
        p.view.onScroll(() => {
          if (q) return;
          q = true;
          requestAnimationFrame(() => {
            q = false;
            light();
          });
        }),
      );
    }
  };
  followScroll();

  const view: LeftView = {
    rail,
    drawer,
    register(def) {
      defs.set(def.id, def);
    },
    show(id, arg, focus = true) {
      closeExtra();
      host.visit();
      store.update({ leftPanel: id, leftMode: 'open', folded: false });
      void ensure(id).then((def) => {
        if (!def || shownId() !== id || extra) return;
        aimed.delete(id);
        if (arg !== undefined && def.take) safe(() => def.take?.(contextOf(def), arg), undefined);
        // A take that named a row gives the keys to the rows, not the field: the result is under the cursor.
        const toRow = aimed.has(id);
        if (toRow && focus) focusKeys();
        draw();
        if (focus) focusFirst(id, arg !== undefined && def.field === true && !toRow);
      });
    },
    shown: () => (extra || !host.drawerShown() ? null : shownId()),
    draw,
    soon: later,
    sync() {
      followScroll();
      const shown = host.drawerShown();
      for (const [id, b] of railButtons) b.setAttribute('aria-pressed', String(shown && (extra ? extra.id === id : id === shownId())));
      if (shown) draw();
      else if (extra) closeExtra();
      badges();
    },
    cycle() {
      const mode = store.state.leftMode;
      if (mode === 'open' && !host.drawerShown() && !store.state.folded) {
        host.visit();
        return;
      }
      if (drawer.contains(document.activeElement)) toPage();
      store.update({ leftMode: mode === 'open' ? 'rail' : mode === 'rail' ? 'hidden' : 'open', folded: false });
    },
    focusPanel() {
      if (!host.drawerShown() || extra) {
        view.show(shownId());
        return;
      }
      void ensure(shownId()).then(() => focusFirst(shownId(), false));
    },
    toggleExtra(id, focus = true) {
      if (extra?.id === id && host.drawerShown()) {
        const had = drawer.contains(document.activeElement);
        closeExtra();
        draw();
        if (had) toPage();
        view.sync();
        return;
      }
      closeExtra();
      // The drawer is shown first: a layout run while it is still shut would take the branch away again.
      if (store.state.leftMode !== 'open' || store.state.folded) store.update({ leftMode: 'open', folded: false });
      host.visit();
      extra = { id, hosted: hostExtra(id, handle, host.frame) };
      view.sync();
      drawExtra();
      if (focus) extra.hosted.focusSoon();
    },
    extra: () => extra?.id ?? null,
    toPage,
    showCard(card) {
      view.show(CARD_PANEL[card], { card }, false);
    },
    destroy() {
      gone = true;
      listening.abort();
      clearTimeout(idle);
      clearTimeout(restTimer);
      clearTimeout(coolTimer);
      closeExtra();
      for (const off of scrollOffs.values()) off();
      drawer.removeEventListener('keydown', onKey);
      rail.removeEventListener('scroll', hideTip);
      rail.removeEventListener('pointerenter', onRailEnter);
      rail.removeEventListener('pointerleave', onRailLeave);
      tip.remove();
      rail.replaceChildren();
      drawer.replaceChildren();
    },
    stateOf: (id) => states.get(id),
  };
  // A panel named by the saved state is read now, so the first draw has it.
  if (isPanel(shownId())) void ensure(shownId()).then(() => later());
  // Every panel is read once the window is idle, so their commands are in the Line from then on.
  const idle = setTimeout(() => {
    if (!gone) for (const id of LEFT_PANELS) void ensure(id);
  }, 1500);
  return view;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    console.warn('marxy: a panel failed', error);
    return fallback;
  }
}
