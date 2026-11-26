// Fit: two settings of the reader's own
// passage side by side, and the reader says which is easier, as at an optician's. Candidates are painted with an
// override; nothing changes until the result is kept as a look of the reader's own.
import { FACES, TONES, nearestLegible, padFromTone, saveAs, toneFromPad, type FaceId, type Look, type LookTweaks, type Scheme, type Tone } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { btn, el } from '../frame/dom.ts';
import type { Leaf, StudioCtx } from './context.ts';
import css from './fit.css?inline';

type Key = 'size' | 'lead' | 'measure' | 'weight' | 'ink' | 'warmth' | 'face';
type Value = number | FaceId;

interface Round {
  readonly key: Key;
  readonly label: string;
  readonly q: string;
  readonly d?: number;
  readonly lo?: number;
  readonly hi?: number;
  readonly snap?: (v: number) => number;
}

const ROUNDS: readonly Round[] = [
  { key: 'size', label: 'Size', q: 'Which size is easier to read?', d: 2, lo: 14, hi: 34, snap: (v) => Math.round(v * 4) / 4 },
  { key: 'lead', label: 'Leading', q: 'Which line spacing is easier?', d: 0.12, lo: 1.2, hi: 2, snap: (v) => Math.round(v * 100) / 100 },
  { key: 'measure', label: 'Measure', q: 'Which line length is easier to follow?', d: 10, lo: 40, hi: 96, snap: Math.round },
  { key: 'weight', label: 'Weight', q: 'Which weight of text is easier to read?', d: 60, lo: 300, hi: 600, snap: (v) => Math.round(v / 5) * 5 },
  { key: 'ink', label: 'Contrast', q: 'Which contrast is easier on your eyes?', d: 3, lo: 7, hi: 21, snap: (v) => Math.round(v * 4) / 4 },
  { key: 'warmth', label: 'Page', q: 'Which page is easier to rest your eyes on?', d: 0.24, lo: 0, hi: 1, snap: (v) => Math.round(v * 1000) / 1000 },
  { key: 'face', label: 'Face', q: 'Which face is easier to read?' },
];
const FIT_FACES: readonly FaceId[] = ['sitka', 'hyper', 'palatino', 'segoe'];
const STEPS = 3;
const FINAL_STEP = ['First pair', 'Second pair', 'The final'];
const HONEST = 'This finds what feels easiest to your eye today. Comfort and reading speed are related but not the same thing, and the differences are small.';

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const roundTone = (t: Tone): Tone => ({ l: r3(t.l), c: r3(t.c), h: Math.round(t.h) });
const trim = (n: number): string => String(Number(n.toFixed(2)));

function nearestTone(t: Tone): string {
  let best = TONES[0]!;
  let gap = Infinity;
  for (const n of TONES) {
    const a = padFromTone(n);
    const b = padFromTone(t);
    const g = Math.hypot(a.x - b.x, a.y - b.y);
    if (g < gap) [best, gap] = [n, g];
  }
  return best.name;
}

/** Where the test stands: everything Backspace returns to. */
interface Step {
  r: number;
  c: number;
  d: number;
  n: number;
  pair: [Value, Value];
  flip: boolean;
  ko: { m: number; win: FaceId[] } | null;
  set: LookTweaks;
  done: boolean;
}

let active: HTMLElement | null = null;
let dropActive: (() => void) | null = null;

/** Ends a Fit in progress without rebuilding the stage: the Studio is closing, or its stage is being built again. */
export function dropFit(): void {
  dropActive?.();
}

/** Starts the eye test over the stage; it ends kept, left, or with Esc. */
export function startFit(ctx: StudioCtx): void {
  if (active?.isConnected) return;
  adoptRuntimeSheet(document, 'marxy-studio-fit-style', css);
  if (ctx.view().compare || ctx.view().hover) ctx.setView({ compare: false, hover: null });

  const id = ctx.editId();
  const scheme: Scheme = ctx.view().scheme;
  const base: Look = ctx.look();
  const baseTweaks: LookTweaks = { ...(ctx.state().tweaks[id] ?? {}) };
  const toneKey = scheme === 'night' ? 'night' : 'day';
  const inkKey = scheme === 'night' ? 'inkNight' : 'ink';
  const y0 = padFromTone(base[toneKey]).y;
  const width = ctx.logicalWidth();
  const pageCtx = ctx.contextOf('prose', width);

  const keyOf = (k: Key): keyof LookTweaks => (k === 'ink' ? inkKey : k === 'warmth' ? toneKey : k);
  const own = base[toneKey];
  const ownCool = own.h > 150 && own.h < 330;
  const toneAt = (x: number): Tone => {
    const t = toneFromPad(x, y0);
    // On the look's own side of the pad the tone keeps its hue: Console's green stays green, not the pad's blue-grey.
    return (t.h === 250) === ownCool ? { ...t, h: own.h } : t;
  };
  const valueOf = (k: Key, v: Value): LookTweaks[keyof LookTweaks] =>
    k === 'warmth' ? roundTone(nearestLegible(toneAt(v as number))) : (v as never);
  const merged = (set: LookTweaks): Look => ({ ...base, ...set });
  const current = (rd: Round, set: LookTweaks): number => {
    const lk = merged(set);
    if (rd.key === 'warmth') return padFromTone(lk[toneKey]).x;
    if (rd.key === 'ink') return lk[inkKey];
    return lk[rd.key as 'size' | 'lead' | 'measure' | 'weight'];
  };
  const tweaksFor = (set: LookTweaks, rd?: Round, v?: Value): LookTweaks => {
    const t: LookTweaks = { ...baseTweaks, ...set };
    if (rd && v !== undefined) (t as Record<string, unknown>)[keyOf(rd.key)] = valueOf(rd.key, v);
    return t;
  };
  const say = (rd: Round, lk: Look): string => {
    switch (rd.key) {
      case 'size':
        return `${trim(lk.size)} px`;
      case 'lead':
        return lk.lead.toFixed(2);
      case 'measure':
        return `${lk.measure} characters`;
      case 'weight':
        return String(lk.weight);
      case 'ink':
        return `${lk[inkKey].toFixed(1)} : 1`;
      case 'warmth':
        return `near ${nearestTone(lk[toneKey])}`;
      case 'face':
        return FACES[lk.face].name;
    }
  };

  let st: Step = { r: 0, c: 0, d: 0, n: 0, pair: [0, 0], flip: false, ko: null, set: {}, done: false };
  const hist: string[] = [];

  function makePair(rd: Round): void {
    const snap = rd.snap!;
    st.pair = [snap(clamp(st.c - st.d, rd.lo!, rd.hi!)), snap(clamp(st.c + st.d, rd.lo!, rd.hi!))];
  }
  function startRound(): void {
    const rd = ROUNDS[st.r]!;
    if (rd.key === 'face') {
      st.ko = { m: 0, win: [] };
      st.pair = [FIT_FACES[0]!, FIT_FACES[1]!];
    } else {
      st.ko = null;
      st.c = current(rd, st.set);
      st.d = rd.d!;
      st.n = 0;
      makePair(rd);
    }
    st.flip = Math.random() < 0.5;
  }
  const sideValue = (i: number): Value => st.pair[(i + (st.flip ? 1 : 0)) % 2]!;
  function settle(v: Value): void {
    const rd = ROUNDS[st.r]!;
    st.set = { ...st.set, [keyOf(rd.key)]: valueOf(rd.key, v) };
    st.r++;
    if (st.r >= ROUNDS.length) st.done = true;
    else startRound();
    draw();
  }
  function choose(i: number): void {
    if (st.done) return;
    hist.push(JSON.stringify(st));
    const rd = ROUNDS[st.r]!;
    const v = sideValue(i);
    if (rd.key === 'face') {
      const ko = st.ko!;
      ko.win.push(v as FaceId);
      ko.m++;
      if (ko.m === 1) st.pair = [FIT_FACES[2]!, FIT_FACES[3]!];
      else if (ko.m === 2) st.pair = [ko.win[0]!, ko.win[1]!];
      else return settle(v);
    } else {
      st.c = v as number;
      st.n++;
      st.d /= 2;
      if (st.n >= STEPS) return settle(v);
      makePair(rd);
    }
    st.flip = Math.random() < 0.5;
    draw();
  }
  function same(): void {
    if (st.done) return;
    hist.push(JSON.stringify(st));
    const rd = ROUNDS[st.r]!;
    settle(rd.key === 'face' ? base.face : rd.snap!(((st.pair[0] as number) + (st.pair[1] as number)) / 2));
  }
  function back(): void {
    const prev = hist.pop();
    if (!prev) {
      ctx.say('This is the first comparison');
      return;
    }
    st = JSON.parse(prev) as Step;
    draw();
    root.focus();
  }

  // ---- the DOM ------------------------------------------------------------------------------------------------------
  const root = el('div', 'marxy-studio-fit');
  root.tabIndex = -1;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Fit: an eye test');
  const dots = el('div', 'marxy-studio-fit-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (const rd of ROUNDS) {
    const d = el('span', 'marxy-studio-fit-dot');
    d.title = rd.label;
    dots.append(d);
  }
  const question = el('div', 'marxy-studio-fit-q');
  question.setAttribute('aria-live', 'polite');
  const stepLine = el('div', 'marxy-studio-fit-step');
  const head = el('div', 'marxy-studio-fit-head');
  head.append(el('div', 'marxy-studio-fit-name', 'Fit'), dots, question, el('span', 'marxy-studio-fit-sp'), stepLine);

  const pair = el('div', 'marxy-studio-fit-pair');
  const leaves: Leaf[] = [];
  const sides: HTMLElement[] = [];
  for (const i of [0, 1]) {
    const side = el('div', 'marxy-studio-fit-side');
    side.setAttribute('role', 'button');
    side.setAttribute('aria-label', `This one (${i + 1})`);
    side.title = `This one (${i + 1})`;
    const paper = el('div', 'marxy-studio-fit-paper');
    const leaf = ctx.makeLeaf('prose');
    paper.append(leaf.el);
    side.append(el('span', 'marxy-studio-fit-num', String(i + 1)), paper);
    side.addEventListener('click', () => choose(i));
    pair.append(side);
    leaves.push(leaf);
    sides.push(side);
  }

  const sumLeaf = ctx.makeLeaf('prose');
  const sumPaper = el('div', 'marxy-studio-fit-paper marxy-studio-fit-specimen');
  sumPaper.append(sumLeaf.el);
  const values = el('dl', 'marxy-studio-fit-values');
  const name = el('input', 'marxy-studio-input marxy-studio-fit-input');
  name.type = 'text';
  name.value = 'By eye';
  name.spellcheck = false;
  name.setAttribute('aria-label', 'A name for the look');
  const nameRow = el('label', 'marxy-studio-fit-label', 'Keep it as a look of mine, called');
  nameRow.append(name);
  const keepBtn = btn('marxy-btn', 'Keep it as a look of mine', () => keep());
  keepBtn.setAttribute('data-marxy-primary', '');
  const leaveBtn = btn('marxy-btn', 'Leave things as they were', () => end());
  const btns = el('div', 'marxy-studio-fit-btns');
  btns.append(keepBtn, leaveBtn);
  const aside = el('div', 'marxy-studio-fit-aside');
  aside.append(el('div', 'marxy-studio-h', 'What suits your eye today'), values, el('p', 'marxy-studio-fit-honest', HONEST), nameRow, btns);
  const summary = el('div', 'marxy-studio-fit-summary');
  summary.append(sumPaper, aside);
  summary.hidden = true;

  const foot = el('div', 'marxy-studio-fit-foot');
  root.append(head, pair, summary, foot);
  ctx.stage().append(root);
  active = root;
  dropActive = () => end(false);

  const kbd = (k: string): HTMLElement => el('kbd', 'marxy-studio-fit-key', k);
  const hint = (...parts: (string | HTMLElement)[]): HTMLElement => {
    const s = el('span', 'marxy-studio-fit-hint');
    s.append(...parts);
    return s;
  };

  // The passage: the reader's own first few paragraphs, the same in each leaf.
  function passage(leaf: Leaf, n: number): void {
    const ps = [...leaf.article.querySelectorAll<HTMLElement>(':scope > p')];
    const long = ps.filter((p) => (p.textContent ?? '').trim().length > 140);
    const keep = (long.length >= 2 ? long : ps).slice(0, n);
    if (keep.length) leaf.article.replaceChildren(...keep);
  }
  void Promise.all([...leaves, sumLeaf].map((l) => l.ready)).then(() => {
    for (const l of leaves) passage(l, 4);
    passage(sumLeaf, 2);
  });

  // Side by side when the widest candidate this round sets at full size in half the stage; else one above the other.
  function layoutFor(rd: Round): 'side' | 'stack' {
    const w = pair.clientWidth || ctx.stage().clientWidth;
    const cands: Value[] = rd.key === 'face' ? [...FIT_FACES] : [rd.snap!(clamp(st.c + st.d * 1.75, rd.lo!, rd.hi!))];
    let need = 0;
    for (const c of cands) need = Math.max(need, ctx.paint(document.createElement('div'), pageCtx, { id, scheme, tweaks: tweaksFor(st.set, rd, c) }).facts.measure);
    return need + 64 <= (w - 16) / 2 ? 'side' : 'stack';
  }
  function fitLeaf(leaf: Leaf): void {
    const box = leaf.el.parentElement!;
    leaf.el.style.width = `${box.clientWidth}px`;
    leaf.el.style.height = `${box.clientHeight}px`;
    leaf.scroller.scrollTop = 0;
  }

  function draw(): void {
    [...dots.children].forEach((d, i) => {
      d.classList.toggle('marxy-studio-fit-dot-done', st.done || i < st.r);
      d.toggleAttribute('aria-current', !st.done && i === st.r);
    });
    if (st.done) return drawSummary();
    summary.hidden = true;
    pair.hidden = false;
    const rd = ROUNDS[st.r]!;
    question.textContent = rd.q;
    stepLine.textContent = rd.key === 'face' ? FINAL_STEP[st.ko!.m]! : `Comparison ${st.n + 1} of ${STEPS}`;
    pair.classList.toggle('marxy-studio-fit-stack', layoutFor(rd) === 'stack');
    foot.replaceChildren(
      hint(kbd('1'), ' or ', kbd('2'), ' the easier one, or click it'),
      hint(kbd('Space'), ' no difference'),
      hint(kbd('Backspace'), ' back a step'),
      hint(kbd('Esc'), ' leave, changing nothing'),
    );
    leaves.forEach((leaf, i) => {
      ctx.paint(leaf.el, pageCtx, { id, scheme, tweaks: tweaksFor(st.set, rd, sideValue(i)) });
      fitLeaf(leaf);
    });
  }
  function drawSummary(): void {
    pair.hidden = true;
    summary.hidden = false;
    question.textContent = 'What suits your eye today';
    stepLine.textContent = 'Nothing has changed yet';
    foot.replaceChildren(hint(kbd('Enter'), ' keep it as a look of mine'), hint(kbd('Backspace'), ' back a step'), hint(kbd('Esc'), ' leave things as they were'));
    const now = merged(st.set);
    values.replaceChildren();
    for (const rd of ROUNDS) {
      const a = say(rd, now);
      const b = say(rd, base);
      const dd = el('dd', '', a);
      dd.append(el('small', '', a === b ? 'as before' : `was ${b}`));
      values.append(el('dt', '', rd.label), dd);
    }
    ctx.paint(sumLeaf.el, pageCtx, { id, scheme, tweaks: tweaksFor(st.set) });
    fitLeaf(sumLeaf);
    name.focus();
    name.select();
  }

  function keep(): void {
    if (!st.done) return;
    const label = name.value.trim() || 'By eye';
    // saveAs builds on the look in use; lend it the look Fit tested, with the reader's changes and the result.
    const { state: next, look } = saveAs({ ...ctx.state(), id }, label, tweaksFor(st.set));
    ctx.apply(next, { mine: look.id });
    end();
    ctx.say(`Kept as ${look.name}. It is the look you are wearing now.`);
  }
  function end(rebuild = true): void {
    if (active !== root) return;
    active = null;
    dropActive = null;
    off();
    ctx.setKeyOwner(null);
    root.remove();
    if (rebuild) ctx.rebuild();
  }

  const typing = (t: EventTarget | null): boolean => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  ctx.setKeyOwner((e) => {
    if (e.type !== 'keydown') return false;
    if (e.key === 'Escape') {
      end();
      return true;
    }
    if (st.done) {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        keep();
        return true;
      }
      if (e.key === 'Backspace' && !typing(e.target)) {
        back();
        return true;
      }
      return false;
    }
    if (e.key === '1' || e.key === '2') {
      choose(Number(e.key) - 1);
      return true;
    }
    if (e.key === ' ') {
      same();
      return true;
    }
    if (e.key === 'Backspace') {
      back();
      return true;
    }
    return false;
  });
  const resize = new ResizeObserver(() => {
    if (st.done) fitLeaf(sumLeaf);
    else for (const l of leaves) fitLeaf(l);
  });
  resize.observe(root);
  const off = (): void => resize.disconnect();

  startRound();
  draw();
  root.focus();
}
