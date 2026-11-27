// The look at hand (`lookPop`): `a` on the page opens a small pop-over with the
// looks as live swatches, size, measure and leading, day or night, lean back, the way into the Studio, and why the focused
// pane looks as it does. Every change goes through the look store, so the page follows at once and the file a moment later.
import { LOOK_GROUPS, allLooks, isTweaked, merged, reset, resolve, setLean, setLook, setMode, shownScheme, tweak, type Mode } from '@marxy/theme';
import { btn, el, segmented, toggle } from '../frame/dom.ts';
import { appHandle } from '../commands/app-handle.ts';
import { lookContext, paneResolved, shownLookId } from './painted.ts';
import { lookState, looksOn, onLookChange, setLookState, turnLooksOff } from './store.ts';
import { themeLookId } from './theme-look.ts';

let open: { close(): void } | null = null;

export const lookPopOpen = (): boolean => open !== null;

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

export function toggleLookPop(openStudio: () => void): void {
  if (open) {
    open.close();
    return;
  }
  const before = document.activeElement;
  const pop = el('dialog', 'marxy-look-pop');
  pop.setAttribute('aria-label', 'Look');
  const draw = (): void => {
    const s = lookState();
    // The steps change the look the focused pane wears (a rule's, perhaps), as + and - do.
    const shown = shownLookId(s, appHandle()?.panes().focused);
    const cur = merged(s, shown);
    // A list, the theme in use first in view: with every theme a look, the shelf is long for a grid of swatches.
    const grid = el('div', 'marxy-look-pop-looks');
    const using = looksOn() ? s.id : themeLookId();
    const looks = allLooks(s);
    // Dark and light apart, as the Studio's shelf has them; each swatch in the appearance the look is known by, and a look
    // chosen here is seen as chosen (a dark one turns the page dark).
    const ordered = LOOK_GROUPS.flatMap((g) => {
      const of = looks.filter((l) => (l.group ?? 'light') === g.id);
      return of.length ? [g.name, ...of] : [];
    });
    for (const item of ordered) {
      if (typeof item === 'string') {
        grid.append(el('div', 'marxy-look-pop-group', item));
        continue;
      }
      const look = item;
      const r = resolve(s, { kind: 'article', width: 900, ...lookContext() }, { id: look.id, scheme: shownScheme(look) });
      const sw = el('span', 'marxy-look-pop-sw', 'Ag');
      sw.style.background = r.tokens['--marxy-color-bg']!;
      sw.style.color = r.tokens['--marxy-color-text-strong']!;
      sw.style.fontFamily = r.tokens['--marxy-font-text']!;
      const b = btn('marxy-look-pop-look', '', () => setLookState(setMode(setLook(lookState(), look.id), shownScheme(look))));
      b.title = look.blurb;
      b.setAttribute('aria-pressed', String(look.id === using));
      b.append(sw, el('span', 'marxy-look-pop-name', look.name));
      grid.append(b);
    }
    const step = (label: string, key: 'size' | 'measure' | 'lead', d: number, fmt: (v: number) => string, lo: number, hi: number): HTMLElement => {
      const row = el('div', 'marxy-look-pop-row');
      const v = cur[key];
      const set = (n: number): void => setLookState(tweak(lookState(), key, clamp(Number(n.toFixed(2)), lo, hi), shown));
      const less = btn('marxy-look-pop-step', '−', () => set(v - d), `${label} less`);
      const more = btn('marxy-look-pop-step', '+', () => set(v + d), `${label} more`);
      row.append(el('span', 'marxy-look-pop-k', label), less, el('b', 'marxy-look-pop-v', fmt(v)), more);
      return row;
    };
    const modeRow = el('div', 'marxy-look-pop-row');
    modeRow.append(
      el('span', 'marxy-look-pop-k', 'Day or night'),
      segmented<Mode>('Day or night', [['system', 'System'], ['clock', 'Clock'], ['day', 'Day'], ['night', 'Night']], s.mode, (m) => setLookState(setMode(lookState(), m))),
    );
    const leanRow = el('div', 'marxy-look-pop-row');
    leanRow.append(el('span', 'marxy-look-pop-k', 'Lean back'), toggle('Lean back', s.lean, (v) => setLookState(setLean(lookState(), v))));
    const buttons = el('div', 'marxy-look-pop-row marxy-look-pop-buttons');
    const studio = btn('marxy-btn', 'Open the Studio', () => {
      close();
      openStudio();
    });
    studio.setAttribute('data-marxy-primary', '');
    buttons.append(studio);
    if (looksOn() && isTweaked(s, shown)) buttons.append(btn('marxy-btn', 'Undo my changes', () => setLookState(reset(lookState(), shown))));
    if (looksOn()) buttons.append(btn('marxy-btn', 'Use the theme', () => turnLooksOff()));
    const why = el('div', 'marxy-look-pop-why');
    const pane = appHandle()?.panes().focused;
    // Resolved here: the painter's record of the pane lands a frame after the change that redraws this.
    const res = pane ? paneResolved(s, pane) : null;
    if (looksOn() && res) {
      why.append(el('h6', 'marxy-look-pop-h', 'Why this pane looks as it does'));
      const list = el('ul');
      for (const w of res.why) list.append(el('li', '', w.text));
      const f = res.facts;
      why.append(list, el('p', 'marxy-look-pop-facts', `${f.size} px on ${f.line} px${f.chars ? `, ${f.chars} characters a line` : ''} · text ${f.contrast.toFixed(1)} : 1`));
    } else {
      why.append(el('p', 'marxy-look-pop-facts', 'The theme config.toml names paints the page now. Choosing a look, or changing one here, hands the page to the looks.'));
    }
    pop.replaceChildren(el('h6', 'marxy-look-pop-h', 'Look'), grid, step('Size', 'size', 1, (v) => `${v} px`, 14, 34), step('Measure', 'measure', 2, (v) => `${v} characters`, 45, 80), step('Leading', 'lead', 0.05, (v) => v.toFixed(2), 1.2, 2), modeRow, leanRow, buttons, why);
  };
  const off = onLookChange(() => queueMicrotask(draw));
  const outside = (e: MouseEvent): void => {
    if (!pop.contains(e.target as Node)) close();
  };
  function close(): void {
    if (!open) return;
    open = null;
    off();
    removeEventListener('mousedown', outside, true);
    pop.close();
    pop.remove();
    if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
  }
  pop.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  draw();
  document.body.append(pop);
  pop.show();
  open = { close };
  setTimeout(() => addEventListener('mousedown', outside, true), 0);
}

export function closeLookPop(): void {
  open?.close();
}
