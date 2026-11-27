// An HTML file (`.html`, `.htm`, `.xhtml`) read: drawn as a page in the same sandbox as a message's HTML part, with no
// scripts, nothing from the network until the reader asks for its images (the offer and the record are mail's, kept for
// this file in its tab), links shown and not followed, a form shown and never sent, its own inline styles kept. The
// account above the page says exactly what was left out. Read is this page; Source is the code, the store's text, one key
// away, and the only place it is edited.
import { accountBeside } from '../frame/account.ts';
import { basename, dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import { cleanPage, leftOutLine, type CleanedPage } from '@marxy/core/src/page/clean.ts';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import { el } from '../frame/dom.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { notify } from '../notices/index.ts';
import type { ViewedFile } from './file.ts';
import { cleanedDocument, linksCard } from './mail.ts';
import css from './mail.css?inline';
import { createRemoteImages } from './remote-images.ts';
import { createSandboxFrame, type SandboxFrame } from './sandbox.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { tabState } from './tab-state.ts';
import type { PaneViewer, ViewMode } from './types.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface PageOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly text: () => Uint8Array;
  /** The pane the page is shown in: its tab keeps the images the reader loaded. */
  readonly paneHost?: HTMLElement;
}

export function createPageViewer(o: PageOptions): PaneViewer {
  adoptRuntimeSheet(document, 'marxy-mail-style', css);
  const { shell, file } = o;
  const path = file.path;
  const id = nextViewerId();
  const stateHost = o.paneHost ?? document.createElement('div');
  let host: HTMLElement | null = null;
  let frame: SandboxFrame | null = null;
  let cleaned: CleanedPage | null = null;
  let gone = false;
  const page = (): CleanedPage => (cleaned ??= cleanPage(dec.decode(o.text())));
  const pane = (): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? o.paneHost;
  const remote = createRemoteImages({
    shell,
    path,
    state: () => tabState(stateHost, path),
    page,
    pane,
    noun: 'page',
    redraw: () => {
      draw();
      viewerChanged();
    },
    gone: () => gone,
    shown: () => host !== null || frame !== null,
  });

  /** Its code: Source, in the pane showing the page, with the keys in the editor as the Source button leaves them. */
  async function toCode(): Promise<void> {
    const at = host;
    const shown = at ? appHandle()?.panes().panes.find((p) => p.host.contains(at)) : undefined;
    if (!shown) return;
    await shown.view.setMode('source');
    shown.view.focusSource();
  }

  function openLink(href: string): void {
    if (/^(?:https?|mailto):/i.test(href)) {
      if (shell.openExternal) void shell.openExternal(href);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href === '') {
      notify({ kind: 'refused', text: `${href || 'That link'} is not an address the app opens · nothing was opened.` });
      return;
    }
    // A relative link names a file beside this one: it opens here, as a file, when it is there.
    const target = joinPath(dirname(path), href.split(/[?#]/)[0]!);
    void (async () => {
      const there = await shell.stat(target).catch(() => null);
      if (there && !there.isDir) await appHandle()?.open(target);
      else notify({ kind: 'refused', text: `${href} is relative: it would open here if the file were beside this one. It is not.` });
    })();
  }

  function codeButton(): HTMLButtonElement {
    const b = el('button', 'marxy-linkish', 'Its code, in Source');
    b.type = 'button';
    b.addEventListener('click', () => void toCode());
    return b;
  }

  function draw(): void {
    if (!host) return;
    const scroller = host.querySelector<HTMLElement>('.marxy-htmlpage');
    const top = scroller?.scrollTop ?? 0;
    const c = page();
    const wrap = el('div', 'marxy-htmlpage');
    const col = el('div', 'marxy-htmlpage-col');
    const line = el('p', 'marxy-htmlpage-line', 'A web page, in a sandbox.');
    line.append(' ', codeButton());
    const paper = el('div', 'marxy-mail-paper');
    frame?.destroy();
    frame = createSandboxFrame({
      label: c.title || basename(path),
      onLink: (href) => notify({ kind: 'info', transient: true, text: `${href}: links are not followed inside the page. The Links panel opens one.` }),
    });
    paper.append(frame.el);
    frame.draw(c, remote.loaded());
    const account = [
      `In the sandbox: ${leftOutLine(c.left)}.`,
      'Images from the network are loaded only when you ask, for this page until its tab closes; nothing is remembered.',
      'Links in the page are shown but never followed when clicked. The Links panel lists them: a link to a file beside this one opens here, and a web address opens in your browser.',
      'The page is drawn with its own styles, on its own background. Source has its code, and is where it is edited.',
    ];
    col.append(accountBeside(line, account));
    const bar = remote.bar();
    if (bar) col.append(bar);
    col.append(paper);
    wrap.append(col);
    host.replaceChildren(wrap);
    wrap.scrollTop = top;
  }

  let whyOpen = false;
  const reading: CardDef = {
    id: 'reading',
    title: () => 'Reading',
    relevant: () => true,
    render(body) {
      const line = el('p', 'marxy-card-line');
      line.append('Shown as ', el('b', '', 'a page, sandboxed'));
      const from = el('p', 'marxy-card-note');
      const why = el('button', 'marxy-linkish', whyOpen ? 'hide why' : 'why?');
      why.type = 'button';
      const list = el('ul', 'marxy-reasons');
      list.append(el('li', '', 'The name ends in .html: read as the page it makes, drawn in a sandbox, no scripts, nothing from the network.'));
      list.hidden = !whyOpen;
      why.addEventListener('click', () => {
        whyOpen = !whyOpen;
        list.hidden = !whyOpen;
        why.textContent = whyOpen ? 'hide why' : 'why?';
      });
      from.append('by its name · ', why);
      const tiers = el('ol', 'marxy-tiers');
      for (const [name, words, here] of [['A page, sandboxed', 'no scripts, nothing from the network: Read', true], ['Its code', 'coloured, as written: Source, where it is edited', false]] as const) {
        const li = el('li');
        li.toggleAttribute('data-marxy-here', here);
        li.append(el('b', '', name), el('span', '', words));
        tiers.append(li);
      }
      body.append(line, from, list, tiers, codeButton());
    },
  };
  const links = linksCard({ links: () => page().links, open: openLink });

  return {
    path,
    kind: 'page',
    group: 'page',
    binary: false,
    owns: (m) => m === 'rendered',
    show(_m, into) {
      host = into;
      into.setAttribute('data-marxy-viewer', 'page');
      draw();
    },
    hide() {
      host = null;
    },
    refresh() {
      cleaned = null;
      if (host) draw();
      viewerChanged();
    },
    cards: (m: ViewMode) => (m === 'source' ? {} : { reading, links }),
    passing: () => [],
    headSay: () => null,
    key: () => false,
    panelKey: () => `${id}:${page().links.length}:${remote.loaded() ? 'on' : 'off'}`,
    exports: (m) =>
      m === 'rendered'
        ? [
            {
              id: 'page',
              name: 'The page, cleaned',
              sub: 'no scripts, nothing from the network',
              extension: 'html',
              async build() {
                const doc = cleanedDocument(page(), page().title || basename(path));
                return { bytes: enc.encode(doc), preview: doc };
              },
            },
          ]
        : [],
    destroy() {
      gone = true;
      frame?.destroy();
      frame = null;
      host = null;
    },
  };
}
