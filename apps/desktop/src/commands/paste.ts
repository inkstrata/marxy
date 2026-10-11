// Paste as commands over `shell-api` (J-05, ADR-0065 §3), not the webview's `paste` event. `Mod+V` in Rendered reads the
// pasteboard on that key and opens it as Markdown in a new scratch document (E-13). In Source, `Mod+V` is the editor's: the
// `paste` handler in `source/paste.ts` takes a paste that carries HTML, and any other is the editor's own. `Mod+Alt+Shift+V`
// (Paste and Match Style) inserts the plain text unconverted. Nothing here reads the pasteboard until a key or a command runs.
import { openScratch } from '../document/scratch.ts';
import {
  CONVERTED_NOTICE,
  NOTHING_TO_PASTE,
  pasteShellOf,
  readConverted,
} from '../paste/read-clipboard.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

/** Whether the focused pane shows Source: the editor's own paste applies there. */
function inSourceMode(): boolean {
  const panes = appHandle()?.panes?.();
  if (panes) return panes.focused.view.mode === 'source';
  return document.body.dataset.marxyMode === 'source';
}

/** The summoned palette is modal: while it is open, no key of the page's is the page's. */
export function paletteIsOpen(): boolean {
  const dialog = document.getElementById('marxy-palette');
  return dialog instanceof HTMLDialogElement && dialog.open;
}

/**
 * A text field of the app's own that keeps its keys: the find field (Rendered's input, Source's panel). The
 * palette's input is not counted here because the palette lists commands while it has focus; a `global`
 * command whose chord the palette must not take refuses in `run` while `paletteIsOpen()` instead. A dismissed
 * palette's input keeps focus inside a closed dialog and is not a text field.
 */
export function inFindField(): boolean {
  const active = document.activeElement;
  if (!(active instanceof Element)) return false;
  if (active.closest('.cm-panels') !== null) return true;
  if (active.closest('#marxy-palette') !== null) return false;
  return active.closest('input, textarea, select') !== null;
}

export function pasteCommands(): readonly Command[] {
  return [
    {
      id: 'paste.rendered',
      title: 'Paste as a new Markdown document',
      // Not `global`: a text field (the find field, the palette) and Source's editor keep their own paste.
      key: 'Mod+V',
      group: 'document',
      when: () => !inSourceMode(),
      async run(ctx) {
        const shell = pasteShellOf(ctx.shell);
        if (!shell) return ctx.showNotice('Not pasted: this window has no clipboard access.');
        const got = await readConverted(shell);
        if (got.refused !== undefined) return ctx.showNotice(got.refused);
        const { converted } = got;
        if (converted.markdown === '') return ctx.showNotice(NOTHING_TO_PASTE, { transient: true });
        const opened = await openScratch(converted.markdown, { label: 'Pasted' });
        if (opened && converted.kind === 'html') ctx.showNotice(CONVERTED_NOTICE, { transient: true });
      },
    },
    {
      id: 'source.paste-plain',
      title: 'Paste as plain text',
      key: 'Mod+Alt+Shift+V',
      // Global so the registry route works from the editor too; the editor's own handler answers the chord
      // first by physical key (a Mac's Option rewrites `event.key`) and stops it.
      global: true,
      group: 'selection',
      when: () => inSourceMode() && !inFindField(),
      async run(ctx) {
        // Run from a key while the palette is open: the palette's field keeps its keys. From the palette, it closed first.
        if (paletteIsOpen()) return;
        const shell = pasteShellOf(ctx.shell);
        const { activeSourceEditor } = await import('../source/editor.ts');
        const { pastePlainText } = await import('../source/paste.ts');
        const editor = activeSourceEditor();
        if (!editor) return;
        if (!shell) return ctx.showNotice('Not pasted: this window has no clipboard access.');
        editor.view.focus();
        await pastePlainText(editor.view, shell);
      },
    },
  ];
}
