// Source gutter toggle and jump-to-source palette commands (MARXY-239).
import type { AppContext, Command } from './registry.ts';
import type { AppShell } from '../app.ts';
import { writeReaderKey } from '../theme/reader-config.ts';
import { resolveLineNumbers, setLineNumbersChoice } from '../source/line-numbers.ts';
import { appHandle } from './app-handle.ts';
import { depthFoldOffered } from '../source/depth-fold-gate.ts';

function byteAttr(el: Element | null | undefined): number | null {
  const s = el?.getAttribute('data-marxy-s');
  return s === null || s === undefined ? null : Number(s);
}

function clickedBlockByte(): number | null {
  return byteAttr(appHandle()?.selection.lastPointerCarrier());
}

function selectionStartByte(ctx: AppContext): number | null {
  if (ctx.document) {
    const sel = ctx.selection;
    if (sel.kind === 'node' && sel.el instanceof Element) {
      const s = byteAttr(sel.el.closest('[data-marxy-s]'));
      if (s !== null) return s;
    }
    if (sel.kind === 'section') return sel.range.start;
    if (sel.kind === 'text') {
      const anchor = window.getSelection()?.anchorNode ?? null;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
      const s = byteAttr(el?.closest('[data-marxy-s]') ?? null);
      if (s !== null) return s;
    }
  }
  // A click still names a block when the selection model does not (MARXY-239).
  return clickedBlockByte();
}

/** The depth lens is offered for a JSON or YAML file shown in Source that gets folding (K-10a): never for TOML or a large file. */
function depthLensOffered(ctx: AppContext): boolean {
  if (document.body.dataset.marxyMode !== 'source') return false;
  const buffer = ctx.document?.snapshot().buffer;
  return buffer !== undefined && depthFoldOffered(buffer.path, buffer.bytes.length);
}

/**
 * Fold the focused Source editor to `depth`, or open every fold (`depth` null). A view only: nothing here writes the
 * buffer, and a fold is not remembered. A refusal says what happened, what is unchanged and what to do (X-21, Q10).
 */
async function runDepthLens(ctx: AppContext, depth: number | null): Promise<void> {
  const what = depth === null ? 'unfold' : `fold to depth ${depth}`;
  const { activeSourceEditor } = await import('../source/editor.ts');
  const editor = activeSourceEditor();
  if (!editor) {
    ctx.showNotice(`Could not ${what} · nothing changed · switch to Source and try again`, { kind: 'refused' });
    return;
  }
  const lens = await import('../source/depth-fold.ts');
  if (depth === null) {
    if (lens.unfoldEverything(editor.view) === 0) ctx.showNotice('Nothing is folded · the file is unchanged', { kind: 'info', fades: true });
    return;
  }
  await lens.languageReady(editor.view);
  const result = lens.foldToDepth(editor.view, depth);
  if (result.kind === 'unready') {
    const why = result.why === 'tree' ? 'the file is still being read' : 'the file has not been read for structure yet';
    ctx.showNotice(`Could not ${what} · ${why}; the file and its folds are unchanged · try again in a moment`, { kind: 'refused' });
  } else if (result.kind === 'nothing') {
    ctx.showNotice(`Nothing folds at depth ${depth} · the file is not nested that deep · try a lower depth`, { kind: 'info', fades: true });
  }
}

/** *Fold to depth* 1 to 4 and *Unfold all*: palette only, no keys until the menu bar checks conflicts (K-10a, question 2). */
function depthLensCommands(): readonly Command[] {
  const levels = [1, 2, 3, 4] as const;
  return [
    ...levels.map(
      (depth): Command => ({
        id: `source.fold-depth-${depth}`,
        title: `Fold to depth ${depth}`,
        group: 'view',
        when: depthLensOffered,
        run: (ctx) => runDepthLens(ctx, depth),
      }),
    ),
    { id: 'source.unfold-all', title: 'Unfold all', group: 'view', when: depthLensOffered, run: (ctx) => runDepthLens(ctx, null) },
  ];
}

export function sourceViewCommands(): readonly Command[] {
  return [
    ...depthLensCommands(),
    {
      id: 'view.toggle-line-numbers',
      title: 'Toggle line numbers in Source',
      group: 'view',
      when: (ctx) => document.body.dataset.marxyMode === 'source' || ctx.document !== null,
      run: async (ctx) => {
        // The preference only; the app owns the Source editor and makes it (F-03, F-12). One that is
        // mounted is reconfigured now; with none, the next Source entry reads the recorded choice.
        const { activeSourceEditor } = await import('../source/editor.ts');
        const editor = activeSourceEditor();
        const current = editor
          ? Boolean(editor.view.dom.querySelector('.cm-lineNumbers'))
          : resolveLineNumbers(appHandle()?.currentPath() ?? '');
        const next = !current;
        if (editor) editor.setLineNumbers(next);
        else setLineNumbersChoice(next);
        const shell = appHandle()?.shell as AppShell | undefined;
        if (!shell) return;
        try {
          await writeReaderKey(shell, 'line_numbers', String(next));
        } catch (e) {
          ctx.showNotice(`config.toml could not be updated: ${e instanceof Error ? e.message : String(e)}; this choice lasts until you quit`, { kind: 'error' });
        }
      },
    },
    {
      id: 'view.jump-to-source',
      title: 'Jump to source',
      group: 'view',
      when: (ctx) => selectionStartByte(ctx) !== null,
      run: async (ctx) => {
        const byte = selectionStartByte(ctx);
        // Source opens only through the running app, so what is typed there is the document's (F-03).
        const app = appHandle();
        if (byte === null || !app) return;
        await app.jumpToSource(byte);
      },
    },
  ];
}
