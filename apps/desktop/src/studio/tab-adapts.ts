// The Studio's Adapts tab: every rule as its sentence with its
// switch, a rule of the reader's own built as one line ("Files in notes/ use Slate"), and how night is decided.
import { KINDS, type Kind } from '@marxy/core';
import { addRule, allLooks, removeRule, rulesOf, setMode, toggleRule, type Mode, type Rule, type When } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { btn, el, toggle } from '../frame/dom.ts';
import type { StudioPiece } from './context.ts';
import { column, segmented } from './dials.ts';
import css from './tabs-caf.css?inline';

/** Each kind of text in words: as the builder offers it ("the text is a log") and as its rule says it ("For logs,"). */
const KIND_WORDS: Readonly<Record<Kind, readonly [one: string, many: string]>> = {
  article: ['an article', 'articles'],
  report: ['a report', 'reports'],
  book: ['a book', 'books'],
  readme: ['a readme', 'readmes'],
  docs: ['documentation', 'documentation'],
  code: ['code', 'code'],
  transcript: ['a conversation', 'conversations'],
  data: ['data', 'data'],
  notes: ['notes', 'notes'],
  changelog: ['a changelog', 'changelogs'],
  log: ['a log', 'logs'],
  terminal: ['terminal output', 'terminal output'],
  diff: ['a patch', 'patches'],
  html: ['a web page', 'web pages'],
};

const MODES: readonly (readonly [Mode, string, string])[] = [
  ['system', 'System', 'Night when the computer is set to dark.'],
  ['clock', 'Clock', 'Night from 19:00 to 07:00.'],
  ['day', 'Day', 'Always the day tone.'],
  ['night', 'Night', 'Always the night tone.'],
];

type Cond = 'path' | 'kind' | 'night' | 'narrow';
type Effect = 'look' | 'size' | 'measure';

function select<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T): HTMLSelectElement {
  const s = el('select', 'marxy-studio-adapts-sel');
  s.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const o = el('option', '', text);
    o.value = v;
    o.selected = v === value;
    s.append(o);
  }
  return s;
}

function input(label: string, value: string, attrs: Readonly<Record<string, string>> = {}): HTMLInputElement {
  const i = el('input', 'marxy-studio-adapts-in');
  i.setAttribute('aria-label', label);
  i.value = value;
  i.spellcheck = false;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

export const mountAdapts: StudioPiece = (host, ctx) => {
  adoptRuntimeSheet(document, 'marxy-studio-caf-style', css);

  // ---- every rule --------------------------------------------------------------------------------------------------
  const list = el('div', 'marxy-studio-adapts-rules');
  let rulesSig = '';
  const drawRules = (): void => {
    const rules = rulesOf(ctx.state());
    const next = JSON.stringify(rules.map((r) => [r.id, r.on, r.label]));
    if (next === rulesSig) return;
    rulesSig = next;
    list.replaceChildren(...rules.map(ruleRow));
  };
  // Eight rules and their hints do not all stand in the dock's height: a rule's hint is said on the heading's line while
  // the pointer or the focus is on it (and is its tooltip).
  const HINT_IDLE = 'Point at a rule to see when it applies.';
  const hintLine = el('span', 'marxy-studio-adapts-hint', HINT_IDLE);
  const hintOf = (r: Rule): string => r.hint ?? (r.user ? 'A rule of your own; Remove takes it away.' : '');
  const ruleRow = (r: Rule): HTMLElement => {
    const item = el('div', `marxy-studio-adapts-rule${r.on ? '' : ' marxy-studio-adapts-off'}`);
    item.title = hintOf(r);
    const text = el('div', 'marxy-studio-adapts-label', r.label);
    if (r.user) {
      text.append(
        ' ',
        btn('marxy-studio-adapts-remove', 'Remove', () => {
          ctx.apply(removeRule(ctx.state(), r.id));
          ctx.say(`Removed: ${r.label}`);
        }, `Remove the rule: ${r.label}`),
      );
    }
    const show = (): void => void (hintLine.textContent = hintOf(r) || HINT_IDLE);
    const hide = (): void => void (hintLine.textContent = HINT_IDLE);
    item.addEventListener('pointerenter', show);
    item.addEventListener('pointerleave', hide);
    item.addEventListener('focusin', show);
    item.addEventListener('focusout', hide);
    item.append(toggle(r.label, r.on, (on) => ctx.apply(toggleRule(ctx.state(), r.id, on))), text);
    return item;
  };
  const rulesHead = el('div', 'marxy-studio-adapts-head');
  rulesHead.append(el('div', 'marxy-studio-h', 'How a look adapts'), hintLine);
  const rulesCol = el('div', 'marxy-studio-col marxy-studio-adapts-rulescol');
  rulesCol.append(rulesHead, list);

  // ---- a rule of your own ------------------------------------------------------------------------------------------
  const cond = select<Cond>('When', [['path', 'a file is in folder'], ['kind', 'the text is'], ['night', 'it is night'], ['narrow', 'the pane is narrower than']], 'path');
  const effect = select<Effect>('Use', [['look', 'the look'], ['size', 'size'], ['measure', 'measure']], 'look');
  const condArg = el('span', 'marxy-studio-adapts-arg');
  const effectArg = el('span', 'marxy-studio-adapts-arg');
  const msg = el('div', 'marxy-studio-adapts-msg');
  let condIn: HTMLInputElement | HTMLSelectElement | null = null;
  let effectIn: HTMLInputElement | HTMLSelectElement | null = null;
  const onEnter = <E extends HTMLElement>(e: E): E => {
    e.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      ev.stopPropagation();
      add();
    });
    return e;
  };
  const drawCond = (): void => {
    condArg.replaceChildren();
    condIn = null;
    const c = cond.value as Cond;
    if (c === 'path') condArg.append((condIn = onEnter(input('Folder', '', { placeholder: 'notes/', size: '9' }))));
    else if (c === 'kind') condArg.append((condIn = select<Kind>('Kind of text', KINDS.map((k) => [k, KIND_WORDS[k][0]] as const), 'log')));
    else if (c === 'narrow') condArg.append((condIn = onEnter(input('Width', '700', { type: 'number', min: '300', max: '3000', step: '10' }))), ' px');
  };
  const drawEffect = (): void => {
    effectArg.replaceChildren();
    const e = effect.value as Effect;
    if (e === 'look') effectArg.append((effectIn = select<string>('Look', allLooks(ctx.state()).map((l) => [l.id, l.name] as const), 'slate')));
    else if (e === 'size') effectArg.append((effectIn = onEnter(input('Size', '22', { type: 'number', min: '14', max: '34', step: '0.5' }))), ' px');
    else effectArg.append((effectIn = onEnter(input('Measure', '60', { type: 'number', min: '40', max: '96', step: '1' }))), ' characters');
  };
  cond.addEventListener('change', drawCond);
  effect.addEventListener('change', drawEffect);
  drawCond();
  drawEffect();

  function add(): void {
    msg.textContent = '';
    const c = cond.value as Cond;
    let when: When;
    let subject: string;
    let folder = false;
    if (c === 'path') {
      let p = (condIn?.value ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!p) {
        msg.textContent = 'Name a folder first, such as notes/.';
        condIn?.focus();
        return;
      }
      if (!p.endsWith('/')) p += '/';
      when = { path: p };
      subject = `Files in ${p}`;
      folder = true;
    } else if (c === 'kind') {
      const k = (condIn?.value ?? 'log') as Kind;
      when = { kinds: [k] };
      subject = `For ${KIND_WORDS[k][1]},`;
    } else if (c === 'night') {
      when = { scheme: 'night' };
      subject = 'At night,';
    } else {
      const n = Math.round(Number(condIn?.value));
      if (!(n >= 300 && n <= 3000)) {
        msg.textContent = 'A width between 300 and 3,000 px.';
        return;
      }
      when = { maxWidth: n };
      subject = `In panes narrower than ${n.toLocaleString('en-GB')} px,`;
    }
    const e = effect.value as Effect;
    let set: Rule['set'];
    let verb: string;
    if (e === 'look') {
      const look = allLooks(ctx.state()).find((l) => l.id === effectIn?.value);
      if (!look) return;
      set = { look: look.id };
      verb = `use ${look.name}`;
    } else if (e === 'size') {
      const n = Number(effectIn?.value);
      if (!(n >= 14 && n <= 34)) {
        msg.textContent = 'A size between 14 and 34 px.';
        return;
      }
      set = { size: n };
      verb = folder ? `are set at size ${n}` : `size ${n}`;
    } else {
      const n = Math.round(Number(effectIn?.value));
      if (!(n >= 40 && n <= 96)) {
        msg.textContent = 'A measure between 40 and 96 characters.';
        return;
      }
      set = { measure: n };
      verb = folder ? `run to ${n} characters a line` : `measure ${n}`;
    }
    const label = `${subject} ${verb}`;
    ctx.apply(addRule(ctx.state(), { label, when, set }));
    ctx.say(`Added: ${label}`);
    if (condIn instanceof HTMLInputElement && c === 'path') condIn.value = '';
  }

  const builder = el('div', 'marxy-studio-adapts-builder');
  builder.append(el('span', '', 'When'), cond, condArg, el('span', '', 'use'), effect, effectArg, btn('marxy-btn', 'Add the rule', add));
  const ownCol = column('A rule of your own', builder, msg);
  ownCol.classList.add('marxy-studio-adapts-owncol');

  // ---- how night is decided ----------------------------------------------------------------------------------------
  const modes = segmented<Mode>('How night is decided', MODES.map(([m, label]) => [m, label] as const), ctx.state().mode, (m) => ctx.apply(setMode(ctx.state(), m)));
  const explain = el('p', 'marxy-studio-adapts-note');
  const nightCol = column('How night is decided', modes, explain);
  nightCol.classList.add('marxy-studio-adapts-nightcol');
  const drawMode = (): void => {
    const s = ctx.state();
    MODES.forEach(([m], i) => modes.children[i]?.setAttribute('aria-checked', String(s.mode === m)));
    const darkOn = rulesOf(s).find((r) => r.id === 'dark')?.on !== false;
    const line = MODES.find(([m]) => m === s.mode)?.[2] ?? '';
    explain.textContent = !darkOn && (s.mode === 'system' || s.mode === 'clock') ? `${line} With “After dark” off, the page keeps its day tone.` : line;
  };

  host.append(rulesCol, ownCol, nightCol);
  const update = (): void => {
    drawRules();
    drawMode();
  };
  const off = ctx.onPaint(update);
  update();
  return off;
};
