// The sandbox a page is drawn in: mail's HTML part and an HTML file read as a page share it. The
// markup is cleaned first (core `page/clean.ts`); this frame is the second boundary. It is sandboxed with no scripts, no
// forms, no popups and no navigation; its own policy loads nothing from the network (images only from the page itself,
// or from the shell after the reader asked); its styles are its own, adopted as sheets inside it and never reaching the
// reader's page; a link is shown and never followed. The frame grows to its page's height, so the page scrolls as one.
// Its parent must be positioned: where the frame's own document runs no listener (WebKit), the boxes that hear a press
// on a link sit beside the frame, in the parent.
import type { CleanedPage } from '@marxy/core/src/page/clean.ts';
import { REMOTE_IMAGE_ATTR } from '@marxy/core/src/sanitize/policy.ts';

/** The frame's own ground and link colour, under the page's styles: a browser's defaults, on white paper. */
const BASE_CSS = [
  'html { background: #fff; color: #1c1c1c; color-scheme: light; }',
  'body { margin: 8px; font: 16px/1.4 Georgia, "Times New Roman", serif; overflow-wrap: break-word; }',
  'img { max-width: 100%; height: auto; }',
  ':where(a[data-marxy-href]) { color: #0b4f9c; text-decoration: underline; cursor: pointer; }',
  'form :disabled { cursor: not-allowed; }',
].join('\n');

/** The frame's policy: nothing from the network; images carried in the page, or `remote` ones the shell fetched. */
function policyOf(remote: readonly string[]): string {
  const img = ['data:', ...new Set(remote)].join(' ');
  return `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'`;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Where each remote image's URL comes from once the reader asked for it: the shell's URL for it, by its address. */
export type RemoteImages = ReadonlyMap<string, string>;

/** The page's markup with each image from the network given what the shell fetched for it, when it has. */
function withRemote(html: string, loaded: RemoteImages | null): string {
  if (!loaded || loaded.size === 0) return html;
  return html.replace(new RegExp(`<img\\b([^>]*?)\\s${REMOTE_IMAGE_ATTR}="([^"]*)"([^>]*)>`, 'g'), (all, before: string, url: string, after: string) => {
    const got = loaded.get(url.replaceAll('&amp;', '&'));
    if (!got) return all;
    return `<img${before.replace(/\ssrc="[^"]*"/, '')} src="${esc(got)}" ${REMOTE_IMAGE_ATTR}="${url}"${after}>`;
  });
}

/** The scheme and host of each loaded URL, for the frame's policy: the shell's own scheme, never the network's. */
function sourcesOf(loaded: RemoteImages | null): string[] {
  const out: string[] = [];
  for (const url of loaded?.values() ?? []) {
    if (url.startsWith('data:')) continue;
    const m = /^([a-z][a-z0-9+.-]*:)(\/\/[^/]+)?/i.exec(url);
    if (m && !/^https?:$/i.test(m[1]!)) out.push(m[1]!);
    else if (m && /^http:\/\/[a-z-]+\.localhost$/i.test(`${m[1]}${m[2] ?? ''}`)) out.push(`${m[1]}${m[2]}`);
  }
  return out;
}

export interface SandboxFrame {
  readonly el: HTMLIFrameElement;
  /** Draws `page` again, its remote images as `loaded` gives them (null: none loaded). */
  draw(page: CleanedPage, loaded: RemoteImages | null): void;
  destroy(): void;
}

export interface SandboxOptions {
  /** The frame's name for a screen reader. */
  readonly label: string;
  /** A link in the page was pressed: it is never followed there. */
  onLink(href: string): void;
}

export function createSandboxFrame(o: SandboxOptions): SandboxFrame {
  const frame = document.createElement('iframe');
  frame.className = 'marxy-sandbox';
  // No `allow-scripts`, `allow-forms`, `allow-popups` or any navigation: same origin only so the app can size it, adopt
  // its sheets and hear a press on a link.
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', o.label);
  frame.setAttribute('scrolling', 'no');
  let css: readonly string[] = [];
  let resize: ResizeObserver | null = null;
  let gone = false;
  // Set where the engine runs no listener of the app's inside the frame (WebKit: a document whose sandbox forbids
  // scripts runs none, even one added from here); a press on a link is then heard through `hits`, a layer of the app's own.
  let deaf = false;
  let hits: HTMLElement | null = null;
  const hitHref = new WeakMap<Element, string>();

  const fit = (): void => {
    const d = frame.contentDocument;
    if (!d?.documentElement) return;
    const h = Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0);
    frame.style.height = `${Math.max(120, Math.ceil(h))}px`;
    if (deaf) drawHits(d);
  };

  /**
   * Whether the engine runs a listener of the app's inside the frame. WebKit does not (a document whose sandbox forbids
   * scripts runs none); the engine is told by its name, because a probe event sent into the frame is itself refused and
   * logged as a blocked script each time a page is drawn.
   */
  const hears = (): boolean => !/AppleWebKit/.test(navigator.userAgent) || /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent);

  /** A transparent box over each line of each link, in the app's page beside the frame: the frame never scrolls. */
  function drawHits(d: Document): void {
    if (!hits) {
      hits = document.createElement('div');
      hits.className = 'marxy-sandbox-hits';
      hits.setAttribute('aria-hidden', 'true');
      hits.addEventListener('click', (e) => {
        const href = hitHref.get(e.target as Element);
        e.preventDefault();
        if (href !== undefined) o.onLink(href);
      });
    }
    if (frame.nextElementSibling !== hits) frame.after(hits);
    hits.style.left = `${frame.offsetLeft + frame.clientLeft}px`;
    hits.style.top = `${frame.offsetTop + frame.clientTop}px`;
    const boxes: HTMLElement[] = [];
    for (const a of d.querySelectorAll('a[data-marxy-href]')) {
      const href = a.getAttribute('data-marxy-href') ?? '';
      for (const r of a.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue;
        const box = document.createElement('span');
        box.className = 'marxy-sandbox-hit';
        box.style.left = `${r.left}px`;
        box.style.top = `${r.top}px`;
        box.style.width = `${r.width}px`;
        box.style.height = `${r.height}px`;
        hitHref.set(box, href);
        boxes.push(box);
      }
    }
    hits.replaceChildren(...boxes);
  }

  function adopt(d: Document): void {
    const win = d.defaultView as (Window & typeof globalThis) | null;
    if (!win) return;
    // A sheet must be made in the document that adopts it: the frame's own constructor, called from here (the frame
    // runs nothing of its own).
    const sheets = [BASE_CSS, ...css].map((text) => {
      const sheet = new win.CSSStyleSheet();
      try {
        sheet.replaceSync(text);
      } catch {
        // A sheet the engine refuses is left out, as a browser leaves out a rule it cannot read.
      }
      return sheet;
    });
    d.adoptedStyleSheets = sheets;
  }

  function wire(): void {
    const d = frame.contentDocument;
    if (!d || gone) return;
    adopt(d);
    deaf = !hears();
    if (!deaf) hits?.replaceChildren();
    // Where the engine runs none of them, adding them only has it log a blocked script (`hits` hears the press instead).
    if (!deaf) {
      d.addEventListener('click', (e) => {
        const a = (e.target as Element | null)?.closest?.('a[data-marxy-href]');
        e.preventDefault();
        if (a) o.onLink(a.getAttribute('data-marxy-href') ?? '');
      });
      d.addEventListener('submit', (e) => e.preventDefault(), true);
      // The app's chords still reach it while the reader's focus is in the page.
      d.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape' || e.key === 'F1')) return;
        const again = new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true });
        if (!frame.dispatchEvent(again)) e.preventDefault();
      });
    }
    for (const img of d.images) img.addEventListener('load', fit);
    resize?.disconnect();
    resize = new ResizeObserver(fit);
    resize.observe(d.documentElement);
    if (d.body) resize.observe(d.body);
    fit();
  }
  frame.addEventListener('load', wire);

  return {
    el: frame,
    draw(page, loaded) {
      css = page.css;
      const body = withRemote(page.html, loaded);
      const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(policyOf(sourcesOf(loaded)))}"><meta name="referrer" content="no-referrer"></head><body>${body}</body></html>`;
      frame.srcdoc = doc;
    },
    destroy() {
      gone = true;
      resize?.disconnect();
      resize = null;
      hits?.remove();
      hits = null;
      frame.removeEventListener('load', wire);
    },
  };
}
