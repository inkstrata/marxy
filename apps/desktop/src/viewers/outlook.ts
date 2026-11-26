// An Outlook message (.msg): the shell reads the compound file into the message it would be as it travels
// (src-tauri/src/outlook), and the mail page draws that as it draws an .eml, through the same parser and sanitiser. Source
// is the file's own bytes in the hex view. Export offers the file as it is and the message as an .eml.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { MAIL_LIMITS } from '@marxy/core/src/mail/mime.ts';
import type { OutlookMail } from '@marxy/core/src/mail/outlook.ts';
import type { AppShell } from '../app-types.ts';
import { heldEntry, isArchiveEntry } from '../document/entries.ts';
import { el } from '../frame/dom.ts';
import { byteCard, factsCard } from './cards.ts';
import { asItIs } from './exports.ts';
import type { ViewedFile } from './file.ts';
import { createHexView, type HexView } from './hex.ts';
import { createMailViewer } from './mail.ts';
import type { PaneViewer, ViewerExport, ViewerPlace, ViewMode } from './types.ts';

const MB = 1024 * 1024;

/** The message the file reads as, or why it does not read. */
export async function openOutlookFor(shell: AppShell, file: ViewedFile): Promise<OutlookMail | { readonly kicker: string; readonly line: string }> {
  const cannot = (line: string): { kicker: string; line: string } => ({ kicker: 'An Outlook message the app cannot read', line });
  if (!shell.mailFromMsg) return cannot('This build has no reader for Outlook messages.');
  if (file.size > MAIL_LIMITS.messageBytes) return cannot(`It is ${Math.ceil(file.size / MB)} MB, past the ${MAIL_LIMITS.messageBytes / MB} MB read as a message.`);
  try {
    let bytes: Uint8Array;
    if (isArchiveEntry(file.path)) {
      // An archive's entry or an attachment is held in memory: the shell is handed those bytes, never a path.
      const held = heldEntry(file.path);
      if (!held) return cannot('It is no longer held in memory.');
      if (held.size !== undefined && held.size > held.bytes.length) return cannot('Only its beginning is held, and a message is read whole.');
      bytes = held.bytes;
    } else bytes = await shell.readFile(file.path);
    return await shell.mailFromMsg(bytes);
  } catch (e) {
    return cannot(e instanceof Error ? e.message : String(e));
  }
}

export interface OutlookOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly mail: OutlookMail;
  readonly paneHost?: HTMLElement;
  readonly open?: () => void;
  readonly place?: ViewerPlace;
}

export function createOutlookViewer(o: OutlookOptions): PaneViewer {
  const { shell, file, mail } = o;
  const page = createMailViewer({ shell, file, text: () => mail.mime, paneHost: o.paneHost, open: o.open, outlook: mail.facts });
  let hex: HexView | null = null;
  let mode: ViewMode = 'rendered';
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(file.path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  const facts = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });
  const name = basename(file.path).replace(/\.[^.]+$/, '');

  function exports(): ViewerExport[] {
    const eml: ViewerExport = {
      id: 'eml',
      name: `${name} as a mail message`,
      sub: 'an .eml: its headers, its body and its attachments as they would travel',
      extension: 'eml',
      async build() {
        const bytes = mail.mime.slice();
        return { bytes, preview: new TextDecoder().decode(bytes.subarray(0, 4000)) };
      },
    };
    return [{ ...asItIs(shell, file, 'file'), name: 'The message, as it is' }, eml, ...(page.exports?.('rendered') ?? []).filter((x) => x.id !== 'message')];
  }

  return {
    ...page,
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      if (m === 'rendered') {
        page.show(m, into);
        return;
      }
      page.hide();
      into.setAttribute('data-marxy-viewer', 'mail');
      const view = ensureHex();
      const pageEl = el('div', 'marxy-hexpage');
      pageEl.append(view.el);
      into.replaceChildren(pageEl);
      requestAnimationFrame(() => view.draw());
    },
    hide() {
      page.hide();
    },
    cards: () => ({ ...page.cards('rendered'), facts }),
    passing: (m) => (m === 'source' ? [byte] : []),
    key: (e, m) => (m === 'source' ? (hex?.key(e) ?? false) : page.key(e, m)),
    parts: (m) => (m === 'source' ? ensureHex().parts() : (page.parts?.(m) ?? null)),
    panelKey: () => `${page.panelKey()}:${mode}:${hex?.selected() ?? ''}`,
    place: () => ({ hex: hex?.place() }),
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return 'source';
    },
    exports: (m) => (m === 'rendered' ? exports() : [asItIs(shell, file, 'file')]),
    destroy() {
      page.destroy();
      hex?.destroy();
      hex = null;
    },
  };
}
