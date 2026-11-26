// The Studio's Tone tab: the tone pad, the page's ink and the
// accent. The pad's field and the hue strip are drawn from the engine, every pixel the real colour; the hatched band is
// where no ink reaches 7 : 1, and the puck cannot rest in it.
import { FACES, FLOOR, legible, nearestLegible, padFromTone, palette, TONES, toneFromPad, toneHex, type Look, type Scheme, type Tone } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { btn, el } from '../frame/dom.ts';
import type { StudioCtx, StudioPiece } from './context.ts';
import { dial } from './dials.ts';
import css from './tabs-tpp.css?inline';

const PAD = 128;
const STRIP_W = 240;
const STRIP_H = 14;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

const HUES: readonly (readonly [number, string])[] = [[20, 'pink'], [48, 'red'], [72, 'orange'], [100, 'amber'], [128, 'olive'], [160, 'green'], [192, 'teal'], [228, 'cyan'], [268, 'blue'], [292, 'indigo'], [318, 'violet'], [345, 'magenta'], [361, 'pink']];
export const hueName = (v: number): string => HUES.find(([b]) => ((v % 360) + 360) % 360 <= b)![1];

// Tones are stored rounded: the look file stays readable and the same tone compares equal after a round trip.
const roundTone = (t: Tone): Tone => ({ l: Number(t.l.toFixed(3)), c: Number(t.c.toFixed(3)), h: Math.round(t.h) });
const sameTone = (a: Tone, b: Tone): boolean =>
  Math.abs(a.l - b.l) < 0.002 && Math.abs(a.c - b.c) < 0.002 && (Math.max(a.c, b.c) < 0.002 || Math.abs(a.h - b.h) < 1);

function warmWord(t: Tone): string {
  const w = padFromTone(t).x * 2 - 1;
  if (Math.abs(w) < 0.1) return 'neutral';
  return `${Math.abs(w) < 0.55 ? 'a little ' : ''}${w < 0 ? 'cool' : 'warm'}`;
}
export function describeTone(t: Tone): string {
  const near = TONES.find((n) => sameTone(n, t));
  return `${near ? `${near.name}: ` : ''}${Math.round(t.l * 100)}% light, ${warmWord(t)}`;
}

// ---- the pad's field: the same for every look, so it is worked out once ---------------------------------------------
interface Field {
  readonly img: HTMLCanvasElement;
  /** The dead band's top and bottom edge, by column, as pad fractions. */
  readonly top: readonly (readonly [number, number])[];
  readonly bot: readonly (readonly [number, number])[];
  /** The band's middle at the pad's centre column. */
  readonly mid: number;
}
let field: Field | null = null;
function padField(): Field {
  if (field) return field;
  const N = 100;
  const img = document.createElement('canvas');
  img.width = img.height = N;
  const g = img.getContext('2d')!;
  const data = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hx = toneHex(toneFromPad((x + 0.5) / N, (y + 0.5) / N));
      const i = (y * N + x) * 4;
      data.data[i] = Number.parseInt(hx.slice(1, 3), 16);
      data.data[i + 1] = Number.parseInt(hx.slice(3, 5), 16);
      data.data[i + 2] = Number.parseInt(hx.slice(5, 7), 16);
      data.data[i + 3] = 255;
    }
  }
  g.putImageData(data, 0, 0);
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  const C = 50;
  const Y = 300;
  for (let c = 0; c <= C; c++) {
    const x = c / C;
    let t0 = -1;
    let t1 = -1;
    for (let j = 0; j <= Y; j++) {
      if (!legible(toneFromPad(x, j / Y))) {
        if (t0 < 0) t0 = j / Y;
        t1 = j / Y;
      }
    }
    if (t0 >= 0) {
      top.push([x, t0]);
      bot.push([x, t1]);
    }
  }
  const centre = top.reduce((best, p, i) => (Math.abs(p[0] - 0.5) < Math.abs(top[best]![0] - 0.5) ? i : best), 0);
  field = { img, top, bot, mid: top.length ? (top[centre]![1] + bot[centre]![1]) / 2 : 0.5 };
  return field;
}

function drawPad(cv: HTMLCanvasElement): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const F = padField();
  cv.width = cv.height = Math.round(PAD * dpr);
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(F.img, 0, 0, PAD, PAD);
  if (!F.top.length) return;
  const edge = (pts: readonly (readonly [number, number])[], dy: number): void =>
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * PAD, y * PAD + dy) : g.moveTo(x * PAD, y * PAD + dy)));
  g.save();
  g.beginPath();
  edge(F.top, 0);
  for (let i = F.bot.length - 1; i >= 0; i--) g.lineTo(F.bot[i]![0] * PAD, F.bot[i]![1] * PAD);
  g.closePath();
  g.clip();
  // Black and white strokes: the band is grey enough that each shows on half of it, whatever the look.
  g.lineWidth = 1;
  for (let k = -PAD; k < PAD * 2; k += 6) {
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k - PAD, PAD);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.34)';
    g.beginPath();
    g.moveTo(k + 3, 0);
    g.lineTo(k + 3 - PAD, PAD);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  edge(F.top, -0.5);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  edge(F.bot, 0.5);
  g.stroke();
  // The warmth axis is named on the pad's dark foot, where white always reads: the dock has no height to spare.
  g.font = `600 9px ${FACES.hyper.stack}`;
  g.textBaseline = 'bottom';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.textAlign = 'left';
  g.fillText('COOL', 6, PAD - 5);
  g.textAlign = 'right';
  g.fillText('WARM', PAD - 6, PAD - 5);
}

/** One step of the keyboard across the pad, jumping the band rather than sticking at its edge. */
function stepPad(t: Tone, dx: number, dy: number): Tone {
  const p = padFromTone(t);
  const x = clamp(p.x + dx, 0, 1);
  let y = clamp(p.y + dy, 0, 1);
  while (dy !== 0 && y > 0 && y < 1 && !legible(toneFromPad(x, y))) y = clamp(y + Math.sign(dy) * 0.005, 0, 1);
  return roundTone(nearestLegible(toneFromPad(x, y)));
}

// ---- the hue strip: the accent the engine would solve on this ground, at each hue -------------------------------------
function hueStops(look: Look, scheme: Scheme): string[] {
  const stops: string[] = [];
  for (let a = 0; a <= 360; a += 30) stops.push(palette({ ...look, accent: a % 360 }, scheme).colours.accent!);
  return stops;
}
function drawStrip(cv: HTMLCanvasElement, stops: readonly string[]): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(STRIP_W * dpr);
  cv.height = Math.round(STRIP_H * dpr);
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  const grad = g.createLinearGradient(0, 0, STRIP_W, 0);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, STRIP_W, STRIP_H);
}

/** A pointer drag on `target` reporting the pointer as fractions of its box. */
function dragOn(target: HTMLElement, move: (x: number, y: number) => void, skip?: (e: PointerEvent) => boolean): void {
  let held = false;
  const at = (e: PointerEvent): void => {
    const b = target.getBoundingClientRect();
    move(clamp((e.clientX - b.left) / b.width, 0, 1), clamp((e.clientY - b.top) / b.height, 0, 1));
  };
  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || skip?.(e)) return;
    e.preventDefault();
    held = true;
    target.focus({ preventScroll: true });
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
    target.setAttribute('data-marxy-held', '');
    at(e);
  });
  target.addEventListener('pointermove', (e) => {
    if (held) at(e);
  });
  const end = (): void => {
    held = false;
    target.removeAttribute('data-marxy-held');
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

export const mountTone: StudioPiece = (host: HTMLElement, ctx: StudioCtx) => {
  adoptRuntimeSheet(document, 'marxy-studio-tpp-style', css);
  const toneKey = (): 'day' | 'night' => (ctx.view().scheme === 'night' ? 'night' : 'day');
  const inkKey = (): 'ink' | 'inkNight' => (ctx.view().scheme === 'night' ? 'inkNight' : 'ink');
  const tone = (): Tone => ctx.look()[toneKey()];
  const setTone = (t: Tone): void => ctx.set(toneKey(), roundTone(nearestLegible(t)));

  // ---- the pad ----
  const cv = el('canvas', 'marxy-studio-tone-field');
  drawPad(cv);
  const puck = el('div', 'marxy-studio-tone-puck');
  const pad = el('div', 'marxy-studio-tone-pad');
  pad.tabIndex = 0;
  pad.setAttribute('role', 'slider');
  pad.setAttribute('aria-label', 'Page tone: across from cool to warm, down from light to dark');
  pad.title = 'Drag to set the page tone: across from cool to warm, down from light to dark. Double-click to return.';
  const dots = TONES.map((t) => {
    const p = padFromTone(t);
    const d = btn('marxy-studio-tone-dot', '', () => setTone(t), `Page tone: ${t.name}`);
    d.title = t.name;
    d.style.left = `${(clamp(p.x, 0.04, 0.96) * 100).toFixed(1)}%`;
    d.style.top = `${(clamp(p.y, 0.04, 0.96) * 100).toFixed(1)}%`;
    d.style.background = toneHex(t);
    return d;
  });
  pad.append(cv, ...dots, puck);
  dragOn(pad, (x, y) => setTone(toneFromPad(x, y)), (e) => (e.target as HTMLElement).classList.contains('marxy-studio-tone-dot'));
  pad.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).classList.contains('marxy-studio-tone-dot')) return;
    ctx.reset(toneKey());
  });
  pad.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const by: Record<string, readonly [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    const step = by[e.key];
    if (!step) return;
    e.preventDefault();
    ctx.set(toneKey(), stepPad(tone(), step[0], step[1]));
  });
  const F = padField();
  const band = el('div', 'marxy-studio-tone-band');
  band.style.top = `${(F.mid * 100).toFixed(1)}%`;
  band.append(el('i', 'marxy-studio-tone-bandmark'), el('span', '', `no ink reaches ${FLOOR} : 1 here`));
  const axis = el('div', 'marxy-studio-tone-axis');
  axis.append(el('span', 'marxy-studio-tone-ax', 'Light'), band, el('span', 'marxy-studio-tone-ax', 'Dark'));
  const padCol = el('div', 'marxy-studio-tone-padcol');
  padCol.append(pad, axis);

  // ---- the tone in words, and the named tones ----
  const head = el('div', 'marxy-studio-h');
  const words = el('div', 'marxy-studio-tone-words');
  const chips = el('div', 'marxy-studio-tone-chips');
  const chipEls = TONES.map((t) => {
    const b = btn('marxy-studio-tone-chip', '', () => setTone(t));
    b.title = `${t.name}: ${Math.round(t.l * 100)}% light`;
    const sw = el('i', 'marxy-studio-tone-swatch');
    sw.style.background = toneHex(t);
    b.append(sw, document.createTextNode(t.name));
    chips.append(b);
    return { b, t };
  });
  const toneCol = el('div', 'marxy-studio-col marxy-studio-tone-col');
  toneCol.append(head, words, chips);

  // ---- ink and accent ----
  const look0 = ctx.look();
  const ink = dial({
    label: 'Ink',
    min: 7,
    max: 21,
    step: 0.5,
    value: look0[inkKey()] || look0.ink,
    say: (v) => `${v.toFixed(1)} : 1`,
    set: (v) => ctx.set(inkKey(), v),
    reset: () => ctx.reset(inkKey()),
    note: ' ',
  });
  const inkNote = ink.el.querySelector<HTMLElement>('.marxy-studio-dial-note')!;

  const strip = el('canvas', 'marxy-studio-tone-strip');
  const mark = el('div', 'marxy-studio-tone-hue-mark');
  const hue = el('div', 'marxy-studio-tone-hue');
  hue.tabIndex = 0;
  hue.setAttribute('role', 'slider');
  hue.setAttribute('aria-label', 'Accent');
  hue.setAttribute('aria-valuemin', '0');
  hue.setAttribute('aria-valuemax', '360');
  hue.append(strip, mark);
  const hueOut = el('span', 'marxy-studio-dial-v');
  const accentRow = el('div', 'marxy-studio-dial marxy-studio-tone-accent');
  accentRow.title = 'Double-click for the look’s own value';
  accentRow.append(el('span', 'marxy-studio-dial-k', 'Accent'), hue, hueOut, el('span', 'marxy-studio-dial-note', 'Links, the cursor and marks; solved to 5.4 : 1 on the page.'));
  dragOn(hue, (x) => ctx.set('accent', Math.round(x * 360)));
  hue.addEventListener('dblclick', () => ctx.reset('accent'));
  hue.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    ctx.set('accent', (Math.round(ctx.look().accent) + d * (e.shiftKey ? 30 : 5) + 360) % 360);
  });
  const dialCol = el('div', 'marxy-studio-col marxy-studio-tone-dials');
  dialCol.append(el('div', 'marxy-studio-h', 'Ink and accent'), ink.el, accentRow);

  host.append(padCol, toneCol, dialCol);

  // The strip's thirteen palettes are solved again only once the ground stops moving: a tone drag stays smooth.
  let stripSig = '';
  let stripTimer: ReturnType<typeof setTimeout> | undefined;
  const redrawStrip = (look: Look, scheme: Scheme): void => {
    const sig = JSON.stringify([look[scheme === 'night' ? 'night' : 'day'], look.ink, look.inkNight, look.tint, scheme]);
    if (sig === stripSig) return;
    const first = stripSig === '';
    stripSig = sig;
    clearTimeout(stripTimer);
    const draw = (): void => drawStrip(strip, hueStops(look, scheme));
    if (first) draw();
    else stripTimer = setTimeout(draw, 160);
  };

  const sync = (): void => {
    const look = ctx.look();
    const scheme = ctx.view().scheme;
    const t = look[toneKey()];
    const p = padFromTone(t);
    puck.style.left = `${(clamp(p.x, 0, 1) * 100).toFixed(2)}%`;
    puck.style.top = `${(clamp(p.y, 0, 1) * 100).toFixed(2)}%`;
    puck.style.background = toneHex(t);
    const said = describeTone(t);
    pad.setAttribute('aria-valuetext', said);
    head.textContent = scheme === 'night' ? 'Page tone at night' : 'Page tone by day';
    words.textContent = said;
    for (const c of chipEls) c.b.setAttribute('aria-pressed', String(sameTone(c.t, t)));
    ink.update(look[inkKey()] || look.ink);
    const f = ctx.resolved().facts;
    inkNote.textContent = f.held ? `This tone holds ${f.contrast.toFixed(1)} : 1 at most` : `Contrast of text on the page ${scheme === 'night' ? 'at night' : 'by day'}`;
    const a = ((look.accent % 360) + 360) % 360;
    mark.style.left = `${((a / 360) * 100).toFixed(2)}%`;
    hue.setAttribute('aria-valuenow', String(Math.round(a)));
    hueOut.textContent = `${hueName(a)}, ${Math.round(a)}°`;
    hue.setAttribute('aria-valuetext', hueOut.textContent);
    redrawStrip(look, scheme);
  };
  sync();
  const off = ctx.onPaint(sync);
  return () => {
    off();
    clearTimeout(stripTimer);
  };
};
