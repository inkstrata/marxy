// Binds registry commands to keyboard chords and builds AppContext (MARXY-42).
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { appHandle } from '../commands/app-handle.ts';
import { commands, type AppContext } from '../commands/index.ts';
import { chordMatches, commandForKey } from '../palette/commands.ts';
import { notify } from '../notices/index.ts';
import { runCopyShortcut } from './apply.ts';
import { operationInputFor } from './input.ts';
import { getSelectionBufferContext } from './view.ts';

export type PaletteCloser = () => void;

let paletteCloser: PaletteCloser = () => {};

export function setPaletteCloser(close: PaletteCloser): void {
  paletteCloser = close;
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

export function keyMatches(event: KeyboardEvent, spec: string): boolean {
  return chordMatches(event, spec, isMac());
}

const NO_SHELL: AppContext['shell'] = { clipboardWrite: async () => {} };

export function buildAppContext(): AppContext {
  const ctx = getSelectionBufferContext();
  // With no document there is no selection runtime: the context is the empty one, so the commands
  // that make sense without a document (and only those) still hold.
  return {
    // AppShell narrows the real shell; clipboardWrite is on every real one.
    shell: ctx?.shell ?? (appHandle()?.shell as AppContext['shell'] | undefined) ?? NO_SHELL,
    selection: ctx ? ctx.state.selection : { kind: 'none' },
    document: appHandle()?.document() ?? null,
    operationInput() {
      return ctx ? operationInputFor(ctx.state.selection, ctx.document, ctx.buffer) : null;
    },
    closePalette: () => paletteCloser(),
    showNotice(text, opts) {
      notify({ kind: 'info', text, transient: opts?.transient });
    },
  };
}

/** Text fields (the palette query, find, Source mode) keep their own copy and editing keys. */
function inEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select') !== null;
}

let keysInstalled = false;

export function installCommandKeys(): void {
  if (keysInstalled || typeof document === 'undefined') return;
  keysInstalled = true;
  document.addEventListener('keydown', (event) => {
    const editable = inEditable(event);
    const appCtx = buildAppContext();
    if (!editable && (event.key === 'c' || event.key === 'C')) {
      if ((isMac() ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const input = appCtx.operationInput();
        const copyApplies =
          input !== null && OPERATIONS.some((op) => op.id.startsWith('copy-') && op.canApply(input));
        if (copyApplies || appCtx.selection.kind === 'text') {
          event.preventDefault();
          void runCopyShortcut(appCtx, OPERATIONS);
          return;
        }
      }
    }
    const cmd = commandForKey(event, commands(), appCtx, { inEditable: editable, mac: isMac() });
    if (!cmd) return;
    event.preventDefault();
    void cmd.run(appCtx);
  });
}
