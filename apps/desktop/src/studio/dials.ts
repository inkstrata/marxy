// The Studio's dials: a slim slider with its value in the unit a person would say ("20 px",
// "66 characters", "1.50"), a double-click returning it to the look's own value; a row of choices; a labelled row. The
// tabs share them so every dial in the dock behaves alike.
import { el, segmented, toggle } from '../frame/dom.ts';

export interface Dial {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  /** Shows `value` without calling back (the look changed elsewhere). */
  update(value: number): void;
}

export interface DialSpec {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** The value in words: `20 px`, `1.50`, `ink only`. */
  readonly say: (v: number) => string;
  /** Each move. */
  readonly set: (v: number) => void;
  /** A double-click: back to the look's own value. */
  readonly reset?: () => void;
  /** While held (pointer down to up): the Page tab shows the measure's rule then. */
  readonly hold?: (held: boolean, v: number) => void;
  readonly note?: string;
}

export function dial(spec: DialSpec): Dial {
  const row = el('label', 'marxy-studio-dial');
  const input = el('input', 'marxy-studio-range');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.value);
  input.setAttribute('aria-label', spec.label);
  const out = el('span', 'marxy-studio-dial-v', spec.say(spec.value));
  row.append(el('span', 'marxy-studio-dial-k', spec.label), input, out);
  if (spec.note) row.append(el('span', 'marxy-studio-dial-note', spec.note));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = spec.say(v);
    spec.set(v);
  });
  if (spec.reset) {
    row.title = 'Double-click for the look’s own value';
    input.addEventListener('dblclick', () => spec.reset?.());
  }
  if (spec.hold) {
    input.addEventListener('pointerdown', () => spec.hold?.(true, Number(input.value)));
    input.addEventListener('pointerup', () => spec.hold?.(false, Number(input.value)));
    input.addEventListener('blur', () => spec.hold?.(false, Number(input.value)));
  }
  return {
    el: row,
    input,
    update(v) {
      if (document.activeElement === input && input.matches(':active')) return;
      input.value = String(v);
      out.textContent = spec.say(v);
    },
  };
}

/** A labelled row holding any control. */
export function row(label: string, ...controls: Node[]): HTMLElement {
  const r = el('div', 'marxy-studio-row');
  r.append(el('span', 'marxy-studio-dial-k', label), ...controls);
  return r;
}

/** A column of the dock with a small capitals heading. */
export function column(title: string, ...children: Node[]): HTMLElement {
  const c = el('div', 'marxy-studio-col');
  c.append(el('div', 'marxy-studio-h', title), ...children);
  return c;
}

export { segmented, toggle };
