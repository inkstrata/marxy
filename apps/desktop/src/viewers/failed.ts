// A file that could not be opened: the floor's card in place of the page, so the tab, the head and the panel name this
// file and not the one shown before it. It says why in plain words and gives the path; there are no bytes to put beside it.
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { appHandle } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { el, factRow } from '../frame/dom.ts';
import { buildAppContext } from '../selection/bind.ts';
import { failedWhy } from './failed-why.ts';
import { nextViewerId } from './signal.ts';
import type { PaneViewer } from './types.ts';

export function createFailedViewer(o: { readonly path: string; readonly error: unknown }): PaneViewer {
  const { path } = o;
  const why = failedWhy(path, o.error);
  const id = nextViewerId();
  let page: HTMLElement | null = null;

  const copyPath = (): void => {
    const handle = appHandle();
    if (handle) void writeCopy(buildAppContext(handle), { text: path }, 'Copied the path');
  };

  function card(): HTMLElement {
    const box = el('div', 'marxy-fcard');
    box.setAttribute('role', 'alert');
    box.append(el('p', 'marxy-fcard-kicker', 'This file could not be opened'), el('h1', 'marxy-fcard-name', basename(path)), el('p', 'marxy-fcard-where', `${dirname(path)}/`));
    const facts = el('div', 'marxy-fcard-facts');
    facts.append(factRow('why', why), factRow('path', path));
    const acts = el('div', 'marxy-fcard-acts');
    const copy = el('button', 'marxy-btn', 'Copy path');
    copy.type = 'button';
    copy.addEventListener('click', copyPath);
    acts.append(copy);
    box.append(facts, acts);
    return box;
  }

  const facts: CardDef = {
    id: 'facts',
    title: () => 'Facts',
    relevant: () => true,
    render(body) {
      body.append(factRow('state', 'could not be opened'), factRow('why', why), factRow('path', path, path));
    },
  };

  return {
    path,
    kind: 'card',
    group: 'bytes',
    binary: true,
    owns: () => true,
    show(_mode, host) {
      host.setAttribute('data-marxy-viewer', 'card');
      page = el('div', 'marxy-fcpage');
      page.setAttribute('data-marxy-failed', '');
      page.append(card());
      host.replaceChildren(page);
    },
    hide() {},
    cards: () => ({ facts }),
    passing: () => [],
    headSay: () => null,
    key: () => false,
    panelKey: () => `failed:${id}`,
    destroy() {
      page?.remove();
      page = null;
    },
  };
}
