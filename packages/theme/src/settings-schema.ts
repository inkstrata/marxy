// The Settings page's schema (W-12, ADR-0075): every key `config.ts` parses, once, with the category it is drawn under, the
// words a reader might search it by, its control, default, range and coupling rule. Pure: no DOM, no shell. The page draws
// these rows and nothing else, so a setting with no key in config.toml cannot be drawn, and `settings-schema.test.ts` fails
// for a key that `KNOWN_KEYS` lists and no row names (and for a row whose key `config.ts` does not parse).
import { parse } from 'smol-toml';
import { COPY_FORMATS, CHROME_SIZE_MAX, CHROME_SIZE_MIN, KNOWN_KEYS, parseConfig, tomlString } from './config.ts';
import type { Config } from './config.ts';

export type CategoryId = 'general' | 'appearance' | 'reading' | 'source' | 'types' | 'collections' | 'accessibility' | 'privacy' | 'advanced';

export interface Category {
  readonly id: CategoryId;
  readonly title: string;
  /** One line under the title. */
  readonly blurb: string;
}

/**
 * The categories, in the order they are listed (the card's). A category with no row is not drawn (`drawnCategories`), so
 * Collections waits for a key of `config.toml` that belongs to it: `collection.toml` is a file of its own and is not edited here.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'general', title: 'General', blurb: 'How Marxy hands things to the rest of your Mac' },
  { id: 'appearance', title: 'Appearance', blurb: 'The theme, the variant and the size of the chrome' },
  { id: 'reading', title: 'Reading', blurb: 'The text size, the measure and the line breaker' },
  { id: 'source', title: 'Source', blurb: 'What the Source editor draws' },
  { id: 'types', title: 'Content types', blurb: 'How folders are read and which tools a kind shows' },
  { id: 'collections', title: 'Collections', blurb: 'The folders Marxy searches' },
  { id: 'accessibility', title: 'Accessibility', blurb: 'Contrast and transparency' },
  { id: 'privacy', title: 'Privacy', blurb: 'What Marxy keeps on this Mac, and what can leave it' },
  { id: 'advanced', title: 'Advanced', blurb: 'The file itself' },
];

export type SettingValue = boolean | number | string | null;

export interface ChoiceOption {
  /** What is written to config.toml, or '' with `unset` for the option that removes the key. */
  readonly value: string;
  readonly label: string;
  /** Choosing this option removes the key (it is the default): the file then says nothing. */
  readonly unset?: boolean;
}

export type Control =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'choice'; readonly options: readonly ChoiceOption[] }
  | { readonly kind: 'range'; readonly min: number; readonly max: number; readonly step: number; readonly unit: string }
  | { readonly kind: 'text'; readonly placeholder: string }
  /** Tables (`[[kind]]`, `[strip]`, `[linux]`): shown with what they hold, edited in config.toml. */
  | { readonly kind: 'table' };

export interface Coupling {
  /** The control is disabled, and says `reason`, while `key` has `value` (the effective value). */
  readonly disabledWhen?: { readonly key: string; readonly value: SettingValue; readonly reason: string };
  /** A sentence under the control that is always true of it (a rule that does not switch it off). */
  readonly note?: string;
}

export interface SettingRow {
  /** The key of config.toml, which is also the row's id. */
  readonly key: string;
  readonly category: CategoryId;
  readonly label: string;
  readonly description: string;
  /** Words a reader may search by that the label and description do not hold. */
  readonly words: readonly string[];
  readonly control: Control;
  /** What the key means when it is absent. `null`: the file's kind, the theme or the system decides (`defaultLabel`). */
  readonly default: SettingValue;
  /** The default, said. */
  readonly defaultLabel: string;
  /** The effective value in `config`, as the control shows it. */
  readonly read: (config: Config) => SettingValue;
  readonly coupling?: Coupling;
  /** A sentence that is true of this key today and worth saying (a key Marxy reads and does not yet act on). */
  readonly caveat?: string;
  /** False for a table: the dot and the reset do not apply, since the key is not one line. */
  readonly resettable: boolean;
}

const yes: ChoiceOption[] = [
  { value: '', label: 'Per file', unset: true },
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
];

/** The five bundled themes (`apps/desktop/src/theme/bundled-themes.ts`, held equal by the page's own test); '' is Night and Paper. */
export const THEME_OPTIONS: readonly ChoiceOption[] = [
  { value: '', label: 'Night and Paper', unset: true },
  { value: 'ink', label: 'Ink' },
  { value: 'warm', label: 'Dusk and Sepia' },
  { value: 'fjord', label: 'Fjord (dark only)' },
  { value: 'high-contrast', label: 'High contrast' },
];

const COPY_LABELS: Readonly<Record<string, string>> = {
  markdown: 'Markdown',
  plain: 'Plain text',
  rich: 'Rich text',
  html: 'HTML',
  slack: 'Slack',
  jira: 'Jira',
  'json-string': 'JSON string',
  quote: 'Quote',
};

export const SETTINGS: readonly SettingRow[] = [
  {
    key: 'external_editor',
    category: 'general',
    label: 'External editor',
    description: 'The command Open in external editor runs. {file} and {line} are replaced; with none set, the system opens the file.',
    words: ['vscode', 'code', 'editor', 'open with', 'command', 'program'],
    control: { kind: 'text', placeholder: 'code --goto {file}:{line}' },
    default: null,
    defaultLabel: 'The system opener',
    read: (c) => c.externalEditor,
    resettable: true,
  },
  {
    key: 'copy_format',
    category: 'general',
    label: 'Copy as, first choice',
    description: 'The Copy as row that comes first and that Return chooses.',
    words: ['clipboard', 'copy', 'paste', 'format', 'markdown'],
    control: { kind: 'choice', options: COPY_FORMATS.map((id) => ({ value: id, label: COPY_LABELS[id] ?? id, ...(id === 'markdown' ? { unset: true } : {}) })) },
    default: 'markdown',
    defaultLabel: 'Markdown',
    read: (c) => c.copyFormat,
    resettable: true,
  },
  {
    key: 'resident',
    category: 'general',
    label: 'Stay running after the last window closes',
    description: 'Keeps Marxy in the background so the next file opens at once.',
    words: ['background', 'quit', 'close', 'dock', 'launch'],
    control: { kind: 'toggle' },
    default: false,
    defaultLabel: 'Off',
    read: (c) => c.resident,
    caveat: 'Marxy reads this key but does not act on it yet.',
    resettable: true,
  },
  {
    key: 'theme',
    category: 'appearance',
    label: 'Theme',
    description: 'The look of the page. A theme folder named in config.toml is shown as it is and left alone.',
    words: ['colour', 'color', 'night', 'paper', 'ink', 'dusk', 'sepia', 'fjord', 'dark', 'palette', 'look'],
    control: { kind: 'choice', options: THEME_OPTIONS },
    default: '',
    defaultLabel: 'Night and Paper',
    read: (c) => c.theme ?? '',
    resettable: true,
  },
  {
    key: 'variant',
    category: 'appearance',
    label: 'Variant',
    description: 'Dark, light, or whichever the system is using.',
    words: ['dark', 'light', 'night', 'paper', 'auto', 'system', 'mode', 'appearance'],
    control: {
      kind: 'choice',
      options: [
        { value: 'dark', label: 'Dark', unset: true },
        { value: 'light', label: 'Light' },
        { value: 'auto', label: 'Follow the system' },
      ],
    },
    default: 'dark',
    defaultLabel: 'Dark',
    read: (c) => c.variant,
    resettable: true,
  },
  {
    key: 'chrome_size',
    category: 'appearance',
    label: 'Interface text size',
    description: 'The size of the text of controls, in pixels. Unset, the theme sets it.',
    words: ['chrome', 'toolbar', 'sidebar', 'buttons', 'ui', 'font', 'larger', 'smaller'],
    control: { kind: 'range', min: CHROME_SIZE_MIN, max: CHROME_SIZE_MAX, step: 1, unit: 'px' },
    default: null,
    defaultLabel: 'set by the theme',
    read: (c) => c.chromeSize,
    resettable: true,
  },
  {
    key: 'size',
    category: 'reading',
    label: 'Text size',
    description: 'The size of body text, in pixels. Mod+= and Mod+- change it too.',
    words: ['font', 'zoom', 'larger', 'smaller', 'bigger', 'body', 'type'],
    control: { kind: 'range', min: 15, max: 50, step: 1, unit: 'px' },
    default: 20,
    defaultLabel: '20 px',
    read: (c) => c.size,
    resettable: true,
  },
  {
    key: 'measure',
    category: 'reading',
    label: 'Measure',
    description: 'Average characters per line, from 45 to 80. Counted in characters, never in the width of a screen.',
    words: ['line length', 'width', 'column', 'characters', 'narrow', 'wide'],
    control: { kind: 'range', min: 45, max: 80, step: 1, unit: 'characters' },
    default: 66,
    defaultLabel: '66 characters',
    read: (c) => c.measure,
    coupling: {
      disabledWhen: { key: 'typeset', value: false, reason: 'Needs Typeset. With Typeset off, Marxy leaves each line to the browser and sets no measure.' },
    },
    resettable: true,
  },
  {
    key: 'typeset',
    category: 'reading',
    label: 'Typeset',
    description: 'Set paragraphs with Marxy’s line breaker (Knuth and Plass), hanging punctuation and the baseline grid. Off leaves line breaking to the browser.',
    words: ['justify', 'line breaking', 'knuth', 'plass', 'ragged', 'hyphenation', 'typography', 'engine'],
    control: { kind: 'toggle' },
    default: true,
    defaultLabel: 'On',
    read: (c) => c.typeset,
    resettable: true,
  },
  {
    key: 'line_numbers',
    category: 'source',
    label: 'Line numbers',
    description: 'The gutter of line numbers in Source. Per file: on for code, off for prose.',
    words: ['gutter', 'lines', 'numbers', 'editor'],
    control: { kind: 'choice', options: yes },
    default: null,
    defaultLabel: 'Per file',
    read: (c) => c.lineNumbers ?? null,
    resettable: true,
  },
  {
    key: 'show_whitespace',
    category: 'source',
    label: 'Show whitespace',
    description: 'Draws tabs and trailing spaces faintly in Source. A view only: the file is not changed.',
    words: ['tabs', 'spaces', 'invisible', 'trailing', 'characters', 'editor'],
    control: { kind: 'toggle' },
    default: false,
    defaultLabel: 'Off',
    read: (c) => c.showWhitespace ?? false,
    resettable: true,
  },
  {
    key: 'column_guide',
    category: 'source',
    label: 'Column guide',
    description: 'A hairline at a column in Source. Per file: on for code, off for prose.',
    words: ['ruler', 'margin', 'wrap', '80', 'editorconfig', 'max line length', 'editor'],
    control: { kind: 'choice', options: yes },
    default: null,
    defaultLabel: 'Per file',
    read: (c) => c.columnGuide ?? null,
    coupling: { note: 'The column is 80, or the .editorconfig max_line_length of a file that has one.' },
    resettable: true,
  },
  {
    key: 'kind',
    category: 'types',
    label: 'How folders are read',
    description: 'Rules that read the files under a folder as a kind of document. Added by Always open this folder as; edited in config.toml.',
    words: ['kind', 'folder', 'glob', 'rules', 'transcript', 'report', 'notes', 'detect', 'always open as'],
    control: { kind: 'table' },
    default: null,
    defaultLabel: 'No rules',
    read: (c) => c.kindRules.length,
    resettable: false,
  },
  {
    key: 'strip',
    category: 'types',
    label: 'Tools a kind shows',
    description: 'Which tools the band under the toolbar shows for each kind, in order, at most four. Edited in config.toml.',
    words: ['strip', 'tools', 'band', 'toolbar', 'kind'],
    control: { kind: 'table' },
    default: null,
    defaultLabel: "Each kind's own row",
    read: (c) => Object.keys(c.strip).length,
    resettable: false,
  },
  {
    key: 'contrast',
    category: 'accessibility',
    label: 'Contrast',
    description: 'More contrast draws hairlines and secondary text stronger. System follows the system’s Increase contrast as it changes.',
    words: ['increase contrast', 'high contrast', 'vision', 'hairlines', 'legibility'],
    control: {
      kind: 'choice',
      options: [
        { value: 'system', label: 'System', unset: true },
        { value: 'more', label: 'More' },
        { value: 'normal', label: 'Normal' },
      ],
    },
    default: 'system',
    defaultLabel: 'System',
    read: (c) => c.contrast,
    resettable: true,
  },
  {
    key: 'reduce_transparency',
    category: 'accessibility',
    label: 'Reduce transparency',
    description: 'Draws the find fills and the toolbar and tab fades solid. Marxy does not read the system’s setting.',
    words: ['solid', 'blur', 'translucent', 'fades', 'vision'],
    control: { kind: 'toggle' },
    default: false,
    defaultLabel: 'Off',
    read: (c) => c.reduceTransparency,
    resettable: true,
  },
  {
    key: 'versions',
    category: 'privacy',
    label: 'Keep versions of the files you read',
    description: 'Byte-exact copies of the files you read and save, kept in Marxy’s own folder, 20 per file for 30 days. Off keeps no new ones; the ones kept stay until they age out or you clear them.',
    words: ['history', 'snapshots', 'backup', 'local versions', 'undo', 'clear'],
    control: { kind: 'toggle' },
    default: true,
    defaultLabel: 'On',
    read: (c) => c.versions,
    resettable: true,
  },
  {
    key: 'linux',
    category: 'advanced',
    label: 'Linux font weight offset',
    description: '[linux] weight_offset replaces the table of weight offsets by WebKitGTK version. Edited in config.toml.',
    words: ['weight', 'webkitgtk', 'font', 'platform'],
    control: { kind: 'table' },
    default: null,
    defaultLabel: 'The table’s',
    read: (c) => c.linuxWeightOffset,
    resettable: false,
  },
];

/** The rows drawn under `category`, in order. */
export function rowsOf(category: CategoryId): readonly SettingRow[] {
  return SETTINGS.filter((r) => r.category === category);
}

/** The categories that have a row, in the card's order: the sidebar of the page. */
export function drawnCategories(): readonly Category[] {
  return CATEGORIES.filter((c) => c.id === 'privacy' || c.id === 'advanced' || rowsOf(c.id).length > 0);
}

export function rowFor(key: string): SettingRow | undefined {
  return SETTINGS.find((r) => r.key === key);
}

/** Keys that have a row, for the test that holds this table equal to `config.ts`. */
export function schemaKeys(): readonly string[] {
  return SETTINGS.map((r) => r.key);
}

/** The keys `config.ts` parses that no row names. Empty when the schema is whole. */
export function missingRows(): readonly string[] {
  const have = new Set(schemaKeys());
  return KNOWN_KEYS.filter((k) => !have.has(k));
}

export interface SettingState {
  readonly row: SettingRow;
  /** The value in force, as the control shows it. */
  readonly value: SettingValue;
  /** The key has a line in config.toml (or a table of that name). */
  readonly present: boolean;
  /** The line says something the key cannot take; the default (or the clamp) is in force. */
  readonly invalid: boolean;
  /** Changed from the default: the dot. A key set to its own default is not changed. */
  readonly changed: boolean;
  /** Why the control is disabled, or null. */
  readonly disabled: string | null;
}

export interface SettingsRead {
  readonly config: Config;
  readonly states: readonly SettingState[];
  readonly unknownKeys: readonly string[];
  readonly warnings: readonly string[];
  /** config.toml is not TOML: the page shows defaults and says to fix the file by hand. */
  readonly unparseable: boolean;
}

function sameValue(raw: unknown, effective: SettingValue): boolean {
  if (raw === undefined) return true;
  if (typeof raw === 'number' && typeof effective === 'number') return raw === effective;
  return raw === effective;
}

/** The state of every row for the bytes of a config.toml. Never throws: an unparseable file reads as the defaults. */
export function readSettings(bytes: Uint8Array, ctx: { readonly home?: string } = {}): SettingsRead {
  const parsed = parseConfig(bytes, ctx);
  const config = parsed.config;
  let raw: Record<string, unknown> = {};
  let unparseable = false;
  const text = new TextDecoder().decode(bytes);
  if (text.trim() !== '') {
    try {
      raw = parse(text) as Record<string, unknown>;
    } catch {
      unparseable = true;
    }
  }
  const states = SETTINGS.map((row): SettingState => {
    const present = Object.prototype.hasOwnProperty.call(raw, row.key);
    const value = row.read(config);
    const isTable = row.control.kind === 'table';
    const invalid = present && !isTable && !sameValue(raw[row.key], row.key === 'theme' ? (config.theme ?? '') : value);
    const atDefault = row.default === null ? value === null : value === row.default;
    const changed = row.resettable && present && (invalid || !atDefault);
    return { row, value, present, invalid, changed, disabled: null };
  });
  const byKey = new Map(states.map((s) => [s.row.key, s]));
  const withCouplings = states.map((s): SettingState => {
    const when = s.row.coupling?.disabledWhen;
    if (!when) return s;
    const other = byKey.get(when.key);
    return other !== undefined && other.value === when.value ? { ...s, disabled: when.reason } : s;
  });
  return { config, states: withCouplings, unknownKeys: parsed.unknownKeys, warnings: parsed.warnings, unparseable };
}

/**
 * The line to write for a control's value: `{ toml }` to set the key, `{ remove: true }` to take its line out (the value is the
 * default, which a file that says nothing already means). `null` for a value the control cannot give (out of range, not a number).
 */
export function writeFor(row: SettingRow, input: string | boolean | number): { readonly toml: string } | { readonly remove: true } | null {
  const c = row.control;
  if (c.kind === 'toggle') {
    if (typeof input !== 'boolean') return null;
    return { toml: String(input) };
  }
  if (c.kind === 'choice') {
    const option = c.options.find((o) => o.value === String(input));
    if (!option) return null;
    if (option.unset) return { remove: true };
    // A choice among booleans (Per file / On / Off) is written bare; the rest are strings.
    return { toml: option.value === 'true' || option.value === 'false' ? option.value : `"${option.value}"` };
  }
  if (c.kind === 'range') {
    const n = typeof input === 'number' ? input : Number(input);
    if (!Number.isFinite(n) || n < c.min || n > c.max) return null;
    return { toml: String(Math.round(n)) };
  }
  if (c.kind === 'text') {
    const text = String(input).trim();
    return text === '' ? { remove: true } : { toml: tomlString(text) };
  }
  return null;
}

export interface SearchHit {
  readonly row: SettingRow;
  /** What the query matched in, beyond the label: `key` and `words` are said to the reader ("Matches show_whitespace"). */
  readonly via: 'label' | 'description' | 'words' | 'key' | 'category';
}

const normalise = (s: string): string => s.toLowerCase().replace(/[_\-.]+/g, ' ');

/**
 * Settings that match every word of `query`, in schema order. A word matches in the label, the description, the row's words, the
 * key (`show_whitespace` is found by "show whitespace" or "whitespace") or the category's name. An empty query matches nothing.
 */
export function searchSettings(query: string): readonly SearchHit[] {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const row of SETTINGS) {
    const category = CATEGORIES.find((c) => c.id === row.category)!;
    const fields = {
      label: normalise(row.label),
      description: normalise(row.description),
      words: normalise(row.words.join(' ')),
      key: normalise(row.key),
      category: normalise(category.title),
    } as const;
    const order = ['label', 'description', 'words', 'key', 'category'] as const;
    const reasons = terms.map((t) => order.find((f) => fields[f].includes(t)));
    if (reasons.some((r) => r === undefined)) continue;
    // The least obvious place any word was found in is what the row says.
    const via = reasons.reduce<SearchHit['via']>((worst, r) => (order.indexOf(r!) > order.indexOf(worst) ? r! : worst), 'label');
    hits.push({ row, via });
  }
  return hits;
}
