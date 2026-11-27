// The Studio's Type tab: the face, shown as its own name set in
// it; size, leading and weight; the headings' weight, step, face, style and capitals.
import { FACE_IDS, FACES, type FaceId, type Look } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { btn, el } from '../frame/dom.ts';
import type { StudioCtx, StudioPiece } from './context.ts';
import { dial, row, segmented, toggle, type Dial } from './dials.ts';
import css from './tabs-tpp.css?inline';

/** Presses the option of a row of choices that matches `value` (the look changed elsewhere). */
export function syncSeg(seg: HTMLElement, values: readonly string[], value: string): void {
  [...seg.children].forEach((b, i) => b.setAttribute('aria-checked', String(values[i] === value)));
}

type NumKey = 'size' | 'lead' | 'weight' | 'headWeight' | 'scale';

/** A dial on a numeric key of the look, following the look in `sync`. */
export function lookDial(ctx: StudioCtx, key: NumKey | 'measure', spec: { readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly say: (v: number) => string; readonly note?: string; readonly hold?: (held: boolean, v: number) => void; readonly set?: (v: number) => void }): Dial & { sync(look: Look): void } {
  const d = dial({
    ...spec,
    value: ctx.look()[key],
    set: (v) => {
      ctx.set(key, v);
      spec.set?.(v);
    },
    reset: () => ctx.reset(key),
  });
  return { ...d, sync: (look) => d.update(look[key]) };
}

const px = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(1)} px`;
const whole = (v: number): string => String(Math.round(v));

export const mountType: StudioPiece = (host: HTMLElement, ctx: StudioCtx) => {
  adoptRuntimeSheet(document, 'marxy-studio-tpp-style', css);

  const faces = el('div', 'marxy-studio-type-faces');
  faces.setAttribute('role', 'radiogroup');
  faces.setAttribute('aria-label', 'Face');
  const faceEls = FACE_IDS.map((id) => {
    const f = FACES[id];
    const b = btn('marxy-studio-type-face', '', () => ctx.set('face', id));
    b.setAttribute('role', 'radio');
    b.title = `${f.name}, ${f.note}`;
    const name = el('span', 'marxy-studio-type-facename', f.name);
    name.style.fontFamily = f.stack;
    b.append(name, el('span', 'marxy-studio-type-facenote', f.note));
    faces.append(b);
    return { b, id };
  });

  const size = lookDial(ctx, 'size', { label: 'Size', min: 14, max: 34, step: 0.5, say: px });
  const lead = lookDial(ctx, 'lead', { label: 'Leading', min: 1.2, max: 2, step: 0.01, say: (v) => v.toFixed(2) });
  const weight = lookDial(ctx, 'weight', { label: 'Weight', min: 300, max: 600, step: 10, say: whole });
  const headWeight = lookDial(ctx, 'headWeight', { label: 'Weight', min: 400, max: 800, step: 10, say: whole });
  const scale = lookDial(ctx, 'scale', { label: 'Step', min: 1.05, max: 1.4, step: 0.01, say: (v) => v.toFixed(2) });
  headWeight.input.setAttribute('aria-label', 'Heading weight');
  scale.input.setAttribute('aria-label', 'Step between heading levels');
  const dials = [size, lead, weight, headWeight, scale];

  const look0 = ctx.look();
  const headFace = el('select', 'marxy-studio-type-select');
  headFace.setAttribute('aria-label', 'Heading face');
  headFace.append(new Option('Same as the text', ''), ...FACE_IDS.map((id) => new Option(FACES[id].name, id)));
  headFace.value = look0.headFace ?? '';
  headFace.addEventListener('change', () => {
    if (headFace.value === '') ctx.reset('headFace');
    else ctx.set('headFace', headFace.value as FaceId);
  });
  const STYLES = [['normal', 'Upright'], ['italic', 'Italic']] as const;
  const style = segmented('Heading style', STYLES, look0.headStyle ?? 'normal', (v) => ctx.set('headStyle', v));
  const caps = toggle('Headings in capitals', look0.caps === true, (on) => ctx.set('caps', on));

  const textCol = el('div', 'marxy-studio-col marxy-studio-type-dials');
  textCol.append(el('div', 'marxy-studio-h', 'Text'), size.el, lead.el, weight.el);
  const headCol = el('div', 'marxy-studio-col marxy-studio-type-dials');
  headCol.append(el('div', 'marxy-studio-h', 'Headings'), headWeight.el, scale.el, row('Face', headFace));
  const formCol = el('div', 'marxy-studio-col marxy-studio-type-narrow');
  formCol.append(el('div', 'marxy-studio-h', 'Heading style'), row('Style', style), row('Capitals', caps));
  const faceCol = el('div', 'marxy-studio-col marxy-studio-type-facecol');
  faceCol.append(el('div', 'marxy-studio-h', 'Face'), faces);
  host.append(faceCol, textCol, headCol, formCol);

  const sync = (): void => {
    const look = ctx.look();
    for (const f of faceEls) f.b.setAttribute('aria-checked', String(f.id === look.face));
    for (const d of dials) d.sync(look);
    if (document.activeElement !== headFace) headFace.value = look.headFace ?? '';
    syncSeg(style, STYLES.map(([v]) => v), look.headStyle ?? 'normal');
    caps.setAttribute('aria-checked', String(look.caps === true));
  };
  sync();
  return ctx.onPaint(sync);
};
