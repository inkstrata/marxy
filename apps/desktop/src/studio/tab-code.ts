// The Studio's Code tab: how much colour code gets,
// whether each language wears its own palette, a language put on the canvas, and each of its token colours measured on
// the grounds it is read on. The reader's own `[syntax.<lang>]` colours are the By language section, whose one
// home is here since the drawer's look branch went.
import { LANG_PALETTES, hexRatio } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { appHandle } from '../commands/app-handle.ts';
import { byLanguage } from '../frame/branches/look-by-language.ts';
import { el } from '../frame/dom.ts';
import type { StudioPiece } from './context.ts';
import { column, dial, segmented } from './dials.ts';
import css from './tabs-caf.css?inline';

/** The language the Code kind's own specimen is written in (specimens.ts). */
const SPECIMEN_LANG = 'typescript';

const word = (v: number): string => (v <= 0.001 ? 'ink only' : v < 0.34 ? 'quiet' : v < 0.67 ? 'clear' : 'vivid');

/** The roles listed: a palette's five, then the two that stay the shared ink in every language. */
const ROLES: readonly { readonly role: string; readonly name: string; readonly palette: boolean }[] = [
  { role: 'keyword', name: 'Keywords', palette: true },
  { role: 'type', name: 'Types', palette: true },
  { role: 'string', name: 'Strings', palette: true },
  { role: 'number', name: 'Numbers and literals', palette: true },
  { role: 'decorator', name: 'Attributes and macros', palette: true },
  { role: 'comment', name: 'Comments', palette: false },
  { role: 'function', name: 'Function names', palette: false },
];

/** A word of each role as the language writes it; `''` is the shared set. */
const SAMPLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '': { keyword: 'return', type: 'Reading', string: '"ready"', number: '250', decorator: '@sealed', comment: '// why', function: 'highest' },
  rust: { keyword: 'pub fn', type: 'Option', string: '"tide"', number: '0.5', decorator: '#[derive]', comment: '/// metres', function: 'highest' },
  python: { keyword: 'def', type: 'Reading', string: '"""docs"""', number: 'None', decorator: '@dataclass', comment: '# why', function: 'highest' },
  go: { keyword: 'func', type: 'int64', string: '"tide"', number: 'false', decorator: '//go:embed', comment: '// why', function: 'Highest' },
  typescript: { keyword: 'interface', type: 'Reading', string: "'node:fs'", number: 'null', decorator: '@sealed', comment: '// why', function: 'highest' },
  javascript: { keyword: 'export', type: 'Date', string: "'tide'", number: '0', decorator: '@bound', comment: '// why', function: 'nextHigh' },
  sql: { keyword: 'select', type: 'integer', string: "'now'", number: '7', decorator: 'count', comment: '-- why', function: 'min' },
  shellscript: { keyword: 'for', type: 'local', string: '"$out"', number: '1', decorator: 'set -e', comment: '# why', function: 'publish' },
  css: { keyword: '@media', type: '.notice', string: '"Sitka"', number: '0.75rem', decorator: '!important', comment: '/* why */', function: 'var' },
};

const LANG_IDS = Object.keys(LANG_PALETTES);

/** The token a role is painted with: the language's palette, or the shared set (and always for comments and names). */
const varOf = (lang: string, role: string): string =>
  lang && ROLES.find((r) => r.role === role)?.palette ? `--marxy-pl-${lang}-${role}` : `--marxy-tok-${role}`;

export const mountCode: StudioPiece = (host, ctx) => {
  adoptRuntimeSheet(document, 'marxy-studio-caf-style', css);

  // The canvas shows code while this tab is open; put back on leaving only if this tab put it there.
  let switched = false;
  const v0 = ctx.view();
  if (v0.kind === 'prose' && !v0.sheet) {
    switched = true;
    ctx.setView({ kind: 'code' });
  }

  const look = ctx.look();
  const amount = dial({
    label: 'How much',
    min: 0,
    max: 1,
    step: 0.05,
    value: look.code,
    say: word,
    set: (v) => ctx.set('code', v),
    reset: () => ctx.reset('code'),
  });
  const each = segmented<'own' | 'one'>('Each language', [['own', 'In its own colours'], ['one', 'One set for all']], look.perLanguage !== false ? 'own' : 'one', (v) =>
    ctx.set('perLanguage', v === 'own'),
  );
  each.classList.add('marxy-studio-code-each');
  const eachRow = el('div', 'marxy-studio-code-eachrow');
  eachRow.append(el('span', 'marxy-studio-dial-k', 'Each language'), each);
  const first = column(
    'Colour in code',
    amount.el,
    eachRow,
    el('p', 'marxy-studio-code-say', 'Every token colour is solved to at least 4.5 : 1 on its ground.'),
  );
  first.classList.add('marxy-studio-code-first');

  const langs = segmented<string>('Shown in', LANG_IDS.map((id) => [id, LANG_PALETTES[id]!.name] as const), ctx.view().lang ?? '', (id) => ctx.setView({ kind: 'code', lang: id }));
  langs.classList.add('marxy-studio-code-langs');
  const note = el('p', 'marxy-studio-code-note');
  const second = column('Shown in', langs, note);

  const head = el('div', 'marxy-studio-h');
  const toks = el('div', 'marxy-studio-code-toks');
  const cells = ROLES.map(({ role, name }) => {
    const sample = el('code', 'marxy-studio-code-sample');
    const onCode = el('span', 'marxy-studio-code-ratio');
    const onPage = el('span', 'marxy-studio-code-ratio');
    sample.title = name;
    return { role, sample, onCode, onPage, cells: [sample, el('span', 'marxy-studio-code-name', name), onCode, onPage] };
  });
  const colHead = (): HTMLElement[] => [el('span'), el('span', 'marxy-studio-code-name'), el('span', 'marxy-studio-code-colh', 'on code'), el('span', 'marxy-studio-code-colh', 'on page')];
  // Two halves read down: the palette's first four on the left, the rest on the right.
  const order = [0, 4, 1, 5, 2, 6, 3].map((i) => cells[i]!);
  toks.append(...colHead(), ...colHead(), ...order.flatMap((c) => c.cells));
  const third = el('div', 'marxy-studio-col marxy-studio-code-tokcol');
  third.append(head, toks);

  const yours = column('Your own colours for a language, in config.toml');
  yours.classList.add('marxy-studio-code-yours');
  const handle = appHandle();
  let sec: HTMLElement | null = null;
  const redraw = (): void => {
    if (!handle) return;
    const next = byLanguage(handle, redraw);
    if (sec) sec.replaceWith(next);
    else yours.append(next);
    sec = next;
  };
  if (handle) redraw();
  else yours.append(el('p', 'marxy-studio-code-note', 'Your own colours for a language are set in config.toml, under [syntax.<language>].'));

  host.append(first, second, third, yours);

  let sig = '';
  const update = (): void => {
    const v = ctx.view();
    if (switched && v.kind !== 'code') switched = false;
    const lk = ctx.look();
    amount.update(lk.code);
    const own = lk.perLanguage !== false;
    for (const b of each.children) b.setAttribute('aria-checked', String(b.textContent === (own ? 'In its own colours' : 'One set for all')));
    LANG_IDS.forEach((id, i) => langs.children[i]?.setAttribute('aria-checked', String(v.lang === id)));

    const lang = v.lang ?? SPECIMEN_LANG;
    const pal = LANG_PALETTES[lang];
    const listed = own && pal ? lang : '';
    if (listed) toks.setAttribute('data-marxy-lang', listed);
    else toks.removeAttribute('data-marxy-lang');
    head.textContent = listed ? `Each token, measured, in ${pal!.name}` : 'Each token, measured';
    head.title = 'Contrast, to 1, on the code ground and on the page';
    note.textContent = !own ? 'Every language takes the same colours.' : pal ? `${pal.name}: ${pal.note}. Comments and names stay the ink.` : '';

    const t = ctx.resolved().tokens;
    const codeBg = t['--marxy-color-code-bg'] ?? '';
    const pageBg = t['--marxy-color-bg'] ?? '';
    const next = JSON.stringify([listed, codeBg, pageBg, ...cells.map((c) => t[varOf(listed, c.role)])]);
    if (next === sig) return;
    sig = next;
    // The canvas's own values, so the samples are the colours the canvas is painted with (a look hovered on the shelf too).
    toks.style.setProperty('--marxy-color-code-bg', codeBg);
    const words = SAMPLES[listed] ?? SAMPLES['']!;
    for (const c of cells) {
      const name = varOf(listed, c.role);
      const hex = t[name] ?? '';
      c.sample.textContent = words[c.role] ?? c.role;
      c.sample.style.setProperty('color', `var(${name})`);
      toks.style.setProperty(name, hex);
      c.onCode.textContent = hexRatio(hex, codeBg).toFixed(1);
      c.onPage.textContent = hexRatio(hex, pageBg).toFixed(1);
      c.onCode.title = `${c.onCode.textContent} : 1 on the code ground`;
      c.onPage.title = `${c.onPage.textContent} : 1 on the page`;
    }
  };
  const off = ctx.onPaint(update);
  update();

  return () => {
    off();
    const v = ctx.view();
    // On closing the Studio the tab is still Code: nothing to put back.
    if (switched && v.tab !== 'code' && v.kind === 'code') ctx.setView({ kind: 'prose', lang: null });
  };
};
