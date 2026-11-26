// The Studio's shelf of themes: every look as a row of two lines, its name and
// what it is, drawn in itself (its own page, its own heading and body faces, its own ink) and in the appearance it is
// known by, so a dark theme is dark on the shelf whatever the canvas is showing. Dark themes first, then light; the
// reader's own above both. The pointer or the arrow keys show a row on the canvas; a click or Enter chooses it.
import { LOOK_GROUPS, allLooks, isTweaked, removeMine, reset as resetLook, resolve, shownScheme, type Look } from '@marxy/theme';
import { btn, el } from '../frame/dom.ts';
import { lookState } from '../look/store.ts';
import type { StudioCtx } from './context.ts';

export interface Shelf {
  readonly el: HTMLElement;
  /** Paints every row again (a dial moved, a theme chosen). */
  paint(): void;
  /** Rebuilds the rows (a look saved or removed). */
  fill(): void;
}

export interface ShelfHost {
  /** The look that paints the page now (the theme's own while the theme does). */
  inUse(): string | null;
  /** A row chosen: put in use, in the appearance it is known by. */
  choose(id: string): void;
  /** What stands under the rows. */
  foot(): Node[];
}

export function makeShelf(ctx: StudioCtx, host: ShelfHost): Shelf {
  const root = el('div', 'marxy-studio-shelfbody');
  const list = el('div', 'marxy-studio-rows');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Themes');
  let rows: { readonly look: Look; readonly row: HTMLElement; readonly acts: HTMLElement }[] = [];
  let focusId: string | null = null;

  const show = (id: string | null): void => {
    if (ctx.view().hover !== id) ctx.setView({ hover: id });
  };
  const choose = (id: string): void => {
    show(null);
    host.choose(id);
  };

  function fill(): void {
    drawnFrom = '';
    const looks = allLooks(lookState());
    rows = [];
    list.replaceChildren();
    const shelves: { readonly name: string; readonly note: string; readonly looks: Look[] }[] = [];
    const mine = looks.filter((l) => l.mine);
    if (mine.length) shelves.push({ name: 'Yours', note: 'Saved here, kept in looks/ beside config.toml.', looks: mine });
    for (const g of LOOK_GROUPS) {
      const of = looks.filter((l) => !l.mine && (l.group ?? 'light') === g.id);
      if (of.length) shelves.push({ name: g.name, note: g.note, looks: of });
    }
    for (const shelf of shelves) {
      const group = el('div', 'marxy-studio-group');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', shelf.name);
      const head = el('div', 'marxy-studio-group-h', shelf.name);
      head.title = shelf.note;
      group.append(head);
      for (const look of shelf.looks) {
        const wrap = el('div', 'marxy-studio-rowwrap');
        const row = el('div', 'marxy-studio-themerow');
        row.setAttribute('role', 'option');
        row.dataset.marxyLook = look.id;
        row.tabIndex = -1;
        row.append(el('span', 'marxy-studio-row-name', look.name), el('span', 'marxy-studio-row-line', look.blurb));
        if (look.credit) row.title = look.credit;
        row.addEventListener('pointerenter', () => show(look.id));
        row.addEventListener('click', () => choose(look.id));
        row.addEventListener('focus', () => {
          focusId = look.id;
          show(look.id);
          for (const r of rows) r.row.tabIndex = r.look.id === look.id ? 0 : -1;
        });
        row.addEventListener('blur', () => {
          if (focusId === look.id) focusId = null;
          queueMicrotask(() => {
            if (!list.contains(document.activeElement)) show(null);
          });
        });
        const acts = el('div', 'marxy-studio-row-acts');
        wrap.append(row, acts);
        group.append(wrap);
        rows.push({ look, row, acts });
      }
      list.append(group);
    }
    root.replaceChildren(el('div', 'marxy-studio-h', 'Themes'), list, ...host.foot());
    paint();
  }

  // The preview is let go only when the pointer leaves the list, not a row: moving from one row to the next crosses the
  // gap between them, and letting go there showed the theme in use for a frame between every two previews.
  list.addEventListener('pointerleave', () => {
    if (focusId === null) show(null);
  });

  list.addEventListener('keydown', (e) => {
    const i = rows.findIndex((r) => r.row === document.activeElement);
    const go = (j: number): void => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      r?.row.focus();
      r?.row.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) choose(rows[i]!.look.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  /** What the rows were last drawn from: a preview moving over them changes none of it, so they are not resolved again. */
  let drawnFrom = '';
  function paint(): void {
    const s = ctx.state();
    const using = host.inUse();
    const shown = ctx.view().hover;
    const from = JSON.stringify([s.tweaks, s.mine, using, rows.length]);
    if (from === drawnFrom) {
      for (const { look, row } of rows) row.toggleAttribute('data-marxy-shown', shown === look.id);
      return;
    }
    drawnFrom = from;
    for (const { look, row, acts } of rows) {
      // Each row in its own look and its own appearance, as prose, with no rule of path or kind.
      const t = resolve(s, { kind: 'article', width: 900 }, { id: look.id, scheme: shownScheme(look), noRules: true }).tokens;
      const set = (k: string, v: string | undefined): void => {
        if (v !== undefined && row.style.getPropertyValue(k) !== v) row.style.setProperty(k, v);
      };
      set('--marxy-row-bg', t['--marxy-color-bg']);
      set('--marxy-row-ink', t['--marxy-color-text-secondary']);
      set('--marxy-row-strong', t['--marxy-color-text-strong']);
      set('--marxy-row-face', t['--marxy-font-text']);
      set('--marxy-row-head', t['--marxy-font-heading']);
      set('--marxy-row-weight', t['--marxy-weight-body']);
      set('--marxy-row-head-weight', t['--marxy-weight-heading']);
      set('--marxy-row-track', t['--marxy-tracking-heading']);
      set('--marxy-row-accent', t['--marxy-color-accent']);
      const on = using === look.id;
      row.setAttribute('aria-selected', String(on));
      row.toggleAttribute('data-marxy-on', on);
      row.toggleAttribute('data-marxy-shown', shown === look.id);
      // Under the chosen row, and any row changed: what undoes it.
      const kids: Node[] = [];
      if (isTweaked(s, look.id)) kids.push(btn('marxy-studio-link', 'Undo your changes', () => ctx.apply(resetLook(lookState(), look.id))));
      if (look.mine && on) kids.push(btn('marxy-studio-link', 'Remove', () => ctx.apply(removeMine(lookState(), look.id), { removed: look.id })));
      acts.replaceChildren(...kids);
      acts.hidden = kids.length === 0;
    }
    // The roving focus starts on the look in use.
    if (!rows.some((r) => r.row.tabIndex === 0)) {
      const start = rows.find((r) => r.look.id === using) ?? rows[0];
      if (start) start.row.tabIndex = 0;
    }
  }

  fill();
  return { el: root, paint, fill };
}
