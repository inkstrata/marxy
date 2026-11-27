// The faces looks are set in, the named tones, the built-in rules, and the looks that ship. The
// looks themselves are one file each under looks/, in shelf order (looks/index.ts): data only, look.ts derives every
// colour and size from them.
import type { Rule, Tone } from './look.ts';

export type FaceId = 'literata' | 'source' | 'hyper' | 'inter' | 'sitka' | 'palatino' | 'georgia' | 'segoe' | 'mono';

export interface Face {
  readonly name: string;
  readonly note: string;
  readonly stack: string;
  /** A variable face: its weight eases at night. */
  readonly variable?: boolean;
  /** Bundled with the app (fonts/), so it is the same face on every machine. */
  readonly bundled?: boolean;
  /** Average advance and x-height in em at 400, measured on Windows at 20 px (the app measures again where it can). */
  readonly metrics: { readonly avg: number; readonly xh: number };
}

export const FACES: Readonly<Record<FaceId, Face>> = {
  // The bundled faces first (fonts/README.md): measured at 20 px, where Literata's and Source Serif's optical sizes set them.
  literata: { name: 'Literata', note: 'a book face, bundled', stack: '"Literata", "Sitka Text", Georgia, serif', variable: true, bundled: true, metrics: { avg: 0.463, xh: 0.52 } },
  source: { name: 'Source Serif', note: 'an editorial serif, bundled', stack: '"Source Serif 4", "Literata", Georgia, serif', variable: true, bundled: true, metrics: { avg: 0.434, xh: 0.47 } },
  hyper: { name: 'Hyperlegible', note: 'Atkinson Hyperlegible Next', stack: '"Atkinson Hyperlegible Next", "Segoe UI Variable Text", system-ui, sans-serif', variable: true, bundled: true, metrics: { avg: 0.425, xh: 0.49 } },
  inter: { name: 'Inter', note: 'a plain sans, bundled', stack: '"Inter", "Segoe UI Variable Text", system-ui, sans-serif', variable: true, bundled: true, metrics: { avg: 0.454, xh: 0.53 } },
  sitka: { name: 'Sitka', note: 'a reading serif', stack: '"Sitka Text", "Literata", Charter, "Iowan Old Style", Cambria, Georgia, serif', metrics: { avg: 0.47, xh: 0.48 } },
  palatino: { name: 'Palatino', note: 'a book serif', stack: '"Palatino Linotype", Palatino, "Book Antiqua", "Iowan Old Style", Georgia, serif', metrics: { avg: 0.44, xh: 0.45 } },
  georgia: { name: 'Georgia', note: 'a sturdy serif', stack: 'Georgia, "Times New Roman", serif', metrics: { avg: 0.46, xh: 0.48 } },
  segoe: { name: 'Segoe', note: 'the system sans', stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif', variable: true, metrics: { avg: 0.43, xh: 0.5 } },
  mono: { name: 'JetBrains Mono', note: 'fixed width', stack: '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace', variable: true, bundled: true, metrics: { avg: 0.6, xh: 0.55 } },
};

export const FACE_IDS = Object.keys(FACES) as FaceId[];

/** Named tones: dots on the tone pad and a row of chips beside it. */
export const TONES: readonly (Tone & { readonly name: string })[] = [
  { name: 'White', l: 1, c: 0, h: 0 },
  { name: 'Paper', l: 0.975, c: 0.01, h: 85 },
  { name: 'Cream', l: 0.955, c: 0.028, h: 88 },
  { name: 'Mist', l: 0.935, c: 0.008, h: 250 },
  { name: 'Sepia', l: 0.905, c: 0.044, h: 80 },
  { name: 'Dusk', l: 0.3, c: 0.014, h: 70 },
  { name: 'Slate', l: 0.245, c: 0.016, h: 255 },
  { name: 'Ink', l: 0.192, c: 0.004, h: 85 },
  { name: 'Night', l: 0.165, c: 0.005, h: 250 },
  { name: 'Black', l: 0, c: 0, h: 0 },
];

export { DEFAULT_LOOK, LOOKS, LOOK_GROUPS } from './looks/index.ts';
export type { LookGroup } from './looks/index.ts';

/** How a look adapts: each a sentence the reader can switch. The last two are samples of the reader's own, removable. */
export const BUILT_IN_RULES: readonly Rule[] = [
  { id: 'dark', on: true, label: 'After dark, turn the page to its night tone', hint: 'Follows the system, the clock, or your choice.' },
  { id: 'kinds', on: true, label: 'Code, logs and patches in the fixed-width face; data in the interface face', hint: 'Prose keeps the look’s own face.' },
  { id: 'working', on: true, label: 'Working documents get a wider measure', hint: 'Reports, docs, notes and changelogs: lists, tables and code need the room.' },
  { id: 'narrow', on: true, label: 'In a narrow pane, tighten the page', hint: 'A slightly smaller size below 620 px.' },
  { id: 'wide', on: false, label: 'On a very wide pane, let the type grow a little', hint: 'Above 1,500 px. Off unless you ask.' },
  { id: 'lean', on: true, label: 'Lean back: larger type and shorter lines', hint: 'One key (B) when you sit away from the screen.' },
];

/** The reader's own rules a new state starts with: one on, one off. */
export const SAMPLE_RULES: readonly Rule[] = [
  { id: 'reading', on: true, user: true, label: 'Files in reading/ use Book', when: { path: 'reading/' }, set: { look: 'book' } },
  { id: 'logs', on: false, user: true, label: 'Logs and sessions use Console', when: { kinds: ['log', 'terminal'] }, set: { look: 'console' } },
];
