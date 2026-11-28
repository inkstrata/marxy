// The looks that ship, in shelf order, and the shelves they stand on. A theme is one file here: a look whose colours are
// derived from its tone and dials, or drawn by hand as pins (define.ts). A look naming `theme` also has a bundled sheet,
// packages/theme/<theme>/theme.css, written from it (scripts/write-theme-sheets.mjs), so config.toml can name it too.
import type { Look } from '../look.ts';
import { black } from './black.ts';
import { book } from './book.ts';
import { catppuccin } from './catppuccin.ts';
import { consoleLook } from './console.ts';
import { dim } from './dim.ts';
import { draft } from './draft.ts';
import { ember } from './ember.ts';
import { fjord } from './fjord.ts';
import { gruvbox } from './gruvbox.ts';
import { highContrast } from './high-contrast.ts';
import { indigo } from './indigo.ts';
import { ink } from './ink.ts';
import { large } from './large.ts';
import { midnight } from './midnight.ts';
import { mint } from './mint.ts';
import { moss } from './moss.ts';
import { newsprint } from './newsprint.ts';
import { nightPaper } from './night-paper.ts';
import { paper } from './paper.ts';
import { plain } from './plain.ts';
import { polar } from './polar.ts';
import { rosePine } from './rose-pine.ts';
import { slate } from './slate.ts';
import { solarized } from './solarized.ts';
import { vellum } from './vellum.ts';
import { warm } from './warm.ts';

/**
 * The appearance a look is known by: its page dark or light. A look still has a page for the other scheme (Ink's warm
 * paper by day), but the shelf shows it, names it and chooses it as this one.
 */
export type LookGroup = 'dark' | 'light';

/** The shelves, in order, each with the line the Studio says under its name. */
export const LOOK_GROUPS: readonly { readonly id: LookGroup; readonly name: string; readonly note: string }[] = [
  { id: 'dark', name: 'Dark', note: 'Light text on a dark page. Each has a light page for the day, said in its description.' },
  { id: 'light', name: 'Light', note: 'Dark text on a light page. Each turns to its own night page after dark.' },
];

/** Ink first: a look not found falls back to the first. */
export const LOOKS: readonly Look[] = [
  ink, nightPaper, midnight, black, ember, fjord, polar, indigo, warm, moss, consoleLook,
  solarized, gruvbox, rosePine, catppuccin, highContrast,
  paper, book, newsprint, vellum, mint, dim, plain, slate, draft, large,
];

/** The look a new state starts from: Ink, the theme the app wears with nothing chosen. */
export const DEFAULT_LOOK = 'ink';
