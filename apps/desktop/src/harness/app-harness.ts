// Browser entry that boots startApp against createMemoryShell (MARXY-95).
import { startApp, type AppHandle } from '../app.ts';
import { createMemoryShell } from '../shell/memory.ts';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';
import { createTrustController } from '../trust/controller.ts';
import { createLaunchMeasure } from '../startup/measure.ts';
import { createRenderedSelection, type RenderedSelection } from '../selection/view.ts';
import { createRenderedView, type RenderedView } from '../view/rendered-view.ts';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * `pieces` (slug → markdown) stands in for the bundled Commonplace on a launch with no document
 * (MARXY-257); `{}` is a build with none.
 */
async function start(
  files: Record<string, string>,
  argv: string[],
  pieces?: Record<string, string>,
): Promise<AppHandle> {
  const bytes: Record<string, Uint8Array> = {};
  for (const [path, b64] of Object.entries(files)) bytes[path] = decodeBase64(b64);
  const shell = createMemoryShell(bytes);
  const sources = pieces
    ? Object.entries(pieces).map(([name, text]) => ({ name, load: async () => text }))
    : undefined;
  return startApp(shell, { argv, pieces: sources });
}

/**
 * Test-only (B-13): a view on a fresh article of its own, beside whatever else is on the page, with a
 * store for `text` at `path`. Two calls make two views that share nothing but the window, as two
 * panes will (Phase D). `wire` gives the view a command context of its own (the task click).
 */
function view(path: string, text: string, opts?: { wire?: boolean }): {
  readonly view: RenderedView;
  readonly store: DocumentStore;
  readonly selection: RenderedSelection;
  readonly article: HTMLElement;
} {
  const bytes = new TextEncoder().encode(text);
  const shell = createMemoryShell({ [path]: bytes });
  const pane = document.createElement('section');
  const article = document.createElement('article');
  article.className = 'marxy-article';
  const sourceHost = document.createElement('div');
  sourceHost.hidden = true;
  pane.append(article, sourceHost);
  document.body.append(pane);
  const store = openDocumentStore({ writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b) }, path, bytes);
  let rendered: RenderedView | null = null;
  const trust = createTrustController({
    shell,
    currentPath: () => store.snapshot().path,
    buffer: () => store.snapshot().buffer,
    position: (p) => rendered!.blockPosition(p),
    rerender: (at) => rendered!.rerender(at),
    showSource: (byte) => rendered!.showSource(byte),
    notify: () => {},
  });
  const selection = createRenderedSelection({
    article,
    scroller: document.documentElement,
    store: () => rendered?.store() ?? null,
    shell: shell as never,
    open: async () => {},
    currentPath: () => rendered?.store()?.snapshot().path ?? null,
    mountThrough: (byte) => rendered?.mountThrough(byte),
    imageRoot: (p) => p.slice(0, p.lastIndexOf('/')) || '/',
  });
  rendered = createRenderedView(
    { article, scroller: document.documentElement, sourceHost, modeHost: pane },
    {
      shell,
      trust,
      assetRoots: new Set(),
      measure: createLaunchMeasure(shell, []),
      rootFor: async (p) => p.slice(0, p.lastIndexOf('/')) || '/',
      selection: () => selection,
      context: opts?.wire
        ? () => ({
            shell: { clipboardWrite: async () => {} },
            selection: { kind: 'none' },
            document: store,
            operationInput: () => null,
            closePalette: () => {},
            showNotice: () => {},
          })
        : undefined,
    },
  );
  return { view: rendered, store, selection, article };
}

declare global {
  interface Window {
    marxyApp: { start: typeof start };
    marxyViewHarness: { view: typeof view };
  }
}

window.marxyApp = { start };
window.marxyViewHarness = { view };
