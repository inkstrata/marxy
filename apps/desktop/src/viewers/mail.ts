// A mail message's page: the head set as a letter's, the HTML part cleaned and drawn
// in the sandbox with images from the network held back until the reader asks (for this message, until its tab closes,
// never remembered), or the text part with its quotes set in and its signature apart; attachments as file cards that open
// into memory as an archive's entry does. Read is this page; Source is the message as it travels, the store's text. The
// cursor walks the headers, the body's blocks and the attachments (`#part=N`, IMAP's numbering); o opens an attachment.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { MAIL_LIMITS, parseMailDate, parseMessage, textLines, type MailAddress, type MailDate, type MailMessage, type MailPart } from '@marxy/core/src/mail/mime.ts';
import { outlookBodyWords, type OutlookFacts } from '@marxy/core/src/mail/outlook.ts';
import { cleanPage, leftOutLine, type CleanedPage, type PageLink } from '@marxy/core/src/page/clean.ts';
import { accountElement } from '../frame/account.ts';
import { ENTRY_OPEN_CAP, shortSize } from '@marxy/core/src/viewer/archive.ts';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import { holdEntry } from '../document/entries.ts';
import { el, plural } from '../frame/dom.ts';
import { guardLongRuns } from '../render/long-runs.ts';
import { intend } from '../frame/intent.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { notify } from '../notices/index.ts';
import { treeParts } from '../parts/moves.ts';
import { textBox } from '../parts/xray-box.ts';
import type { ViewedFile } from './file.ts';
import css from './mail.css?inline';
import { createSandboxFrame, type SandboxFrame } from './sandbox.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { createRemoteImages } from './remote-images.ts';
import { tabState } from './tab-state.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerExport, ViewMode } from './types.ts';
import { appendAll } from '@marxy/core/src/util/spread.ts';

const enc = new TextEncoder();
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Images drawn as a card's picture at most this large; past it the card shows the kind. */
const THUMB_BYTES = 2 * 1024 * 1024;
const RASTER = /^image\/(?:png|jpeg|gif|webp|avif|bmp)$/;

export interface MailOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  /** The store's bytes, live. */
  readonly text: () => Uint8Array;
  /** The pane the page is drawn in; none for a page drawn inside another (an archive's preview). */
  readonly paneHost?: HTMLElement;
  /** Embedded: what a part that opens (an attachment) does instead of opening a tab of its own. */
  readonly open?: () => void;
  /**
   * An Outlook message, read by the shell into `text`: what it said of it. Those bytes are not the file's, so no part
   * names a byte of the file for Source to land on.
   */
  readonly outlook?: OutlookFacts;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** "Mon 2 Nov 2026, 08:14", and its zone said apart, as the message writes it: never moved to the reader's zone. */
export function mailDateWords(m: MailMessage): { main: string; zone: string } | null {
  return m.date ? dateWordsOf(m.date) : null;
}

function dateWordsOf(d: MailDate): { main: string; zone: string } {
  if (!d.when) return { main: d.raw, zone: '' };
  const w = d.when;
  return { main: `${DAYS[w.weekday]} ${w.day} ${MONTHS[w.month - 1]} ${w.year}, ${two(w.hour)}:${two(w.minute)}`, zone: `${w.zone}, as the message writes it` };
}

function addressNodes(list: readonly MailAddress[]): Node[] {
  const out: Node[] = [];
  list.forEach((a, i) => {
    if (i > 0) out.push(document.createTextNode(', '));
    if (a.name) out.push(el('b', '', a.name), document.createTextNode(' '));
    out.push(el('span', a.name ? 'marxy-mail-addr' : '', a.address));
  });
  return out;
}

/** "csv", "jpg": what a card names when it draws no picture. */
const kindWord = (p: MailPart): string => (/\.([a-z0-9]{1,5})$/i.exec(p.filename ?? '')?.[1] ?? p.type.split('/')[1] ?? 'file').toUpperCase().slice(0, 5);

const nameOf = (p: MailPart, i: number): string => p.filename || (p.type === 'message/rfc822' ? `message ${i + 1}.eml` : `part ${p.id}`);

function dataUrl(type: string, bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

const latin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

/** A part's number as IMAP writes it: core's root is "1" and its children "1.1", "1.2"; written "1", "2". */
const partNo = (p: MailPart): string => (p.id === '1' ? '1' : p.id.slice(2));

/** Where a part sits in the message's bytes: its headers' start, its body's start, and its end. */
interface Span {
  readonly start: number;
  readonly headEnd: number;
  readonly bodyStart: number;
  readonly end: number;
}

/**
 * Each part's bytes, found again along the tree core read (core keeps no offsets): a part's header block ends at its first
 * empty line, and a multipart's children lie between its `--boundary` lines, as core splits them.
 */
function locateParts(bytes: Uint8Array, root: MailPart): Map<string, Span> {
  const out = new Map<string, Span>();
  const head = (from: number, to: number): { headEnd: number; bodyStart: number } => {
    if (bytes[from] === 0x0a) return { headEnd: from, bodyStart: from + 1 };
    if (bytes[from] === 0x0d && bytes[from + 1] === 0x0a) return { headEnd: from, bodyStart: from + 2 };
    for (let i = from; i < to; i++) {
      if (bytes[i] !== 0x0a) continue;
      if (bytes[i + 1] === 0x0a) return { headEnd: i + 1, bodyStart: i + 2 };
      if (bytes[i + 1] === 0x0d && bytes[i + 2] === 0x0a) return { headEnd: i + 1, bodyStart: i + 3 };
    }
    return { headEnd: to, bodyStart: to };
  };
  const visit = (p: MailPart, from: number, to: number): void => {
    const h = head(from, to);
    out.set(p.id, { start: from, ...h, end: to });
    const boundary = p.params.boundary;
    if (p.children.length === 0 || !boundary) return;
    const mark = `--${boundary}`;
    const marks: { start: number; next: number }[] = [];
    for (let line = h.bodyStart; line < to; ) {
      let lineEnd = bytes.indexOf(0x0a, line);
      if (lineEnd === -1 || lineEnd >= to) lineEnd = to;
      const text = lineEnd - line <= mark.length + 64 ? latin1(bytes.subarray(line, lineEnd)) : '';
      if (text.startsWith(mark) && /^(?:--)?[ \t\r]*$/.test(text.slice(mark.length))) {
        let start = line;
        if (start > h.bodyStart && bytes[start - 1] === 0x0a) start--;
        if (start > h.bodyStart && bytes[start - 1] === 0x0d) start--;
        marks.push({ start, next: Math.min(to, lineEnd + 1) });
      }
      line = lineEnd + 1;
    }
    p.children.forEach((c, i) => {
      const open = marks[i];
      if (open) visit(c, open.next, marks[i + 1]?.start ?? to);
    });
  };
  visit(root, 0, bytes.length);
  return out;
}

/** A header block's fields as written: each a name and its lines, folded lines kept. */
function headerFields(text: string): { name: string; lines: string[] }[] {
  const out: { name: string; lines: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue;
    if (/^[ \t]/.test(line) && out.length > 0) out.at(-1)!.lines.push(line);
    else out.push({ name: line.slice(0, Math.max(0, line.indexOf(':'))).trim(), lines: [line] });
  }
  return out;
}

/** A text part's lines grouped as the page sets them: a run of lines at one quote level, the signature whole. */
function textBlocks(lines: readonly { text: string; level: number; signature: boolean }[]): { from: number; to: number; kind: 'para' | 'quote' | 'signature' }[] {
  const out: { from: number; to: number; kind: 'para' | 'quote' | 'signature' }[] = [];
  lines.forEach((l, i) => {
    const kind = l.signature ? 'signature' : l.level > 0 ? 'quote' : 'para';
    const last = out.at(-1);
    const prev = lines[i - 1];
    if (l.text === '' && !l.signature) return;
    if (last && last.to === i && prev && (kind === 'signature' ? last.kind === 'signature' : prev.level === l.level && last.kind === kind)) last.to = i + 1;
    else out.push({ from: i, to: i + 1, kind });
  });
  return out;
}

export function createMailViewer(o: MailOptions): PaneViewer {
  adoptRuntimeSheet(document, 'marxy-mail-style', css);
  const { shell, file, paneHost, outlook } = o;
  /** Where a part starts in the file, for Source to land on: none when the page is drawn from bytes that are not the file's. */
  const atFile = (n: number | undefined): number | undefined => (outlook ? undefined : n);
  const path = file.path;
  const id = nextViewerId();
  // Embedded, the page's state is its own: tabState keeps it by this element, which no tab names.
  const stateHost = paneHost ?? document.createElement('div');
  const state = () => tabState(stateHost, path);
  let host: HTMLElement | null = null;
  let frame: SandboxFrame | null = null;
  let message: MailMessage | null = null;
  let failed: string | null = null;
  let cleaned: CleanedPage | null = null;
  let gone = false;
  /** The text part's blocks as drawn, in order: the cursor's elements for them. */
  let blockEls: HTMLElement[] = [];
  const pane =(): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? paneHost;

  function read(): void {
    try {
      message = parseMessage(o.text());
      failed = null;
    } catch (e) {
      message = null;
      failed = e instanceof Error ? e.message : String(e);
    }
    cleaned = null;
  }
  read();

  const cidUrl = (cid: string): string | null => {
    const p = message?.inline.get(cid);
    return p && /^image\//.test(p.type) && p.size <= ENTRY_OPEN_CAP ? dataUrl(p.type, p.bytes()) : null;
  };
  const page = (): CleanedPage | null => {
    if (!message?.html) return null;
    cleaned ??= cleanPage(message.html.text() ?? '', { cid: cidUrl });
    return cleaned;
  };
  const partShown = (): 'html' | 'text' => {
    if (!message?.html) return 'text';
    if (!message.text) return 'html';
    return state().mailPart.get(path) ?? 'html';
  };
  const remote = createRemoteImages({
    shell,
    path,
    state,
    page,
    pane,
    noun: 'message',
    redraw: () => {
      draw();
      viewerChanged();
    },
    gone: () => gone,
    shown: () => host !== null || frame !== null,
  });
  const loaded = (): Map<string, string> | null => remote.loaded();

  function openLink(href: string): void {
    const at = pane();
    if (/^(?:https?|mailto):/i.test(href)) {
      if (shell.openExternal) void shell.openExternal(href);
      else notify({ kind: 'info', text: `${href} would open in your browser.` }, { pane: at });
      return;
    }
    notify({ kind: 'refused', text: `${href} is not an address the app opens · nothing was opened.` }, { pane: at });
  }

  function saidInPage(href: string): void {
    notify({ kind: 'info', transient: true, text: `${href}: links are not followed inside the message. The Links panel opens one.` }, { pane: pane() });
  }

  async function openAttachment(i: number): Promise<void> {
    const m = message;
    const a = m?.attachments[i];
    if (!a) return;
    if (o.open) return o.open();
    const name = nameOf(a, i);
    if (a.size > ENTRY_OPEN_CAP) {
      notify({ kind: 'refused', text: `${name} is ${shortSize(a.size)}, over the ${shortSize(ENTRY_OPEN_CAP)} an attachment opens with here.` }, { pane: pane() });
      return;
    }
    const entry = holdEntry({ archive: path, name, index: i, bytes: a.bytes().slice(), mtimeMs: file.mtimeMs, of: 'message' });
    const handle = appHandle();
    const at = handle?.panes().panes.find((p) => p.host === paneHost);
    if (!handle || !at || !paneHost) return;
    intend(paneHost, entry.path, 'new');
    // The attachment's tab says what it is when it lands (document/open.ts): one notice for the one event.
    await handle.panes().openIn(at.slot, entry.path);
  }

  const remoteBar = (): HTMLElement | null => (partShown() === 'html' ? remote.bar() : null);

  /** The page's account (core reading/account.ts): how the part shown is drawn, and what an attachment does. */
  function accountOf(m: MailMessage): string[] {
    const lines: string[] = [];
    if (outlook) lines.push(`Read from an Outlook message into the message it would be as it travels. ${outlookBodyWords(outlook)}`);
    const c = partShown() === 'html' ? page() : null;
    if (c) {
      lines.push(
        `The HTML part is shown in a sandbox: ${leftOutLine(c.left)}.`,
        'Links in it are shown but never followed when clicked; the Links panel opens one. Its own styles stay inside the frame, on the message’s white paper.',
      );
    } else {
      const part = m.text;
      const flowed = part ? /flowed/i.test(part.params.format ?? '') : false;
      if (part) lines.push(`The text part is shown as written${flowed ? ', its soft line breaks kept' : ''}. Quoted lines are indented one step for each >, and the signature starts after the line that is two dashes and a space.`);
    }
    if (m.attachments.length > 0) lines.push('An attachment opens read-only, held in memory, in a tab of its own. Nothing is saved to disk unless you export it.');
    return lines;
  }

  function head(m: MailMessage): HTMLElement {
    const h = el('header', 'marxy-mail-head');
    const account = accountElement(accountOf(m), `${outlook ? 'An Outlook message' : 'A mail message'} · ${m.root.type} · ${plural(m.leaves, 'part')}`, 'marxy-mail-kicker');
    if (account) h.append(account);
    h.append(el('h1', 'marxy-mail-subject', m.subject || '(no subject)'));
    const who = el('dl', 'marxy-mail-who');
    const row = (k: string, v: Node[]): void => {
      const dd = el('dd');
      dd.append(...v);
      who.append(el('dt', '', k), dd);
    };
    row('From', addressNodes(m.from));
    if (m.to.length) row('To', addressNodes(m.to));
    if (m.cc.length) row('Cc', addressNodes(m.cc));
    if (m.bcc.length) row('Bcc', addressNodes(m.bcc));
    const dateRow = (k: string, date: { main: string; zone: string } | null): void => {
      if (date) row(k, [document.createTextNode(date.main), ...(date.zone ? [document.createTextNode(' '), el('span', 'marxy-mail-quiet', date.zone)] : [])]);
    };
    dateRow('Date', mailDateWords(m));
    // Outlook keeps when the message arrived beside when it was sent; a message as it travels says it only in its trace.
    if (outlook?.received) dateRow('Received', dateWordsOf(parseMailDate(outlook.received)));
    h.append(who);
    const bar = el('div', 'marxy-mail-bar');
    if (m.html && m.text) {
      const seg = el('div', 'marxy-seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Which part');
      for (const [v, words] of [['html', 'HTML'], ['text', 'Text']] as const) {
        const b = el('button', '', words);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(partShown() === v));
        b.dataset.marxyPart = v;
        b.addEventListener('click', () => {
          state().mailPart.set(path, v);
          draw();
          viewerChanged();
        });
        seg.append(b);
      }
      bar.append(seg, el('span', 'marxy-mail-quiet', 'sent as both; the HTML part first'));
    } else bar.append(el('span', 'marxy-mail-quiet', m.html ? 'sent as HTML only' : 'sent as text only'));
    bar.append(el('span', 'marxy-mail-grow'));
    const all = el('button', 'marxy-linkish', `All ${m.headers.length} headers`);
    all.type = 'button';
    all.addEventListener('click', () => {
      state().allHeaders.add(path);
      viewerChanged();
      appHandle()?.frame().showPanel({ card: 'frontmatter' });
    });
    bar.append(all);
    h.append(bar);
    return h;
  }

  function textBody(m: MailMessage): HTMLElement[] {
    const part = m.text;
    if (!part) return [el('p', 'marxy-mail-note', 'The message has no text part to show.')];
    const box = el('div', 'marxy-mail-text');
    const lines = textLines(part.text() ?? '');
    const blocks = textBlocks(lines);
    blockEls = [];
    let k = 0;
    lines.forEach((line, i) => {
      const p = el('p', 'marxy-mail-line', line.text === '' ? ' ' : line.text);
      if (line.level) p.dataset.marxyLevel = String(Math.min(line.level, 6));
      if (line.signature) p.dataset.marxySig = '';
      const b = blocks[k];
      if (!b || i < b.from) {
        box.append(p);
        return;
      }
      // An unstyled holder for the cursor to mark: the lines are set as before.
      if (i === b.from) blockEls.push(box.appendChild(el('div')));
      blockEls.at(-1)!.append(p);
      if (i === b.to - 1) k++;
    });
    // A line with no space in it is one unbroken run the engine lays out in time that grows steeply with its length.
    guardLongRuns(box);
    return [box];
  }

  function htmlBody(): HTMLElement[] {
    const c = page();
    if (!c) return [];
    const wrap = el('div', 'marxy-mail-paper');
    frame?.destroy();
    frame = createSandboxFrame({ label: 'The message, cleaned', onLink: saidInPage });
    wrap.append(frame.el);
    frame.draw(c, loaded());
    return [wrap];
  }

  function attachments(m: MailMessage): HTMLElement | null {
    if (m.attachments.length === 0) return null;
    const sec = el('section', 'marxy-mail-attach');
    const h = el('h2', 'marxy-mail-attach-head', 'Attachments ');
    h.append(el('span', '', String(m.attachments.length)));
    const grid = el('div', 'marxy-mail-cards');
    m.attachments.forEach((a, i) => {
      const b = el('button', 'marxy-mail-card');
      b.type = 'button';
      const name = nameOf(a, i);
      b.title = `Open ${name} into memory`;
      b.dataset.marxyAttach = name;
      const pic = el('span', 'marxy-mail-card-pic');
      if (RASTER.test(a.type) && a.size <= THUMB_BYTES) {
        const img = el('img');
        img.alt = '';
        img.src = dataUrl(a.type, a.bytes());
        pic.append(img);
      } else pic.append(el('span', 'marxy-mail-card-kind', kindWord(a)));
      const words = el('span', 'marxy-mail-card-words');
      words.append(el('span', 'marxy-mail-card-name', name), el('span', 'marxy-mail-card-sub', `${a.type} · ${shortSize(a.size)}`));
      b.append(pic, words, el('span', 'marxy-mail-card-open', 'Open'));
      b.addEventListener('click', () => void openAttachment(i));
      grid.append(b);
    });
    sec.append(h, grid);
    return sec;
  }

  function draw(): void {
    if (!host) return;
    const scroller = host.querySelector<HTMLElement>('.marxy-mailpage');
    const top = scroller?.scrollTop ?? 0;
    const pageEl = el('div', 'marxy-mailpage');
    const col = el('div', 'marxy-mail-col');
    pageEl.append(col);
    if (!message) {
      col.append(el('p', 'marxy-mail-kicker', 'A mail message'), el('p', 'marxy-mail-note', `${failed ?? 'It could not be read as a message.'} Source has its text.`));
      host.replaceChildren(pageEl);
      return;
    }
    const m = message;
    col.append(head(m));
    const bar = remoteBar();
    if (bar) col.append(bar);
    if (partShown() === 'html') appendAll(col, htmlBody());
    else {
      frame?.destroy();
      frame = null;
      appendAll(col, textBody(m));
    }
    const capped = [...(outlook?.notes ?? []), ...m.capped];
    if (capped.length) col.append(el('p', 'marxy-mail-note', capped.join(' ')));
    const att = attachments(m);
    if (att) col.append(att);
    host.replaceChildren(pageEl);
    pageEl.scrollTop = top;
  }

  // ---- the panel ---------------------------------------------------------------------------------------------------

  let whyOpen = false;
  const reading: CardDef = {
    id: 'reading',
    title: () => 'Reading',
    relevant: () => true,
    render(body) {
      const n = message?.attachments.length ?? 0;
      const line = el('p', 'marxy-card-line');
      line.append('Shown as ', el('b', '', `${outlook ? 'an Outlook message' : 'a mail message'}${n ? `, ${plural(n, 'attachment')}` : ''}`));
      const from = el('p', 'marxy-card-note');
      from.append(el('span', file.guessed ? 'marxy-guessed' : '', file.guessed ? 'guessed from its headers; the name did not say' : 'from its name'));
      const why = el('button', 'marxy-linkish', whyOpen ? 'hide why' : 'why?');
      why.type = 'button';
      const list = el('ul', 'marxy-reasons');
      const ext = /\.([^./]+)$/.exec(path)?.[1];
      if (outlook) {
        list.append(
          el('li', '', `The name ends in .${ext ?? 'msg'}: an Outlook message, a compound file of the message’s properties.`),
          el('li', '', `Its bytes are a compound file that holds them (${outlook.class}), so the bytes agree.`),
        );
      } else {
        if (ext && !file.guessed) list.append(el('li', '', `The name ends in .${ext}: a mail message as it travels, headers then MIME parts.`));
        list.append(el('li', '', 'It starts with mail headers (who sent it, to whom, when), so the text agrees.'));
      }
      list.hidden = !whyOpen;
      why.addEventListener('click', () => {
        whyOpen = !whyOpen;
        list.hidden = !whyOpen;
        why.textContent = whyOpen ? 'hide why' : 'why?';
      });
      from.append(' · ', why);
      body.append(line, from, list);
      body.append(el('p', 'marxy-card-sub', 'Caps'));
      const caps = el('ul', 'marxy-mail-caps');
      for (const c of [
        'HTML cleaned and drawn in a sandbox: no scripts',
        'images from the network blocked until you ask, for this message only',
        'links shown, never followed inside',
        `attachments open into memory, up to ${ENTRY_OPEN_CAP / 1048576} MB`,
        `at most ${MAIL_LIMITS.parts} parts, ${MAIL_LIMITS.depth} levels deep, a message of ${MAIL_LIMITS.messageBytes / 1048576} MB`,
        ...(outlook ? ['an Outlook message: 1,000 recipients, 256 attachments, messages attached 8 deep, 16 MB a part'] : []),
      ]) caps.append(el('li', '', c));
      body.append(caps);
      for (const c of [...(outlook?.notes ?? []), ...(message?.capped ?? [])]) body.append(el('p', 'marxy-card-note', c));
    },
  };

  const messageCard: CardDef = {
    id: 'contents',
    title: () => 'Message',
    detail: () => (message ? plural(message.leaves, 'part') : ''),
    relevant: () => message !== null,
    render(body) {
      const m = message;
      if (!m) return;
      const tree = el('ol', 'marxy-mail-tree');
      for (const p of m.parts) {
        const li = el('li', 'marxy-mail-tree-row');
        li.style.setProperty('--depth', String(p.depth));
        const what = el('span', 'marxy-mail-tree-type', p.filename ? `${p.type} · ${p.filename}` : p.type);
        li.append(what);
        if (p.children.length === 0) {
          const inline = m.inline.get(p.cid ?? '') === p && !m.attachments.includes(p);
          li.append(el('span', 'marxy-mail-tree-size', `${shortSize(p.size)} · ${p.encoding}${inline ? ' · inline' : ''}`));
        }
        tree.append(li);
      }
      body.append(tree);
      if (m.attachments.length === 0) return;
      body.append(el('p', 'marxy-card-sub', 'Attachments'));
      const list = el('div', 'marxy-mail-atts');
      m.attachments.forEach((a, i) => {
        const b = el('button', 'marxy-arch-big');
        b.type = 'button';
        b.title = `Open ${nameOf(a, i)} into memory`;
        b.append(el('span', 'marxy-arch-big-name', nameOf(a, i)), el('span', 'marxy-arch-big-size', shortSize(a.size)));
        b.addEventListener('click', () => void openAttachment(i));
        list.append(b);
      });
      body.append(list);
    },
  };

  const links: CardDef = linksCard({ links: () => page()?.links ?? [], open: openLink });

  const USUAL = ['from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date', 'message-id', 'in-reply-to'];
  const headers: CardDef = {
    id: 'frontmatter',
    title: () => 'Headers',
    detail: () => (message ? (state().allHeaders.has(path) ? `${message.headers.length}, as written` : `the usual of ${message.headers.length}`) : ''),
    relevant: () => message !== null,
    render(body) {
      const m = message;
      if (!m) return;
      const all = state().allHeaders.has(path);
      const shown = all ? m.headers : m.headers.filter((h) => USUAL.includes(h.name.toLowerCase()));
      const list = el('div', 'marxy-mail-headers');
      for (const h of shown) {
        const row = el('div', 'marxy-mail-header');
        row.append(el('span', 'marxy-mail-header-k', h.name), el('span', 'marxy-mail-header-v', all ? h.raw : h.value));
        if (all && h.value !== h.raw) row.append(el('span', 'marxy-mail-header-read', `read: ${h.value}`));
        list.append(row);
      }
      body.append(list);
      const t = el('button', 'marxy-linkish', all ? 'Only the usual ones' : `All ${m.headers.length}, as written`);
      t.type = 'button';
      t.addEventListener('click', () => {
        if (all) state().allHeaders.delete(path);
        else state().allHeaders.add(path);
        viewerChanged();
      });
      body.append(t);
    },
  };

  function exports(): ViewerExport[] {
    const m = message;
    const out: ViewerExport[] = [
      {
        id: 'message',
        name: 'The message, as it is',
        sub: 'every byte, under a name you choose',
        extension: /\.([^./]+)$/.exec(path)?.[1] ?? 'eml',
        async build() {
          const bytes = o.text().slice();
          return { bytes, preview: `${basename(path)}: ${shortSize(bytes.length)}.\n\nThe message as it travels, headers and every part, byte for byte. Nothing is converted.` };
        },
      },
    ];
    if (m?.text) {
      const part = m.text;
      out.push({
        id: 'text',
        name: 'The text part',
        sub: 'as plain text',
        extension: 'txt',
        async build() {
          const text = part.text() ?? '';
          return { bytes: enc.encode(text), preview: text };
        },
      });
    }
    const c = page();
    if (c) {
      out.push({
        id: 'html',
        name: 'The HTML part, cleaned',
        sub: 'no scripts, images from the network left out',
        extension: 'html',
        async build() {
          const doc = cleanedDocument(c, m?.subject || basename(path));
          return { bytes: enc.encode(doc), preview: doc };
        },
      });
    }
    return out;
  }

  // ---- the parts -------------------------------------------------------------------------

  let spans: { of: MailMessage; at: Map<string, Span>; bytes: Uint8Array } | null = null;
  const located = (): { at: Map<string, Span>; bytes: Uint8Array } | null => {
    if (!message) return null;
    if (spans?.of !== message) {
      const bytes = o.text();
      spans = { of: message, at: locateParts(bytes, message.root), bytes };
    }
    return spans;
  };
  const spanOf = (p: MailPart): Span | undefined => located()?.at.get(p.id);
  /** The bytes of `from`–`to` as text: UTF-8 where they read as it, else a character a byte. */
  const textOf = (from: number, to: number): string => {
    const bytes = located()?.bytes.subarray(from, to) ?? new Uint8Array();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return latin1(bytes);
    }
  };
  const mount = (sel: string): HTMLElement | null => host?.querySelector<HTMLElement>(sel) ?? null;

  /** A part as sent: its MIME headers, then the first lines of its body in their transfer encoding. */
  function sentBox(p: MailPart): HTMLElement | null {
    const s = spanOf(p);
    if (!s) return null;
    const FIRST = 12;
    const head = textOf(s.start, s.headEnd).split(/\r?\n/).filter((l) => l !== '');
    const body = latin1(located()!.bytes.subarray(s.bodyStart, s.end)).split(/\r?\n/);
    if (body.at(-1) === '') body.pop();
    const shown = body.slice(0, FIRST);
    const more = body.length - shown.length;
    return textBox(`As sent · part ${partNo(p)}, ${p.encoding}`, [...head, '', ...shown, ...(more > 0 ? [`… ${more.toLocaleString('en-GB')} more lines`] : [])]);
  }

  let partsTree: { key: string; of: MailMessage; tree: PartTree } | null = null;
  function mailParts(): PartTree | null {
    const m = message;
    if (!m) return null;
    const shownPart = partShown() === 'html' ? m.html : m.text;
    const key = partShown();
    if (partsTree && partsTree.key === key && partsTree.of === m) return partsTree.tree;
    located();
    const rootSpan = spanOf(m.root);
    const headText = rootSpan ? textOf(0, rootSpan.headEnd).replace(/\r?\n$/, '') : '';
    const fields = headerFields(headText);
    const fieldUnit = (name: string, el: () => HTMLElement | null): PartUnit | null => {
      const f = fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!f) return null;
      return { id: `headers/${f.name}`, label: `header ${f.name}`, address: `#headers/${f.name}`, el, stored: () => f.lines.join('\n') };
    };
    const whoRow = (name: string) => (): HTMLElement | null => {
      const dt = [...(host?.querySelectorAll<HTMLElement>('.marxy-mail-who dt') ?? [])].find((d) => d.textContent === name);
      return (dt?.nextElementSibling as HTMLElement | null) ?? null;
    };
    const headerKids = [
      fieldUnit('Subject', () => mount('.marxy-mail-subject')),
      fieldUnit('From', whoRow('From')),
      m.to.length ? fieldUnit('To', whoRow('To')) : null,
      m.cc.length ? fieldUnit('Cc', whoRow('Cc')) : null,
      m.bcc.length ? fieldUnit('Bcc', whoRow('Bcc')) : null,
      m.date ? fieldUnit('Date', whoRow('Date')) : null,
    ].filter((u): u is PartUnit => u !== null);
    const top: PartUnit[] = [
      {
        id: 'headers',
        label: 'headers',
        address: '#headers',
        at: atFile(0),
        children: headerKids.length ? headerKids : undefined,
        el: () => mount('.marxy-mail-head'),
        stored: () => headText.replace(/\r\n/g, '\n'),
        xray: () => textBox('As written · the message’s headers', headText.split(/\r?\n/)),
      },
    ];
    if (shownPart) {
      const no = partNo(shownPart);
      const span = spanOf(shownPart);
      let kids: PartUnit[] | undefined;
      if (shownPart === m.text) {
        const text = shownPart.text() ?? '';
        const raw = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
        const blocks = textBlocks(textLines(text));
        // Lines sent as they read (7bit, 8bit) are found in the bytes; an encoded part's lines land Source at the part.
        const plain = span && !/^(?:base64|quoted-printable)$/.test(shownPart.encoding);
        const bodyText = plain ? latin1(located()!.bytes.subarray(span.bodyStart, span.end)) : '';
        let from = 0;
        kids = blocks.map((b, i) => {
          let at = span?.start;
          if (plain && span) {
            const first = latin1(new TextEncoder().encode(raw[b.from] ?? ''));
            const hit = bodyText.indexOf(first, from);
            if (hit >= 0) {
              at = span.bodyStart + hit;
              from = hit + first.length;
            }
          }
          return {
            id: `part=${no}/${i + 1}`,
            label: b.kind === 'signature' ? 'signature' : b.kind === 'quote' ? 'quote' : 'paragraph',
            address: `#part=${no}`,
            at: atFile(at),
            el: () => blockEls[i] ?? null,
            stored: () => raw.slice(b.from, b.to).join('\n'),
          };
        });
      }
      top.push({
        id: `part=${no}`,
        label: `body ${shownPart === m.html ? 'HTML' : 'text'}`,
        address: `#part=${no}`,
        at: atFile(span?.start),
        children: kids?.length ? kids : undefined,
        el: () => mount(shownPart === m.html ? '.marxy-mail-paper' : '.marxy-mail-text'),
        stored: () => shownPart.text() ?? '',
        xray: () => sentBox(shownPart),
      });
    }
    m.attachments.forEach((a, i) => {
      const name = nameOf(a, i);
      top.push({
        id: `attachment=${a.id}`,
        label: `attachment ${name}`,
        address: `#part=${partNo(a)}`,
        at: atFile(spanOf(a)?.start),
        el: () => host?.querySelectorAll<HTMLElement>('.marxy-mail-card')[i] ?? null,
        stored: () => name,
        xray: () => sentBox(a),
        open: () => openAttachment(i),
      });
    });
    const tree = treeParts(top, { readOnly: true });
    partsTree = { key, of: m, tree };
    return tree;
  }

  return {
    path,
    kind: 'mail',
    group: 'mail',
    binary: false,
    owns: (m) => m === 'rendered',
    show(_m, into) {
      host = into;
      into.setAttribute('data-marxy-viewer', 'mail');
      draw();
    },
    hide() {
      host = null;
    },
    refresh() {
      read();
      if (host) draw();
      viewerChanged();
    },
    cards: (m: ViewMode) => (m === 'source' ? {} : { reading, contents: messageCard, links, frontmatter: headers }),
    passing: () => [],
    headSay: () => (file.guessed ? { text: 'mail · guessed', tone: 'guess', title: 'Read from its first bytes: its name does not say what it is · Metadata says why' } : null),
    key: () => false,
    parts: (m) => (m === 'rendered' ? mailParts() : null),
    panelKey: () => `${id}:${partShown()}:${state().allHeaders.has(path)}:${loaded() ? 'on' : 'off'}:${message?.leaves ?? -1}`,
    exports: (m) => (m === 'rendered' ? exports() : []),
    destroy() {
      gone = true;
      frame?.destroy();
      frame = null;
      host = null;
    },
  };
}

/** The cleaned page as a file of its own: its styles in it, nothing that runs, images from the network left as boxes. */
export function cleanedDocument(c: CleanedPage, title: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">\n<title>${esc(title)}</title>\n${c.css.map((s) => `<style>${s.replace(/<\//g, '<\\/')}</style>`).join('\n')}\n</head><body>\n${c.html}\n</body></html>\n`;
}

/**
 * The Links card for a page drawn in the sandbox: each link's words and where it goes, and a link whose words name one
 * place and whose address goes to another said in blue. A press opens it in the browser, never in the page.
 */
export function linksCard(o: { links: () => readonly PageLink[]; open: (href: string) => void; note?: string }): CardDef {
  return {
    id: 'links',
    title: () => 'Links',
    detail: () => (o.links().length ? `${o.links().length} in the page` : ''),
    relevant: () => o.links().length > 0,
    render(body) {
      const list = el('ul', 'marxy-links');
      for (const link of o.links().slice(0, 60)) {
        const li = el('li');
        const b = el('button', 'marxy-link-row');
        b.type = 'button';
        const where = link.goes || (/^mailto:/i.test(link.href) ? 'mailto' : link.href);
        b.append(el('span', 'marxy-link-text', link.text || link.href), el('small', 'marxy-link-url', where));
        b.title = link.href;
        b.addEventListener('click', () => o.open(link.href));
        li.append(b);
        if (link.odd) li.append(el('p', 'marxy-guessed marxy-mail-odd', `says ${link.says}, goes to ${link.goes}`));
        list.append(li);
      }
      body.append(list);
      if (o.links().length > 60) body.append(el('p', 'marxy-card-note', `and ${o.links().length - 60} more`));
      body.append(el('p', 'marxy-card-note', o.note ?? 'Nothing is followed inside the page. A link opens in your browser when you choose it here.'));
    },
  };
}
