// The Studio's Colours tab: where a theme is made colour by colour. Every role the look paints
// with, by the scheme the Studio shows, as a swatch you can pick, its hex you can type, and what it measures against the
// ground it sits on. A colour set here is a pin (look.ts): it is used as set while it holds its floor, and walked to the
// floor and said so when it does not. Setting one puts the dial that would move it back to the theme's own, so the
// colour shows as set.
import { hexRatio, resolve, type Look, type LookTweaks, type Pins, type Scheme } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { btn, el } from '../frame/dom.ts';
import type { StudioCtx, StudioPiece } from './context.ts';
import css from './tab-colours.css?inline';

type Role = keyof Omit<Pins, 'tok' | 'weight' | 'headWeight' | 'strongWeight' | 'extra' | 'shadow' | 'glass'> | `tok.${string}`;
type Dial = 'tone' | 'ink' | 'accent' | 'code';

interface Row {
  readonly role: Role;
  readonly label: string;
  readonly token: string;
  /** The ground its contrast is read against, as a token; none for a ground itself. */
  readonly on?: string;
  readonly onWord?: string;
  readonly floor?: number;
  readonly dials: readonly Dial[];
}

const R = (role: Role, label: string, token: string, dials: readonly Dial[], on?: string, onWord?: string, floor?: number): Row => ({ role, label, token, dials, on, onWord, floor });
const BG = '--marxy-color-bg';
const CODE = '--marxy-color-code-bg';

const COLUMNS: readonly (readonly [string, readonly Row[]])[] = [
  ['The page', [
    R('bg', 'Page', BG, ['tone']),
    R('surface', 'Raised', '--marxy-color-surface', ['tone'], BG, 'page'),
    R('codeBg', 'Code', CODE, ['tone'], BG, 'page'),
    R('rule', 'Rules', '--marxy-color-rule', ['tone'], BG, 'page'),
    R('selection', 'Selection', '--marxy-color-selection', ['tone', 'accent'], BG, 'page'),
  ]],
  ['Text', [
    R('strong', 'Headings', '--marxy-color-text-strong', ['ink'], BG, 'page', 7),
    R('text', 'Text', '--marxy-color-text', ['ink'], BG, 'page', 7),
    R('second', 'Secondary', '--marxy-color-text-secondary', ['ink'], BG, 'page', 4.5),
    R('faint', 'Faint', '--marxy-color-text-faint', ['ink'], BG, 'page', 4.5),
    R('codeText', 'Code text', '--marxy-color-code-text', ['ink'], CODE, 'code', 4.5),
  ]],
  ['Marks', [
    R('accent', 'Links', '--marxy-color-accent', ['accent'], BG, 'page', 4.5),
    R('edge', 'Edges', '--marxy-color-edge', [], BG, 'page', 3),
    R('ok', 'Done', '--marxy-color-status-ok', [], BG, 'page', 4.5),
    R('warn', 'Warning', '--marxy-color-status-warn', [], BG, 'page', 4.5),
    R('err', 'Error', '--marxy-color-status-err', [], BG, 'page', 4.5),
  ]],
  ['Code', [
    R('tok.keyword', 'Keywords', '--marxy-tok-keyword', ['code'], CODE, 'code', 4.5),
    R('tok.string', 'Strings', '--marxy-tok-string', ['code'], CODE, 'code', 4.5),
    R('tok.number', 'Numbers', '--marxy-tok-number', ['code'], CODE, 'code', 4.5),
    R('tok.function', 'Functions', '--marxy-tok-function', ['code'], CODE, 'code', 4.5),
    R('tok.type', 'Types', '--marxy-tok-type', ['code'], CODE, 'code', 4.5),
    R('tok.comment', 'Comments', '--marxy-tok-comment', ['code'], CODE, 'code', 4.5),
  ]],
];

const HEX = /^#[0-9a-f]{6}$/i;

/** The dial keys a role's dial stands for in this scheme. */
const dialKeys = (d: Dial, scheme: Scheme): (keyof LookTweaks)[] =>
  d === 'tone' ? [scheme] : d === 'ink' ? [scheme === 'night' ? 'inkNight' : 'ink'] : d === 'accent' ? ['accent'] : ['code'];

export const mountColours: StudioPiece = (host, ctx: StudioCtx) => {
  adoptRuntimeSheet(document, 'marxy-studio-colours-style', css);
  const wrap = el('div', 'marxy-studio-colours');
  const head = el('div', 'marxy-studio-colours-head');
  const grid = el('div', 'marxy-studio-colours-cols');
  wrap.append(head, grid);
  host.append(wrap);
  const inputs = new Map<Role, { readonly pick: HTMLInputElement; readonly hex: HTMLInputElement; readonly note: HTMLElement; readonly reset: HTMLButtonElement }>();

  const shown = (): Scheme => ctx.look().only ?? ctx.view().scheme;

  function setColour(row: Row, value: string): void {
    if (!HEX.test(value)) return;
    const scheme = shown();
    const look: Look = ctx.look();
    // A dial moved away from the theme's own would carry this colour off: it goes back first, so the colour shows as set.
    for (const d of row.dials) for (const k of dialKeys(d, scheme)) if (JSON.stringify(look[k as keyof Look]) !== JSON.stringify(ctx.own(k))) ctx.reset(k);
    const now = ctx.look();
    const t = resolve(ctx.state(), ctx.canvasContext(), { id: ctx.editId(), scheme: ctx.view().scheme }).tokens;
    const pins: Partial<Record<Scheme, Pins>> = { ...(now.pins ?? {}) };
    // A palette names its ground: a look that pinned nothing before pins its page as it is now, with the colour.
    const cur: Pins = { bg: t[BG], ...(pins[scheme] ?? {}) };
    pins[scheme] = row.role.startsWith('tok.') ? { ...cur, tok: { ...(cur.tok ?? {}), [row.role.slice(4)]: value.toLowerCase() } } : { ...cur, [row.role]: value.toLowerCase() };
    ctx.set('pins', pins);
  }

  function draw(): void {
    grid.replaceChildren();
    inputs.clear();
    for (const [title, rows] of COLUMNS) {
      const col = el('div', 'marxy-studio-colours-col');
      col.append(el('div', 'marxy-studio-h', title));
      for (const row of rows) {
        const line = el('label', 'marxy-studio-colour');
        const pick = el('input', 'marxy-studio-colour-pick');
        pick.type = 'color';
        pick.setAttribute('aria-label', `${row.label}: pick a colour`);
        const hex = el('input', 'marxy-studio-colour-hex');
        hex.type = 'text';
        hex.spellcheck = false;
        hex.maxLength = 7;
        hex.setAttribute('aria-label', `${row.label}: a hex colour`);
        const note = el('span', 'marxy-studio-colour-note');
        const reset = btn('marxy-studio-link', 'as drawn', () => resetRole(row));
        reset.title = 'Back to the theme’s own colour';
        pick.addEventListener('input', () => setColour(row, pick.value));
        hex.addEventListener('change', () => setColour(row, hex.value.trim().startsWith('#') ? hex.value.trim() : `#${hex.value.trim()}`));
        hex.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') hex.dispatchEvent(new Event('change'));
        });
        line.append(pick, el('span', 'marxy-studio-colour-k', row.label), hex, note, reset);
        col.append(line);
        inputs.set(row.role, { pick, hex, note, reset });
      }
      grid.append(col);
    }
  }

  function resetRole(row: Row): void {
    const scheme = shown();
    const own = (ctx.own('pins') as Look['pins']) ?? {};
    const look = ctx.look();
    const pins: Partial<Record<Scheme, Pins>> = { ...(look.pins ?? {}) };
    const cur: Record<string, unknown> = { ...(pins[scheme] ?? {}) };
    const was: Record<string, unknown> = { ...(own[scheme] ?? {}) };
    if (row.role.startsWith('tok.')) {
      const role = row.role.slice(4);
      const tok: Record<string, unknown> = { ...((cur.tok as Record<string, unknown> | undefined) ?? {}) };
      const before = (was.tok as Record<string, unknown> | undefined)?.[role];
      if (before !== undefined) tok[role] = before;
      else delete tok[role];
      cur.tok = tok;
    } else if (was[row.role] !== undefined) cur[row.role] = was[row.role];
    else delete cur[row.role];
    pins[scheme] = cur as Pins;
    ctx.set('pins', pins);
  }

  function paint(): void {
    const scheme = shown();
    const r = resolve(ctx.state(), ctx.canvasContext(), { id: ctx.editId(), scheme: ctx.view().scheme });
    const t = r.tokens;
    const look = ctx.look();
    const own = (ctx.own('pins') as Look['pins'])?.[scheme] as (Record<string, unknown> & Pins) | undefined;
    const mine = look.pins?.[scheme] as (Record<string, unknown> & Pins) | undefined;
    head.replaceChildren(
      el('span', 'marxy-studio-colours-title', `${look.name}, its ${scheme === 'night' ? 'night' : 'day'} colours`),
      el('span', 'marxy-studio-colours-hint', look.only ? `Drawn for ${look.only} only.` : 'Day or night follows the bar above.'),
      el('span', 'marxy-studio-colours-hint', 'Every colour you set is still held to its floor: one that falls under it is walked to it, and the note says so.'),
    );
    if (look.pins && JSON.stringify(look.pins) !== JSON.stringify(ctx.own('pins'))) head.append(btn('marxy-studio-link', 'all colours as drawn', () => ctx.reset('pins')));
    for (const [, rows] of COLUMNS) {
      for (const row of rows) {
        const io = inputs.get(row.role);
        if (!io) continue;
        const v = t[row.token] ?? '#000000';
        if (document.activeElement !== io.pick) io.pick.value = v;
        if (document.activeElement !== io.hex) io.hex.value = v;
        const moved = r.moved.find((m) => m.token === row.token);
        const ratio = row.on ? hexRatio(v, t[row.on]!) : null;
        io.note.textContent = moved
          ? `held: ${moved.drawn} fell under ${row.floor ?? 4.5} : 1`
          : ratio !== null
            ? `${ratio.toFixed(1)} : 1 on ${row.onWord}`
            : '';
        io.note.toggleAttribute('data-marxy-held', moved !== undefined);
        const key = row.role.startsWith('tok.') ? row.role.slice(4) : row.role;
        const pinnedNow = row.role.startsWith('tok.') ? mine?.tok?.[key as keyof NonNullable<Pins['tok']>] : mine?.[key];
        const pinnedOwn = row.role.startsWith('tok.') ? own?.tok?.[key as keyof NonNullable<Pins['tok']>] : own?.[key];
        io.reset.hidden = pinnedNow === pinnedOwn;
      }
    }
  }

  draw();
  const off = ctx.onPaint(paint);
  paint();
  return () => {
    off();
    wrap.remove();
  };
};
