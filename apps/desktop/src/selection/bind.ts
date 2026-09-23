// Binds registry commands to keyboard chords and builds AppContext (MARXY-42).
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { commands, type AppContext } from '../commands/index.ts';
import { notify } from '../notices/index.ts';
import { runCopyShortcut } from './apply.ts';
import { operationInputFor } from './input.ts';
import { getSelectionBufferContext, type SelectionRuntime } from './view.ts';

export type PaletteCloser = () => void;

let paletteCloser: PaletteCloser = () => {};
let runtime: SelectionRuntime | null = null;

export function setSelectionRuntime(next: SelectionRuntime | null): void {
  runtime = next;
}

export function setPaletteCloser(close: PaletteCloser): void {
  paletteCloser = close;
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

export function keyMatches(event: KeyboardEvent, spec: string): boolean {
  const parts = spec.split('+');
  const key = parts[parts.length - 1]!;
  const needMod = parts.includes('Mod');
  const needShift = parts.includes('Shift');
  const needAlt = parts.includes('Alt');
  const mod = isMac() ? event.metaKey : event.ctrlKey;
  if (needMod !== mod) return false;
  if (!needMod && mod) return false;
  if (needShift !== event.shiftKey) return false;
  if (needAlt !== event.altKey) return false;
  return event.key === key;
}

export function buildAppContext(): AppContext | null {
  const ctx = getSelectionBufferContext();
  if (!ctx) return null;
  return {
    shell: ctx.shell,
    selection: ctx.state.selection,
    operationInput() {
      return operationInputFor(ctx.state.selection, ctx.document, ctx.buffer);
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
    if (inEditable(event)) return;
    if (event.key === 'c' || event.key === 'C') {
      if ((isMac() ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const appCtx = buildAppContext();
        if (!appCtx) return;
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
    const appCtx = buildAppContext();
    if (!appCtx) return;
    for (const cmd of commands()) {
      if (!cmd.key || !keyMatches(event, cmd.key)) continue;
      if (!cmd.when(appCtx)) continue;
      event.preventDefault();
      void cmd.run(appCtx);
      return;
    }
  });
}
