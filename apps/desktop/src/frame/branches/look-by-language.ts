// Look › By language: the switch for colour by language and the one for its accent, then each language
// that ships a palette with its swatches and whether they are its own or yours. One opens to its roles, each a colour
// with its contrast on the grounds code sits on here. A colour you set is one line in config.toml, `[syntax.rust]
// keyword = "#c45a22"`, written through `editConfig` as Settings writes, and in force at once in Read and Source.
import { LANG_PALETTES, contrastRatio, hexToRgb, parseConfig, removeTableKey, rgbToHex, setTableKey, type SyntaxConfig } from '@marxy/theme';
import type { AppHandle } from '../../app-types.ts';
import { notify } from '../../notices/index.ts';
import { applySyntaxConfig, currentSyntax, drawnColour, groundsNow } from '../../theme/lang-colour.ts';
import { editConfig } from '../../theme/reader-config.ts';
import { el, section, toggle } from '../dom.ts';

/** The roles Look shows for a language; function names keep the shared colour unless you set one. */
const ROLES: readonly { readonly role: string; readonly label: string }[] = [
  { role: 'keyword', label: 'Keywords' },
  { role: 'type', label: 'Types' },
  { role: 'function', label: 'Functions' },
  { role: 'string', label: 'Strings' },
  { role: 'number', label: 'Numbers and literals' },
  { role: 'decorator', label: 'Attributes and macros' },
];
const LABEL_FOR: Readonly<Record<string, Readonly<Record<string, string>>>> = { python: { decorator: 'Decorators' } };

/** The language opened to its roles, kept while the drawer is redrawn. */
let open: string | null = null;

/** One edit of config.toml, then `[syntax]` as the file now says, on the page. False after a notice when it could not be written. */
async function write(handle: AppHandle, edit: (bytes: Uint8Array) => Uint8Array): Promise<boolean> {
  try {
    const bytes = await editConfig(handle.shell, edit, {});
    if (bytes === null) return false;
    applySyntaxConfig(parseConfig(bytes).config.syntax);
    return true;
  } catch (e) {
    notify({ kind: 'error', text: `config.toml could not be updated · ${e instanceof Error ? e.message : String(e)} · nothing was changed` });
    return false;
  }
}

/** The By language section; `redraw` draws the drawer again after a change. */
export function byLanguage(handle: AppHandle, redraw: () => void): HTMLElement {
  const syntax: SyntaxConfig = currentSyntax();
  const { root: sec } = section('By language', 'each language’s own colours');

  const switchRow = (label: string, on: boolean, note: string, key: 'by_language' | 'accent'): HTMLElement => {
    const row = el('div', 'marxy-ctl');
    row.append(
      el('span', 'marxy-ctl-k', label),
      toggle(label, on, (next) => {
        // On is the default, so on takes the line out and off is the one line.
        void write(handle, (b) => (next ? removeTableKey(b, ['syntax'], key) : setTableKey(b, ['syntax'], key, 'false'))).then(redraw);
      }),
      el('span', 'marxy-ctl-d', note),
    );
    return row;
  };
  sec.append(
    switchRow('Colour code by its language', syntax.byLanguage, 'Off, every language uses the shared colours.', 'by_language'),
    switchRow('Its colour on its name', syntax.accent, 'The language’s own colour on a fence’s word in Source and on the kind in the head, never on its code.', 'accent'),
  );

  const { tokens, floor } = groundsNow();
  const lowest = (hex: string): number => {
    const c = hexToRgb(hex);
    return c ? Math.min(...tokens.map((g) => contrastRatio(c, g))) : 0;
  };
  for (const [lang, palette] of Object.entries(LANG_PALETTES)) {
    const yours = syntax.langs[lang] ?? {};
    const mine = Object.keys(yours).length;
    const colours = ROLES.map(({ role }) => {
      const set = (yours as Record<string, string | undefined>)[role];
      const drawn = drawnColour(lang, role);
      return { role, hex: set ?? (drawn ? rgbToHex(drawn) : '#808080'), yours: set !== undefined };
    });
    const row = el('button', `marxy-ditem marxy-langrow${open === lang ? ' marxy-on' : ''}`);
    row.type = 'button';
    row.dataset.marxyLangRow = lang;
    row.setAttribute('aria-expanded', String(open === lang));
    const sws = el('span', 'marxy-langsw');
    for (const c of colours) {
      const i = el('i');
      i.style.background = c.hex;
      sws.append(i);
    }
    row.append(el('span', 'marxy-ditem-name', palette.name), sws, el('span', 'marxy-ditem-sub', mine ? `${mine} yours` : 'its own'));
    row.addEventListener('click', () => {
      open = open === lang ? null : lang;
      redraw();
    });
    sec.append(row);
    if (open !== lang) continue;
    for (const c of colours) {
      const label = LABEL_FOR[lang]?.[c.role] ?? ROLES.find((r) => r.role === c.role)!.label;
      const ctl = el('label', 'marxy-ctl marxy-colour');
      ctl.dataset.marxyLangRole = `${lang}:${c.role}`;
      const input = el('input', 'marxy-colour-input');
      input.type = 'color';
      input.value = c.hex;
      input.setAttribute('aria-label', `${palette.name} ${label}`);
      const hex = el('span', 'marxy-ctl-v', `${c.hex}${c.yours ? ' · yours' : ''}`);
      const pick = el('span', 'marxy-colour-pick');
      pick.append(input, hex);
      const r = lowest(c.hex);
      const low = r < floor;
      const note = el('span', `marxy-ctl-d${low ? ' marxy-colour-low' : ''}`, `${r.toFixed(1)} : 1 on the page and a code block${low ? ` · below ${floor} : 1, which the validator asks` : ''}`);
      ctl.append(el('span', 'marxy-ctl-k', label), pick, note);
      input.addEventListener('input', () => {
        hex.textContent = input.value;
      });
      input.addEventListener('change', () => {
        void write(handle, (b) => setTableKey(b, ['syntax', lang], c.role, JSON.stringify(input.value.toLowerCase()))).then(redraw);
      });
      sec.append(ctl);
    }
    if (mine > 0) {
      const back = el('button', 'marxy-btn', `Back to ${palette.name}’s own`);
      back.type = 'button';
      back.addEventListener('click', () => {
        void write(handle, (b) => Object.keys(yours).reduce((acc, role) => removeTableKey(acc, ['syntax', lang], role), b)).then(redraw);
      });
      const brow = el('div', 'marxy-brow');
      brow.append(back);
      sec.append(brow);
    }
  }
  sec.append(el('p', 'marxy-dnote', `Other languages use the shared colours. Each colour here is solved for this look to ${floor} : 1; yours go in config.toml, one line each.`));
  return sec;
}
