// Structural selection and line operations in the Source editor (V-01): CodeMirror commands over the pure
// functions in `@marxy/core`'s `source-edit/`. Nothing here decides what a block, a section or a join is;
// it reads the editor's text, asks core for a range or a list of splices, and dispatches one transaction, so
// the undo is the editor's and the Source fold (`buffer-commit.ts`) is still the one way a change reaches the
// store. Lazy-loaded with CodeMirror: it stays off the startup path (MARXY-33).

import {
  deleteLines,
  duplicateLines,
  expandSelection,
  joinLines,
  selectBlock,
  selectSection,
  sortLines,
  toggleQuoteLines,
  toggleTaskLines,
  type LineEdit,
  type StructureKind,
  type TextRange,
} from '@marxy/core/src/source-edit/index.ts';
import {
  isolateHistory,
  moveLineDown,
  moveLineUp,
  selectLine,
  toggleComment,
} from '@codemirror/commands';
import type { StructureOp } from './structure-ops.ts';
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { EditorSelection, Transaction, type EditorState, type StateCommand } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';

/** What a command acts on: an editor's state and the way to change it (`EditorView` is one; a test's is another). */
export type Target = Parameters<StateCommand>[0];

export type { StructureOp } from './structure-ops.ts';

const MARKDOWN_PATH = /\.(md|markdown|mdown|mkd|mdx)$/i;

/** Markdown gets blocks and sections from the parse; any other file gets paragraphs and no sections. */
export function structureKindFor(path: string): StructureKind {
  return MARKDOWN_PATH.test(path) ? 'markdown' : 'text';
}

/** The text as the editor counts it: lines joined by one "\n", so an offset in it is a CodeMirror position. */
const textOf = (state: EditorState): string => state.doc.toString();

const mainRange = (state: EditorState): TextRange => ({ from: state.selection.main.from, to: state.selection.main.to });

function select(target: Target, range: TextRange | null): boolean {
  if (!range) return false;
  target.dispatch(
    target.state.update({ selection: EditorSelection.single(range.from, range.to), scrollIntoView: true, userEvent: 'select' }),
  );
  return true;
}

/**
 * The splices as one transaction. A splice's "\n" is written as the file's separator (`state.lineBreak`: CRLF,
 * CR, or LF), because the editor splits an insert on that separator and would keep a bare "\n" as a character.
 * Isolated from the history's grouping, so one operation is one undo step.
 */
function apply(target: Target, edit: LineEdit | null): boolean {
  if (!edit) return false;
  const { state } = target;
  const lineBreak = state.lineBreak;
  target.dispatch(
    state.update({
      changes: edit.changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert.replace(/\n/g, lineBreak) })),
      selection: edit.selection ? EditorSelection.create(edit.selection.map((r) => EditorSelection.range(r.from, r.to))) : undefined,
      scrollIntoView: true,
      userEvent: 'source-edit',
      annotations: isolateHistory.of('full'),
    }),
  );
  return true;
}

const ranges = (state: EditorState): TextRange[] => state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));

/** A command of CodeMirror's own, run so that what it dispatches is one undo step. */
function isolated(command: StateCommand): StateCommand {
  return (target) => {
    let made: Transaction | null = null;
    const ok = command({ state: target.state, dispatch: (tr) => (made = tr) });
    if (!ok || made === null) return false;
    const tr: Transaction = made;
    target.dispatch(
      target.state.update({
        changes: tr.changes,
        selection: tr.selection,
        effects: tr.effects,
        scrollIntoView: true,
        userEvent: tr.annotation(Transaction.userEvent) ?? 'source-edit',
        annotations: isolateHistory.of('full'),
      }),
    );
    return true;
  };
}

/** Run `op` in `target`. False when it had nothing to do (nothing is changed and nothing is said). */
export function runStructure(op: StructureOp, target: Target, path: string): boolean {
  const kind = structureKindFor(path);
  const { state } = target;
  switch (op) {
    case 'selectLine':
      return selectLine(target);
    case 'selectBlock':
      return select(target, selectBlock(textOf(state), mainRange(state), kind));
    case 'selectSection':
      return select(target, selectSection(textOf(state), mainRange(state), kind));
    case 'expandSelection':
      return select(target, expandSelection(textOf(state), mainRange(state), kind));
    case 'selectNextOccurrence':
      return selectNextOccurrence(target);
    case 'selectAllOccurrences':
      return selectSelectionMatches(target);
    case 'moveLineUp':
      return isolated(moveLineUp)(target);
    case 'moveLineDown':
      return isolated(moveLineDown)(target);
    case 'duplicateLineUp':
      return apply(target, duplicateLines(textOf(state), ranges(state), 'up'));
    case 'duplicateLineDown':
      return apply(target, duplicateLines(textOf(state), ranges(state), 'down'));
    case 'deleteLine':
      return apply(target, deleteLines(textOf(state), ranges(state)));
    case 'joinLines':
      return apply(target, joinLines(textOf(state), ranges(state)));
    case 'sortLines':
      return apply(target, sortLines(textOf(state), ranges(state)));
    case 'toggleTask':
      return apply(target, toggleTaskLines(textOf(state), ranges(state)));
    case 'toggleQuote':
      return apply(target, toggleQuoteLines(textOf(state), ranges(state)));
    case 'toggleComment':
      return isolated(toggleComment)(target);
  }
}

/** A registry chord (`Mod+Shift+L`, `Ctrl+Shift+B`) as a canonical string, or null where it cannot match here. */
export function registryChord(spec: string, mac: boolean): string | null {
  const parts = spec.split('+');
  const key = parts.pop()!.toLowerCase();
  const mods = new Set<string>();
  for (const part of parts) {
    if (part === 'Mod') mods.add(mac ? 'meta' : 'ctrl');
    // A literal Control is only a chord of its own on a Mac; elsewhere the registry never matches it.
    else if (part === 'Ctrl') {
      if (!mac) return null;
      mods.add('ctrl');
    } else mods.add(part.toLowerCase());
  }
  return [...[...mods].sort(), key].join('-');
}

/** A CodeMirror key name (`Shift-Mod-k`) in the same canonical form. */
function canonicalCm(name: string, mac: boolean): string {
  const parts = name.split(/-(?!$)/);
  const key = parts.pop()!.toLowerCase();
  const mods = new Set<string>();
  for (const part of parts) {
    const p = part.toLowerCase();
    mods.add(p === 'mod' ? (mac ? 'meta' : 'ctrl') : p === 'cmd' ? 'meta' : p === 'control' ? 'ctrl' : p === 'option' ? 'alt' : p);
  }
  return [...[...mods].sort(), key].join('-');
}

/** Every chord a CodeMirror binding answers on this platform, canonical: its key, and its shift variant if it has one. */
export function keyBindingChords(binding: KeyBinding, mac: boolean): string[] {
  const name = (mac ? binding.mac : binding.linux) ?? binding.key;
  if (name === undefined) return [];
  return binding.shift === undefined ? [canonicalCm(name, mac)] : [canonicalCm(name, mac), canonicalCm(`Shift-${name}`, mac)];
}

/**
 * `bindings` without the chords the command registry owns. A chord is one thing's: where a CodeMirror default
 * sits on a chord the registry binds in Source (`Mod+D`, `Mod+Shift+L`, a Mac's `Ctrl+Shift+Arrow`, and `Mod+/`,
 * the transforms key, which toggle comment does not take), the registry's command runs it and the default is
 * dropped, so a key press never runs both. A binding's shift variant is dropped on its own.
 */
export function withoutRegistryChords(bindings: readonly KeyBinding[], owned: readonly string[], mac: boolean): KeyBinding[] {
  const taken = new Set(owned.map((spec) => registryChord(spec, mac)).filter((c): c is string => c !== null));
  const out: KeyBinding[] = [];
  for (const binding of bindings) {
    const name = (mac ? binding.mac : binding.linux) ?? binding.key;
    if (name === undefined) {
      out.push(binding);
      continue;
    }
    const base = canonicalCm(name, mac);
    const shifted = canonicalCm(`Shift-${name}`, mac);
    const dropBase = taken.has(base);
    const dropShift = binding.shift !== undefined && taken.has(shifted);
    if (!dropBase && !dropShift) {
      out.push(binding);
      continue;
    }
    const { run, shift, ...rest } = binding;
    const kept: KeyBinding = {
      ...rest,
      ...(dropBase || run === undefined ? {} : { run }),
      ...(dropShift || shift === undefined ? {} : { shift }),
    };
    if (kept.run !== undefined || kept.shift !== undefined) out.push(kept);
  }
  return out;
}
