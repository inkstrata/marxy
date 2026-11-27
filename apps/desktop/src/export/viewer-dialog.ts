// Export for a page of the app's own that offers it (a PDF: the file as it is, its text, its text as Markdown; lab pass
// 20's "PDF · Export"): the same dialog as a document's, its choices the viewer's. Saved through the system's save
// dialog; the file itself is never written, and an open file is never written over.
import { basename, dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { closeButton, el, returnFocus } from '../frame/dom.ts';
import { notify } from '../notices/index.ts';
import type { PaneViewer, ViewerExport } from '../viewers/types.ts';
import { exportName } from './build.ts';

/** What the focused pane's viewer offers Export, or none (Export is then the text views'). */
export function viewerExports(handle: AppHandle): readonly ViewerExport[] {
  const pane = handle.panes().focused;
  const viewer: PaneViewer | null = pane.view.viewer();
  if (!viewer?.owns(pane.view.mode)) return [];
  return viewer.exports?.(pane.view.mode) ?? [];
}

export function openViewerExport(handle: AppHandle, path: string, offered: readonly ViewerExport[]): void {
  const name = basename(path);
  let chosen = offered[0]!;
  let built: { id: string; out: Promise<{ bytes: Uint8Array; preview: string }> } | null = null;
  const out = (): Promise<{ bytes: Uint8Array; preview: string }> => {
    if (built?.id !== chosen.id) built = { id: chosen.id, out: chosen.build() };
    return built.out;
  };

  const scrim = el('div', 'marxy-export-scrim');
  const box = el('div', 'marxy-export');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `Export ${name}`);
  const head = el('div', 'marxy-export-head');
  const size = el('span', 'marxy-export-size');
  const close = closeButton('Close', { className: 'marxy-export-close' });
  head.append(el('h2', '', `Export ${name}`), size, close);
  const side = el('div', 'marxy-export-side');
  const preview = el('div', 'marxy-export-preview');
  const pre = el('pre', 'marxy-export-pre');
  preview.append(el('p', 'marxy-dlab', 'What it will write'), pre);
  const foot = el('div', 'marxy-export-foot');
  const note = el('p', 'marxy-export-note');
  const go = el('button', 'marxy-export-go', 'Save…');
  go.type = 'button';
  foot.append(note, go);
  const body = el('div', 'marxy-export-body');
  body.append(side, preview);
  box.append(head, body, foot);
  scrim.append(box);

  const before = document.activeElement as HTMLElement | null;
  const leave = (): void => {
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    returnFocus(before, handle.panes().focused.host);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    leave();
  };

  function draw(): void {
    side.replaceChildren(el('p', 'marxy-dlab', 'As'));
    for (const f of offered) {
      const row = el('label', 'marxy-export-format');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'marxy-export-format';
      radio.checked = f === chosen;
      radio.addEventListener('change', () => {
        chosen = f;
        draw();
      });
      const words = el('span');
      words.append(el('b', '', f.name), el('small', '', f.sub));
      row.append(radio, words);
      side.append(row);
    }
    side.append(el('p', 'marxy-dnote', 'Saved through the system’s save dialog, where you choose. Nothing leaves this computer, and the file itself is not touched.'));
    note.textContent = chosen.sub;
    pre.textContent = 'Reading it…';
    size.textContent = '';
    const asked = chosen;
    void out().then(
      (o) => {
        if (asked !== chosen) return;
        pre.textContent = o.preview;
        size.textContent = `${o.bytes.length.toLocaleString('en-GB')} bytes`;
      },
      (e: unknown) => {
        if (asked === chosen) pre.textContent = `It could not be read: ${e instanceof Error ? e.message : String(e)}`;
      },
    );
  }

  go.addEventListener('click', async () => {
    let o: { bytes: Uint8Array };
    try {
      o = await out();
    } catch (e) {
      notify({ kind: 'error', text: `Could not read ${name} · ${e instanceof Error ? e.message : String(e)} · nothing was written` });
      return;
    }
    const suggested = exportName(name, chosen.extension);
    const target = await handle.shell.saveDialog({ defaultPath: joinPath(dirname(path), suggested) });
    if (target === null) return;
    if (handle.panes().panes.some((p) => p.path() === target)) {
      notify({ kind: 'refused', text: `${basename(target)} is open here · Export never writes over an open file · choose another name` });
      return;
    }
    try {
      await handle.shell.writeFileAtomic(target, o.bytes);
      leave();
      notify({ kind: 'done', text: `Exported ${basename(target)}`, fades: true });
    } catch (e) {
      notify({ kind: 'error', text: `Could not write ${basename(target)} · ${e instanceof Error ? e.message : String(e)} · nothing was written` });
    }
  });
  close.addEventListener('click', leave);
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) leave();
  });
  document.addEventListener('keydown', onKey, true);
  draw();
  document.body.append(scrim);
  side.querySelector<HTMLInputElement>('input:checked')?.focus();
}
