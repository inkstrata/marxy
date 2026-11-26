// The eight panels as the rail shows them before any is read: name, glyph, group and key. Each panel's code is its
// own chunk, read the first time it is shown.
import { LEFT_PANELS, type CardId } from '@marxy/core/src/layout/frame-storage.ts';
import type { Command } from '../commands/registry.ts';
import type { ExtraId, PanelDef, PanelId } from './types.ts';

/** The rail's groups, top to bottom: Places · Metadata, Outline, Links · Search, Transforms · Export, Versions. */
export const RAIL_GROUPS: readonly (readonly PanelId[])[] = [['places'], ['metadata', 'outline', 'links'], ['search', 'transforms'], ['export', 'versions']];

export const PANEL_NAMES: Readonly<Record<PanelId, string>> = {
  places: 'Places',
  metadata: 'Metadata',
  outline: 'Outline',
  links: 'Links',
  search: 'Search',
  transforms: 'Transforms',
  export: 'Export',
  versions: 'Versions',
};

export const EXTRA_NAMES: Readonly<Record<ExtraId | 'look', string>> = { look: 'Look', settings: 'Settings', clip: 'Clip' };

/** The rail tip's second line: what each button is for. */
export const RAIL_LINES: Readonly<Record<PanelId | 'look' | 'settings', string>> = {
  places: 'The folders you read from',
  metadata: 'What this file is, and how it is read',
  outline: 'Its headings and parts',
  links: 'Where its links lead, and what points here',
  search: 'Find and replace, in a file or a place',
  transforms: 'Change the text, staged as a patch',
  export: 'Save it as a page, a PDF or text',
  versions: 'Copies kept before each save',
  look: 'Themes, type and measure, in the Studio',
  settings: 'Every line of config.toml',
};

/** `Alt+1` to `Alt+8`, in the rail's order. */
export const panelKey = (id: PanelId): string => `Alt+${LEFT_PANELS.indexOf(id) + 1}`;

/** Where each card's content went when the panel of cards was retired. */
export const CARD_PANEL: Readonly<Record<CardId, PanelId>> = {
  reading: 'metadata',
  frontmatter: 'metadata',
  notes: 'metadata',
  facts: 'metadata',
  contents: 'outline',
  section: 'outline',
  links: 'links',
};

type Loader = () => Promise<{ readonly default: PanelDef<any> }>;

export const PANEL_LOADERS: Readonly<Record<PanelId, Loader>> = {
  places: () => import('./panels/places.ts'),
  metadata: () => import('./panels/metadata.ts'),
  outline: () => import('./panels/outline.ts'),
  links: () => import('./panels/links.ts'),
  search: () => import('./panels/search.ts'),
  transforms: () => import('./panels/transforms.ts'),
  export: () => import('./panels/export.ts'),
  versions: () => import('./panels/versions.ts'),
};

const loaded: Command[] = [];

/** The commands of the panels read so far (each panel's `commands()`), joined to the registry by commands/frame.ts. */
export const panelCommands = (): readonly Command[] => loaded;

export function addPanelCommands(list: readonly Command[]): void {
  for (const c of list) if (!loaded.some((x) => x.id === c.id)) loaded.push(c);
}
