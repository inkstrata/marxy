// Clip: take text out. The forms copy the selection, else the whole file, from its bytes; this section and this file
// copy what they say. Nothing here writes to the document.
import { byteToUtf16 } from '@marxy/core';
import { COPY_TARGETS } from '@marxy/core';
import { runTransform } from '@marxy/core/src/transforms/registry.ts';
import { writeCopy } from '../../commands/copy-write.ts';
import { isUntitled } from '../../document/untitled.ts';
import { buildAppContext } from '../../selection/bind.ts';
import { chordText } from '../branch-info.ts';
import { el, plural, section } from '../dom.ts';
import type { BranchContext } from '../../left/host-branch.ts';
import { currentRow, outlineModelFor, type HeadingRow } from '../model/outline.ts';
import { countWords } from '../model/facts.ts';
import { runCommand } from './run.ts';

function row(title: string, sub: string, run: () => void, opts?: { chord?: string; disabled?: boolean }): HTMLButtonElement {
  const b = el('button', 'marxy-ditem');
  b.type = 'button';
  b.append(el('span', 'marxy-ditem-name', title));
  if (opts?.chord) b.append(el('span', 'marxy-ditem-sub', chordText(opts.chord)));
  else if (sub) b.append(el('span', 'marxy-ditem-sub', sub));
  b.disabled = opts?.disabled === true;
  b.addEventListener('click', run);
  return b;
}

export function mount(body: HTMLElement, ctx: BranchContext): () => void {
  const { handle } = ctx;

  /** The section the reading line is in, as a byte range of the file. */
  const sectionHere = (): { heading: HeadingRow; text: string } | null => {
    const store = handle.panes().focused.content.store();
    if (!store || !store.parsed()) return null;
    const snap = store.snapshot();
    const rows = outlineModelFor(snap.ast, snap.buffer).rows.filter((r): r is HeadingRow => r.kind === 'heading');
    const at = currentRow(rows, handle.panes().focused.view.position().byteOffset);
    const heading = rows[at];
    if (!heading) return null;
    const text = snap.buffer.text.slice(byteToUtf16(snap.buffer, heading.start), byteToUtf16(snap.buffer, heading.end));
    return { heading, text };
  };

  function draw(): void {
    body.replaceChildren();
    const pane = handle.panes().focused;
    const store = pane.content.store();
    if (!store) {
      body.append(el('p', 'marxy-dnote', 'Open a file to take text out of it.'));
      return;
    }
    const selection = handle.selection.state().selection;
    const source = pane.view.mode === 'source';
    const what = section(selection.kind === 'none' ? 'The whole file' : 'The selection', source ? 'as Source holds it' : 'from its bytes');
    what.root.append(el('p', 'marxy-dnote', selection.kind === 'none' ? 'Nothing is selected, so a form copies the whole file. Select text or a block first to copy just that.' : 'A form copies the selection.'));
    for (const target of COPY_TARGETS) {
      what.root.append(row(target.name, '', () => void runCommand(handle, `copy-as.${target.id}`)));
    }
    what.root.append(el('p', 'marxy-dnote', `${chordText('Mod+Shift+C')} opens these forms at the pointer.`));
    body.append(what.root);

    const here = sectionHere();
    if (here) {
      const words = countWords(here.text, { markdown: true });
      const sec = section('This section', `§ ${here.heading.text}`);
      sec.root.append(
        row('Copy it as Markdown', plural(words, 'word'), () => void writeCopy(buildAppContext(handle), { text: here.text }, `Copied § ${here.heading.text}`)),
        row('Copy its code blocks', '', () => {
          const code = runTransform('extract-code-blocks', here.text);
          void writeCopy(buildAppContext(handle), { text: code }, code.trim() === '' ? 'This section has no code blocks' : `Copied the code of § ${here.heading.text}`);
        }),
        row('Copy its links', '', () => void writeCopy(buildAppContext(handle), { text: runTransform('extract-links', here.text) }, 'Copied its links')),
      );
      body.append(sec.root);
    }

    const path = pane.path() ?? '';
    const file = section('This file');
    const bytes = store.snapshot().buffer;
    file.root.append(
      row('Copy the text as written', plural(bytes.bytes.length, 'byte'), () => void writeCopy(buildAppContext(handle), { text: bytes.text }, 'Copied the file as written')),
      row('Copy its path', '', () => void writeCopy(buildAppContext(handle), { text: path }, 'Copied its path'), { disabled: isUntitled(path) }),
      row('Copy its folder', '', () => void writeCopy(buildAppContext(handle), { text: path.slice(0, path.lastIndexOf('/')) }, 'Copied its folder'), { disabled: isUntitled(path) }),
    );
    body.append(file.root);
  }

  ctx.foot.textContent = 'Each copy is made from the file’s own bytes; the file is never changed.';
  ctx.onPage(draw);
  // The selection has no event of its own: a press or a key in a pane may have changed it.
  let queued = false;
  const later = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  };
  const main = document.getElementById('marxy-main');
  main?.addEventListener('pointerup', later);
  main?.addEventListener('keyup', later);
  draw();
  return () => {
    main?.removeEventListener('pointerup', later);
    main?.removeEventListener('keyup', later);
  };
}
