// Settings, in the drawer: a view of config.toml and nothing more. It keeps no state of its own: every row is
// `settings-schema.ts`'s, the value on a control is what `parseConfig` makes of the file, and a change is written at once as
// one top-level line by the function every key already uses (`writeReaderKey`). A changed row can be reset, which removes its
// line and nothing else. A write is made over the bytes the drawer last showed: a config.toml that is something else now (a
// hand edit, another program) is never overwritten; the write is refused and the drawer shows the file as it is. A hand edit
// shows at once, through a watch on the config folder.
import { CATEGORIES, ConfigNotReadableError, drawnCategories, PROPOSALS, proposalsAfter, readSettings, rowsOf, searchSettings, writeFor, type ChoiceOption, type ProposalId, type SettingRow, type SettingState } from '@marxy/theme';
import type { AppHandle } from '../app.ts';
import { notify as showNotice, type NoticeInput } from '../notices/index.ts';
import { applyAppConfig } from '../theme/app-config.ts';
import { bundledThemeName, themeMeant } from '../theme/bundled-themes.ts';
import { ConfigChangedError, isReaderKey, resetReaderKey, restoreReaderConfig, writeReaderKey, type ReaderKey } from '../theme/reader-config.ts';
import { applyBundledTheme, currentThemeName, inferHomeFromConfig } from '../theme/user-theme.ts';
import { setColumnGuideChoice, setShowWhitespaceChoice } from '../source/view-aids.ts';
import { setLineNumbersChoice } from '../source/line-numbers.ts';
import { versionRecorder } from '../versions/recorder.ts';
import { LEAVES_THIS_MAC, NOTHING_ELSE, bytesText, pathOf, storedOnThisMac, type StoredFile } from './privacy.ts';
import { partChoiceCount } from '../render/parts.ts';
import { forgetPartReadings } from '../render/readings-file.ts';
import { button as marxyButton } from '../frame/dom.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const dirnameOf = (p: string): string => {
  const cut = p.lastIndexOf('/');
  return cut > 0 ? p.slice(0, cut) : cut === 0 ? '/' : p;
};

/** Draws Settings into `host` (the drawer's body); returns what takes it out. */
export function mountSettings(host: HTMLElement, handle: AppHandle, opts: { readonly query?: string } = {}): () => void {
  const shell = handle.shell;

  let root: HTMLElement | null = null;
  let teardown: Array<() => void> = [];

  // The file as the page last showed it: what a write is made over, and what the rows are read from.
  let bytes: Uint8Array = new Uint8Array();
  let exists = false;
  let configPath = '';
  let read = readSettings(bytes);
  let query = '';
  let stored: readonly StoredFile[] | null = null;
  let confirmClear = false;

  // The parts that are built once.
  let field: HTMLInputElement;
  let countEl: HTMLElement;
  let paneEl: HTMLElement;

  const say = (input: NoticeInput): void => {
    showNotice(input);
  };

  // ---- the file --------------------------------------------------------------------------------------------------------

  async function readConfig(): Promise<{ readonly bytes: Uint8Array; readonly exists: boolean }> {
    if (shell.configPaths === undefined) return { bytes: new Uint8Array(), exists: false };
    configPath = (await shell.configPaths()).config;
    try {
      // A look, not a read the stale-write guard counts as seen: every write reads for itself.
      return { bytes: await (shell.peekFile ?? shell.readFile)(configPath), exists: true };
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'not-found') return { bytes: new Uint8Array(), exists: false };
      throw e;
    }
  }

  /** Takes `next` as the file now: the rows are read from it and drawn; `apply` puts it on the page as a hand edit would be. */
  function adopt(next: Uint8Array, opts: { readonly apply: boolean; readonly exists?: boolean }): void {
    const before = read.config;
    bytes = next;
    if (opts.exists !== undefined) exists = opts.exists;
    read = readSettings(next, { home: configPath === '' ? undefined : inferHomeFromConfig(configPath) });
    if (root) render();
    if (opts.apply) void applyLive(before, read.config);
  }

  /** The page as the file now says it: the same application the launch gives (`applyAppConfig`), the Source aids, the theme. */
  async function applyLive(before: typeof read.config, now: typeof read.config): Promise<void> {
    applyAppConfig(document.documentElement, now);
    // A key that is absent speaks for nothing: the file's kind decides (the choices are `null`), whatever was chosen before.
    setLineNumbersChoice(now.lineNumbers ?? null);
    setShowWhitespaceChoice(now.showWhitespace ?? null);
    setColumnGuideChoice(now.columnGuide ?? null);
    try {
      const source = await import('../source/editor.ts');
      const editor = source.activeSourceEditor();
      if (editor) {
        const { resolveLineNumbers } = await import('../source/line-numbers.ts');
        const { resolveShowWhitespace } = await import('../source/view-aids.ts');
        editor.setLineNumbers(resolveLineNumbers(editor.buffer.path));
        // `setLineNumbers` records its argument as a choice; only the file's own word is one.
        setLineNumbersChoice(now.lineNumbers ?? null);
        source.setShowWhitespaceInView(editor.view, resolveShowWhitespace());
        await source.refreshColumnGuide(editor.view, editor.buffer.path);
      }
    } catch {
      /* no Source editor mounted: the next Source entry reads the choices */
    }
    // A theme the file names that is bundled (or none): apply it. A theme folder is the launch's business (user-theme.ts).
    const named = themeMeant(now.theme);
    let themeMoved = false;
    if (named !== null && currentThemeName() !== named) {
      await applyBundledTheme(named);
      themeMoved = true;
    }
    const layoutMoved = themeMoved || before.size !== now.size || before.variant !== now.variant || before.typeset !== now.typeset || before.measure !== now.measure || before.chromeSize !== now.chromeSize;
    if (layoutMoved) await handle.relayout();
  }

  /**
   * Writes `change` for `row` over the bytes the page showed. Resolves true when the file was changed. A file that is not those bytes
   * is refused: the page takes the file as it is, applies it, and says the change was not made.
   */
  async function commit(row: SettingRow, change: { readonly toml: string } | { readonly remove: true }, undoable = false): Promise<boolean> {
    if (!isReaderKey(row.key) || shell.configPaths === undefined) return false;
    // A file that is not TOML is never written to, from any category: the page says so once, and the control stays where the file says.
    if (read.unparseable) {
      sayUnreadable();
      render();
      return false;
    }
    const key: ReaderKey = row.key;
    // What the write is over is read when it runs (the writes queue): a change right behind another is over what the first left.
    let prior: Uint8Array = bytes;
    const priorExists = exists;
    const over = (): Uint8Array => (prior = bytes);
    try {
      const next = 'remove' in change ? await resetReaderKey(shell, key, { expected: over }) : await writeReaderKey(shell, key, change.toml, { expected: over });
      if (next === null) return false;
      adopt(next, { apply: true, exists: priorExists || !sameBytes(next, prior) });
      if (undoable && !sameBytes(next, prior)) {
        say({
          kind: 'done',
          text: `Reset ${row.label} to ${row.defaultLabel}`,
          actions: [{ label: 'Undo', onClick: () => void undo(prior, next, row) }],
        });
      }
      return true;
    } catch (e) {
      if (e instanceof ConfigChangedError) {
        adopt(e.current, { apply: true, exists: true });
        say({
          kind: 'refused',
          text: `config.toml changed on disk since this page showed it, so ${row.label} was not changed. The page now shows the file as it is; change it again if you still want to.`,
        });
      } else if (e instanceof ConfigNotReadableError) {
        // The file as it is now does not read (or this edit would not leave it so): shown as it is, never repaired.
        adopt(bytes, { apply: false });
        say({ kind: 'refused', text: `${e.message}. Nothing was changed, and the file was not repaired.` });
      } else {
        say({ kind: 'error', text: `config.toml could not be updated · ${e instanceof Error ? e.message : String(e)} · Nothing was changed.` });
      }
      return false;
    }
  }

  /** One notice, for every attempt: the file does not read, so nothing will be written until it is fixed. */
  function sayUnreadable(): void {
    say({
      kind: 'refused',
      text: 'config.toml cannot be read (it is not valid TOML), so no setting can be changed here until it is fixed. Nothing will be written, and Marxy will not repair it; Advanced opens it in Source.',
    });
  }

  async function undo(prior: Uint8Array, after: Uint8Array, row: SettingRow): Promise<void> {
    try {
      const next = await restoreReaderConfig(shell, prior, { expected: after });
      if (next !== null) {
        adopt(next, { apply: true });
        say({ kind: 'done', text: `${row.label} is back to what it was` });
      }
    } catch (e) {
      if (e instanceof ConfigChangedError) {
        adopt(e.current, { apply: true, exists: true });
        say({ kind: 'refused', text: 'config.toml changed on disk since the reset, so it was not put back. The page shows the file as it is.' });
      } else say({ kind: 'error', text: `config.toml could not be updated · ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function change(row: SettingRow, input: string | boolean | number): Promise<void> {
    if (row.key === 'theme') return changeTheme(row, String(input));
    const w = writeFor(row, input);
    if (w === null) return;
    await commit(row, w);
  }

  /** A theme: the file first (so a refused write changes nothing), then the sheet; a folder it replaces is said, with the way back. */
  async function changeTheme(row: SettingRow, value: string): Promise<void> {
    const w = writeFor(row, value);
    if (w === null) return;
    const replaced = read.config.theme?.trim() ?? '';
    const named = replaced !== '' && bundledThemeName(replaced) === null ? replaced : null;
    if (await commit(row, w) && named !== null) {
      say({ kind: 'done', text: `Theme changed. config.toml no longer names the theme folder ${named}; the folder is untouched. To use it again, set theme = "${named}" in config.toml.` });
    }
  }

  async function reset(state: SettingState): Promise<void> {
    await commit(state.row, { remove: true }, true);
  }

  /** One proposal switched: the `proposals` line is written again naming only those that differ from their defaults, or taken out. */
  async function changeProposal(id: ProposalId, on: boolean): Promise<void> {
    const row = rowsOf('proposals')[0];
    if (!row) return;
    const toml = proposalsAfter(read.config.proposalsNamed, id, on);
    await commit(row, toml === null ? { remove: true } : { toml });
  }

  async function reloadFromDisk(): Promise<void> {
    if (!root) return;
    try {
      const now = await readConfig();
      if (sameBytes(now.bytes, bytes) && now.exists === exists) return;
      adopt(now.bytes, { apply: true, exists: now.exists });
      say({ kind: 'info', text: 'config.toml changed on disk; the page shows it as it is now.', transient: true });
    } catch {
      /* unreadable now: the page keeps what it showed, and a write would read the file again and say */
    }
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------------

  const configName = (): string => configPath.split('/').pop() || 'config.toml';
  const stateOf = (row: SettingRow): SettingState => read.states.find((s) => s.row.key === row.key)!;
  const changedCount = (rows?: readonly SettingRow[]): number => read.states.filter((s) => s.changed && (rows === undefined || rows.includes(s.row))).length;

  function render(): void {
    if (!root) return;
    const focusedKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-marxy-setting]')?.dataset.marxySetting;
    const focusedControl = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.marxyControl : undefined;
    drawPane();
    const n = changedCount();
    countEl.textContent = n === 0 ? `${configName()} \u00b7 nothing changed` : `${configName()} \u00b7 ${plural(n, 'setting', 'settings')} changed`;
    if (focusedKey !== undefined && paneEl.contains(document.activeElement) === false) {
      const target = paneEl.querySelector<HTMLElement>(`[data-marxy-setting="${focusedKey}"] ${focusedControl ? `[data-marxy-control="${focusedControl}"]` : '[data-marxy-control]'}`);
      target?.focus();
    }
  }

  function unreadableWarning(): HTMLElement {
    return el('p', 'marxy-settings-warning', 'config.toml is not valid TOML, so the page shows the defaults and no change can be made here until the file is fixed. Marxy never repairs it; Advanced opens it in Source.');
  }

  function drawPane(): void {
    paneEl.replaceChildren();
    if (read.unparseable) paneEl.append(unreadableWarning());
    if (query.trim() !== '') {
      const hits = searchSettings(query).filter((h) => h.row.category !== 'proposals');
      const proposals = proposalRows(query);
      if (hits.length === 0 && proposals.length === 0) {
        paneEl.append(el('p', 'marxy-dnote', `No setting matches “${query.trim()}”. Try one word, or the name of a key of config.toml.`));
        return;
      }
      for (const c of drawnCategories()) {
        if (c.id === 'proposals') {
          if (proposals.length > 0) paneEl.append(group(c.title, proposals));
          continue;
        }
        const inCategory = hits.filter((h) => h.row.category === c.id);
        if (inCategory.length > 0) paneEl.append(group(c.title, inCategory.map((h) => buildRow(stateOf(h.row), h.via))));
      }
      return;
    }
    for (const c of CATEGORIES) {
      const rows = rowsOf(c.id);
      const parts = c.id === 'proposals' ? proposalRows('') : rows.map((r) => buildRow(stateOf(r)));
      if (c.id === 'privacy') parts.push(privacyPanel());
      if (c.id === 'advanced') parts.push(advancedPanel());
      if (parts.length > 0) paneEl.append(group(c.title, parts));
    }
  }

  function group(title: string, rows: HTMLElement[]): HTMLElement {
    const section = el('section', 'marxy-dsec marxy-settings-group');
    const head = el('div', 'marxy-dlab');
    head.append(el('span', '', title));
    section.append(head, ...rows);
    return section;
  }

  function buildRow(state: SettingState, via?: string): HTMLElement {
    const { row } = state;
    const id = `marxy-setting-${row.key}`;
    const r = el('div', 'marxy-setting');
    r.dataset.marxySetting = row.key;
    if (state.changed) r.dataset.marxyChanged = 'true';
    if (state.disabled !== null) r.dataset.marxyDisabled = 'true';
    // A control that wants room (a slider, a row of choices) sits under the words; a switch, a menu and a field sit beside them.
    if (row.control.kind === 'range' || row.control.kind === 'text' || (row.control.kind === 'choice' && row.control.options.length <= 4)) r.dataset.marxyWide = 'true';

    // The dot: a changed value carries it; it is a button, and clicking it resets the key. Never colour alone: it has a name and a title.
    const dotCell = el('div', 'marxy-setting-dot-cell');
    if (state.changed) {
      const dot = el('button', 'marxy-setting-dot');
      dot.type = 'button';
      dot.dataset.marxyDot = row.key;
      const said = `Reset ${row.label} to its default, ${row.defaultLabel}`;
      dot.setAttribute('aria-label', said);
      dot.title = said;
      dot.append(el('span', 'marxy-setting-dot-mark'));
      dot.addEventListener('click', () => void reset(state));
      dotCell.append(dot);
    }

    const text = el('div', 'marxy-setting-text');
    const label = el('label', 'marxy-setting-label', row.label);
    label.htmlFor = id;
    const describedBy: string[] = [];
    const desc = el('p', 'marxy-setting-desc', row.description);
    desc.id = `${id}-desc`;
    describedBy.push(desc.id);
    text.append(label, desc);
    const meta = el('p', 'marxy-setting-meta');
    meta.append(el('code', 'marxy-setting-key', row.key));
    const bits: string[] = [];
    if (row.resettable) bits.push(state.changed ? `Changed · default: ${row.defaultLabel}` : `Default: ${row.defaultLabel}`);
    if (state.invalid) bits.push('the file’s value is not one this key takes, so the default is in force');
    if (via === 'key' || via === 'words') bits.push(via === 'key' ? `Matches the key ${row.key}` : 'Matches a word of its name');
    meta.append(document.createTextNode(bits.length ? ` · ${bits.join(' · ')}` : ''));
    text.append(meta);
    if (row.coupling?.note !== undefined) {
      const note = el('p', 'marxy-setting-note', row.coupling.note);
      note.id = `${id}-note`;
      describedBy.push(note.id);
      text.append(note);
    }
    if (state.disabled !== null) {
      const why = el('p', 'marxy-setting-why', state.disabled);
      why.id = `${id}-why`;
      describedBy.push(why.id);
      text.append(why);
    }

    const control = el('div', 'marxy-setting-control');
    control.append(buildControl(state, id, describedBy.join(' ')));
    r.append(dotCell, text, control);
    return r;
  }

  /** A row per proposal that `q` names (by its name, its words or its key; every one for an empty query or "proposals"). */
  function proposalRows(q: string): HTMLElement[] {
    const words = q.trim().toLowerCase();
    const shown = PROPOSALS.filter((p) => words === '' || 'proposals'.startsWith(words) || p.name.toLowerCase().includes(words) || p.description.toLowerCase().includes(words) || p.id.includes(words.replace(/ /g, '_')));
    return shown.map((p) => {
      const key = `proposals.${p.id}`;
      const id = `marxy-setting-proposal-${p.id}`;
      const on = read.config.proposals[p.id];
      const changed = on !== p.default;
      const r = el('div', 'marxy-setting');
      r.dataset.marxySetting = key;
      if (changed) r.dataset.marxyChanged = 'true';
      const dotCell = el('div', 'marxy-setting-dot-cell');
      const defaultLabel = p.default ? 'On' : 'Off';
      if (changed) {
        const dot = el('button', 'marxy-setting-dot');
        dot.type = 'button';
        const said = `Reset ${p.name} to its default, ${defaultLabel}`;
        dot.setAttribute('aria-label', said);
        dot.title = said;
        dot.append(el('span', 'marxy-setting-dot-mark'));
        dot.addEventListener('click', () => void changeProposal(p.id, p.default));
        dotCell.append(dot);
      }
      const text = el('div', 'marxy-setting-text');
      const label = el('label', 'marxy-setting-label', p.name);
      label.htmlFor = id;
      const desc = el('p', 'marxy-setting-desc', p.description);
      desc.id = `${id}-desc`;
      const meta = el('p', 'marxy-setting-meta');
      meta.append(el('code', 'marxy-setting-key', key), document.createTextNode(` · ${changed ? `Changed · default: ${defaultLabel}` : `Default: ${defaultLabel}`}`));
      text.append(label, desc, meta);
      const input = el('input', 'marxy-settings-switch');
      input.type = 'checkbox';
      input.id = id;
      input.setAttribute('role', 'switch');
      input.setAttribute('aria-describedby', desc.id);
      input.dataset.marxyControl = key;
      input.checked = on;
      input.addEventListener('change', () => void changeProposal(p.id, input.checked));
      const control = el('div', 'marxy-setting-control');
      control.append(input);
      r.append(dotCell, text, control);
      return r;
    });
  }

  function buildControl(state: SettingState, id: string, describedBy: string): HTMLElement {
    const { row, value } = state;
    const disabled = state.disabled !== null;
    const c = row.control;
    const mark = <T extends HTMLElement>(node: T): T => {
      node.dataset.marxyControl = row.key;
      if (describedBy !== '') node.setAttribute('aria-describedby', describedBy);
      return node;
    };
    if (c.kind === 'toggle') {
      const input = mark(el('input', 'marxy-settings-switch'));
      input.type = 'checkbox';
      input.id = id;
      input.setAttribute('role', 'switch');
      input.checked = value === true;
      input.disabled = disabled;
      input.addEventListener('change', () => void change(row, input.checked));
      return input;
    }
    if (c.kind === 'choice') {
      const current = value === null ? '' : String(value);
      // The option the file's value is: the unset option stands for the default, which an absent key means.
      const isSelected = (o: ChoiceOption): boolean => (o.unset ? (row.default === null ? value === null : current === String(row.default)) : o.value === current);
      const options: Array<ChoiceOption & { readonly orphan?: true }> = [...c.options];
      // A value in force that no option names (a theme folder; a value from another Marxy): shown as it is, never silently replaced.
      if (value !== null && !options.some(isSelected)) options.push({ value: current, label: row.key === 'theme' ? `Folder ${current}` : current, orphan: true });
      if (options.length > 4) {
        const select = mark(el('select', 'marxy-settings-select'));
        select.id = id;
        select.disabled = disabled;
        for (const o of options) {
          const option = el('option', undefined, o.label);
          option.value = o.value;
          option.selected = o.orphan === true || isSelected(o);
          option.disabled = o.orphan === true;
          select.append(option);
        }
        select.addEventListener('change', () => void change(row, select.value));
        return select;
      }
      const group = mark(el('div', 'marxy-settings-segmented'));
      group.id = id;
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', row.label);
      options.forEach((o, i) => {
        const labelEl = el('label', 'marxy-settings-segment');
        const input = el('input');
        input.type = 'radio';
        input.name = id;
        input.value = o.value;
        input.checked = o.orphan === true || isSelected(o);
        input.disabled = disabled || o.orphan === true;
        if (i === 0) input.dataset.marxyControl = row.key;
        input.addEventListener('change', () => {
          if (input.checked) void change(row, o.value);
        });
        labelEl.append(input, el('span', 'marxy-settings-segment-label', o.label));
        group.append(labelEl);
      });
      return group;
    }
    if (c.kind === 'range') {
      const wrap = el('div', 'marxy-settings-range');
      const fallback = typeof row.default === 'number' ? row.default : Math.round((c.min + c.max) / 2);
      const input = mark(el('input', 'marxy-settings-slider'));
      input.type = 'range';
      input.id = id;
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = String(c.step);
      input.value = String(typeof value === 'number' ? value : 13 >= c.min && 13 <= c.max && row.default === null ? 13 : fallback);
      input.disabled = disabled;
      const out = el('output', 'marxy-settings-range-value', typeof value === 'number' ? `${value} ${c.unit}` : row.defaultLabel);
      out.htmlFor = id;
      input.addEventListener('input', () => {
        out.textContent = `${input.value} ${c.unit}`;
      });
      input.addEventListener('change', () => void change(row, Number(input.value)));
      wrap.append(input, out);
      return wrap;
    }
    if (c.kind === 'text') {
      const input = mark(el('input', 'marxy-settings-text'));
      input.type = 'text';
      input.id = id;
      input.placeholder = c.placeholder;
      input.value = typeof value === 'string' ? value : '';
      input.disabled = disabled;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.addEventListener('change', () => void change(row, input.value));
      return input;
    }
    // A table: what it holds, and the way to the file.
    const wrap = el('div', 'marxy-settings-table-control');
    const summary =
      row.key === 'kind' ? plural(read.config.kindRules.length, 'rule', 'rules')
      : row.key === 'strip' ? plural(Object.keys(read.config.strip).length, 'kind with its own tools', 'kinds with their own tools')
      : row.key === 'command' ? plural(read.config.commands.length, 'command', 'commands')
      : read.config.linuxWeightOffset === null ? 'Not set' : `weight_offset = ${read.config.linuxWeightOffset}`;
    const out = mark(el('span', 'marxy-settings-table-summary', summary));
    out.id = id;
    out.tabIndex = -1;
    const open = marxyButton('Edit in config.toml');
    open.type = 'button';
    open.addEventListener('click', () => void openConfigInSource());
    open.disabled = !exists;
    wrap.append(out, open);
    return wrap;
  }

  // ---- Privacy -------------------------------------------------------------------------------------------------------------

  async function refreshStored(): Promise<void> {
    try {
      stored = await storedOnThisMac(shell);
    } catch {
      stored = [];
    }
    if (root && query.trim() === '') render();
  }

  function privacyPanel(): HTMLElement {
    const panel = el('div', 'marxy-settings-privacy');
    const files = el('section', 'marxy-settings-group');
    files.dataset.marxyPrivacy = 'stored';
    files.append(el('h3', 'marxy-settings-group-title', 'Stored on this Mac'));
    files.append(el('p', 'marxy-settings-lede', 'Marxy’s own files, plain and apart from your documents. This list is read from the folders now, and nothing here changes them except Forget how parts are read and Clear all versions.'));
    if (stored === null) {
      files.append(el('p', 'marxy-settings-lede', 'Reading the folders…'));
      void refreshStored();
    } else if (stored.length === 0) {
      files.append(el('p', 'marxy-settings-lede', 'This shell keeps no files of Marxy’s.'));
    } else {
      const list = el('ul', 'marxy-settings-stored');
      for (const f of stored) {
        const li = el('li', 'marxy-settings-stored-item');
        li.dataset.marxyStored = f.kind.id;
        const head = el('div', 'marxy-settings-stored-head');
        head.append(el('code', 'marxy-settings-stored-name', f.kind.name));
        const size = f.count === 0 ? 'not written yet' : f.kind.family ? `${f.kind.family.say(f.items)}, ${bytesText(f.bytes)}` : bytesText(f.bytes);
        head.append(el('span', 'marxy-settings-stored-size', size));
        li.append(head, el('p', 'marxy-settings-stored-holds', f.kind.holds));
        const where = el('p', 'marxy-settings-stored-path', pathOf(f));
        where.title = pathOf(f);
        li.append(where);
        if (f.kind.id === 'versions') li.append(clearVersions(f));
        if (f.kind.id === 'readings') li.append(forgetReadings());
        list.append(li);
      }
      files.append(list);
    }
    const leaves = el('section', 'marxy-settings-group');
    leaves.dataset.marxyPrivacy = 'leaves';
    leaves.append(el('h3', 'marxy-settings-group-title', 'What can leave this Mac'));
    leaves.append(el('p', 'marxy-settings-lede', 'Each thing you can do that sends something, and what it sends. Marxy opens no connection of its own, and the page it shows you has no network.'));
    const list = el('ul', 'marxy-settings-leaves');
    for (const l of LEAVES_THIS_MAC) {
      const li = el('li', 'marxy-settings-leave');
      li.dataset.marxyLeave = l.id;
      li.dataset.marxyBuilt = String(l.built);
      const title = el('strong', 'marxy-settings-leave-action', l.action);
      li.append(title);
      if (!l.built) li.append(el('span', 'marxy-settings-leave-status', 'Not built yet'));
      const dl = el('dl', 'marxy-settings-leave-facts');
      dl.append(el('dt', undefined, 'Sends'), el('dd', undefined, l.sends), el('dt', undefined, 'To'), el('dd', undefined, l.to));
      li.append(dl);
      list.append(li);
    }
    leaves.append(list, el('p', 'marxy-settings-nothing-else', NOTHING_ELSE));
    panel.append(files, leaves);
    return panel;
  }

  /** *Clear all versions*: asks first, and says it is permanent. There is no undo: the copies are overwritten with zeros. */
  function clearVersions(f: StoredFile): HTMLElement {
    const box = el('div', 'marxy-settings-clear');
    const recorder = versionRecorder();
    if (confirmClear) {
      box.dataset.marxyConfirm = 'true';
      const ask = el('p', 'marxy-settings-clear-ask', `Clear the versions of ${plural(f.items, 'file', 'files')}, ${bytesText(f.bytes)} in all? This is permanent: the copies are overwritten and cannot be restored. Your documents are not touched.`);
      ask.setAttribute('role', 'alert');
      const row = el('div', 'marxy-settings-clear-actions');
      const cancel = marxyButton('Cancel');
      cancel.type = 'button';
      cancel.dataset.marxyClear = 'cancel';
      cancel.addEventListener('click', () => {
        confirmClear = false;
        render();
        paneEl.querySelector<HTMLElement>('[data-marxy-clear="ask"]')?.focus();
      });
      const go = marxyButton('Clear all versions', { kind: 'danger', className: 'marxy-settings-button-danger' });
      go.type = 'button';
      go.dataset.marxyClear = 'confirm';
      go.addEventListener('click', () => void clearAll());
      row.append(cancel, go);
      box.append(ask, row);
      queueMicrotask(() => cancel.focus());
      return box;
    }
    const button = marxyButton('Clear all versions…');
    button.type = 'button';
    button.dataset.marxyClear = 'ask';
    button.disabled = recorder === null || f.count === 0;
    if (recorder === null) button.title = 'Versions are not running in this window';
    else if (f.count === 0) button.title = 'No versions are kept';
    button.addEventListener('click', () => {
      confirmClear = true;
      render();
    });
    box.append(button);
    return box;
  }

  async function clearAll(): Promise<void> {
    const recorder = versionRecorder();
    confirmClear = false;
    if (!recorder) return render();
    const result = await recorder.clearAll();
    if (result.errors.length > 0) {
      const first = result.errors[0] as { message?: unknown } | undefined;
      say({ kind: 'refused', text: `Some versions could not be cleared · ${String(first?.message ?? first)} · What was cleared stays cleared.` });
    } else {
      say({ kind: 'done', text: result.files === 0 ? 'No versions are kept' : `Cleared ${plural(result.cleared, 'version', 'versions')} of ${plural(result.files, 'file', 'files')}` });
    }
    await refreshStored();
  }

  /** Every part read as guessed again, and readings.json emptied. A choice is made again in a part's block menu. */
  function forgetReadings(): HTMLElement {
    const box = el('div', 'marxy-settings-clear');
    const { files, parts } = partChoiceCount();
    if (parts > 0) box.append(el('p', 'marxy-settings-stored-holds', `${plural(parts, 'part', 'parts')} of ${plural(files, 'file', 'files')} read as you chose.`));
    const button = marxyButton('Forget how parts are read');
    button.type = 'button';
    button.dataset.marxyForget = 'readings';
    button.disabled = parts === 0;
    if (parts === 0) button.title = 'Every part is read as guessed';
    button.addEventListener('click', () => void (async () => {
      const how = await forgetPartReadings();
      say(how === 'newer'
        ? { kind: 'refused', text: 'Every part is read as guessed in this window · readings.json was written by a newer Marxy and is unchanged' }
        : { kind: 'done', text: `Every part is read as guessed again · ${plural(parts, 'choice', 'choices')} forgotten` });
      await refreshStored();
    })());
    box.append(button);
    return box;
  }

  // ---- Advanced ------------------------------------------------------------------------------------------------------------

  function advancedPanel(): HTMLElement {
    const panel = el('section', 'marxy-settings-group marxy-settings-advanced');
    panel.append(el('h3', 'marxy-settings-group-title', 'config.toml'));
    panel.append(el('p', 'marxy-settings-lede', 'This page is a view of one file. Everything it changes is a line of it, and everything else in the file is kept as you wrote it.'));
    const path = el('p', 'marxy-settings-stored-path', configPath === '' ? 'No config folder in this shell' : configPath);
    path.title = configPath;
    panel.append(path);
    const open = marxyButton('Open config.toml in Source');
    open.type = 'button';
    open.dataset.marxyAdvanced = 'open-source';
    open.disabled = !exists;
    if (!exists) open.title = 'config.toml does not exist yet; changing a setting creates it';
    open.addEventListener('click', () => void openConfigInSource());
    panel.append(open);
    if (read.unknownKeys.length > 0) {
      const p = el('p', 'marxy-settings-lede');
      p.append(document.createTextNode('Kept as they are, because Marxy does not know them: '));
      read.unknownKeys.forEach((k, i) => {
        if (i > 0) p.append(document.createTextNode(', '));
        p.append(el('code', undefined, k));
      });
      panel.append(p);
    }
    if (read.warnings.length > 0) {
      const ul = el('ul', 'marxy-settings-warnings');
      for (const w of read.warnings) ul.append(el('li', undefined, w));
      panel.append(el('p', 'marxy-settings-lede', 'What Marxy said about the file when it read it:'), ul);
    }
    return panel;
  }

  async function openConfigInSource(): Promise<void> {
    if (configPath === '' || !exists) return;
    await handle.open(configPath);
    if (document.body.dataset.marxyMode !== 'source') await handle.toggleMode();
  }

  // ---- the build --------------------------------------------------------------------------------------------------------

  function build(): HTMLElement {
    const section = el('div', 'marxy-settings');
    section.setAttribute('data-marxy-settings', '');
    const label = el('label', 'marxy-dfield');
    field = el('input');
    field.type = 'search';
    field.placeholder = 'Find a setting';
    field.title = 'Search by name, by what a setting does, or by its key in config.toml';
    field.setAttribute('aria-label', 'Find a setting');
    field.spellcheck = false;
    field.autocomplete = 'off';
    field.addEventListener('input', () => {
      query = field.value;
      render();
    });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && field.value !== '') {
        event.preventDefault();
        event.stopPropagation();
        field.value = '';
        query = '';
        render();
      } else if ((event.key === 'Enter' && query.trim() !== '') || event.key === 'ArrowDown') {
        event.preventDefault();
        paneEl.querySelector<HTMLElement>('[data-marxy-control]')?.focus();
      }
    });
    label.append(field);
    countEl = el('p', 'marxy-dnote marxy-settings-count');
    countEl.setAttribute('aria-live', 'polite');
    paneEl = el('div', 'marxy-settings-pane');
    paneEl.setAttribute('role', 'region');
    paneEl.setAttribute('aria-label', 'Settings');
    section.append(label, countEl, paneEl);
    return section;
  }

  async function start(): Promise<void> {
    // The file first: nothing is drawn from a guess, and a file that cannot be read is said, not hidden.
    try {
      const now = await readConfig();
      bytes = now.bytes;
      exists = now.exists;
    } catch (e) {
      bytes = new Uint8Array();
      exists = false;
      showNotice({ kind: 'error', text: `config.toml could not be read · ${e instanceof Error ? e.message : String(e)} · Settings shows the defaults.` });
    }
    if (gone) return;
    read = readSettings(bytes, { home: configPath === '' ? undefined : inferHomeFromConfig(configPath) });
    root = build();
    host.append(root);
    query = opts.query ?? '';
    field.value = query;
    render();
    if (read.unparseable) sayUnreadable();
    // A hand edit to config.toml shows at once: a watch on its folder, which also hears the drawer's own writes (the same bytes: nothing to do).
    if (shell.watch !== undefined && configPath !== '') {
      const file = configPath;
      let watching: { close(): void } | null = null;
      let closed = false;
      void shell.watch(dirnameOf(file), (events) => {
        if (events.some((e) => e.path === file || e.to === file)) void reloadFromDisk();
      }).then((h) => {
        if (closed) h.close();
        else watching = h;
      }, () => undefined);
      teardown.push(() => {
        closed = true;
        watching?.close();
      });
    }
  }

  let gone = false;
  void start();
  return () => {
    gone = true;
    for (const off of teardown) off();
    teardown = [];
    root?.remove();
    root = null;
  };
}
