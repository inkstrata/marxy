// Images from the network in a sandboxed page, held back until the reader asks: a mail message's HTML part and an HTML
// file read as a page share this offer and its record. What was loaded is kept for the page in its tab only
// (`tabState().remote`), never written, and lets go when the tab closes. The fetch is the shell's (`remote.rs`), the
// app's only network code; nothing here reaches the network itself.
import { hostOf, type CleanedPage } from '@marxy/core/src/page/clean.ts';
import type { AppShell } from '../app-types.ts';
import { el, plural } from '../frame/dom.ts';
import { notify } from '../notices/index.ts';
import type { TabState } from './tab-state.ts';

/** Images fetched at once, and the most one click loads: the shell's store keeps 256 (of every page), the oldest let go first. */
const REMOTE_AT_ONCE = 4;
const REMOTE_MOST = 200;

export interface RemoteImagesOptions {
  readonly shell: AppShell;
  readonly path: string;
  /** The tab's state the loaded images are kept in. */
  readonly state: () => TabState;
  /** The cleaned page, or null when none is shown. */
  readonly page: () => CleanedPage | null;
  readonly pane: () => HTMLElement | undefined;
  /** What the page is, in the reader's words: `message` or `page`. */
  readonly noun: 'message' | 'page';
  /** Draw the page again (the offer and the frame); the panel follows. */
  readonly redraw: () => void;
  /** The page was closed while the images were fetched. */
  readonly gone: () => boolean;
  /** The page is on screen, or keeps a frame to draw into. */
  readonly shown: () => boolean;
}

export interface RemoteImages {
  /** The images the page would fetch, as `<img>`s: one each, in the order they come. */
  urls(): string[];
  /** Each loaded image's address and the shell's URL for it, or null when none were asked for. */
  loaded(): Map<string, string> | null;
  /** The offer above the page, or the line saying they were loaded; null when the page asks for none. */
  bar(): HTMLElement | null;
}

export function createRemoteImages(o: RemoteImagesOptions): RemoteImages {
  const { shell, path, noun } = o;
  let loading = false;
  let fetchNote = '';
  // Only an absolute web address is an image from the network the offer can load: a relative path, a `//host` one or
  // data stay as the page's account says.
  const urls = (): string[] => [...new Set((o.page()?.left.images ?? []).filter((i) => !i.css && /^https?:\/\//i.test(i.url)).map((i) => i.url))];
  const loaded = (): Map<string, string> | null => o.state().remote.get(path) ?? null;

  async function load(): Promise<void> {
    if (loading) return;
    const fetcher = shell.fetchRemoteImage?.bind(shell);
    if (!fetcher) {
      notify({ kind: 'refused', text: 'This build cannot fetch images from the network · nothing was sent.' }, { pane: o.pane() });
      return;
    }
    loading = true;
    o.redraw();
    const why: string[] = [];
    const asked: string[] = [];
    for (const url of urls()) {
      if (/^https:/i.test(url)) asked.push(url);
      // Only http reaches here: every other scheme is left out of the offer (`urls`).
      else why.push(`${hostOf(url)} over plain http is never loaded`);
    }
    const over = asked.splice(REMOTE_MOST);
    if (over.length > 0) why.push(`${plural(over.length, 'more image')} left alone: the app holds ${REMOTE_MOST} at a time`);
    const fetched: Array<string | null> = asked.map(() => null);
    let next = 0;
    const lane = async (): Promise<void> => {
      while (!o.gone() && next < asked.length) {
        const at = next++;
        const url = asked[at]!;
        try {
          fetched[at] = await fetcher(url);
        } catch (e) {
          why.push(`${hostOf(url)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REMOTE_AT_ONCE, asked.length) }, lane));
    loading = false;
    if (o.gone() || !o.shown()) return;
    const got = new Map<string, string>();
    asked.forEach((u, i) => {
      const src = fetched[i];
      if (src !== null && src !== undefined) got.set(u, src);
    });
    o.state().remote.set(path, got);
    fetchNote = why.length ? `${plural(why.length, 'image')} not loaded: ${why.join('; ')}.` : '';
    notify({ kind: 'info', transient: true, text: `Loaded for this ${noun} only, until its tab closes. Not remembered.` }, { pane: o.pane() });
    o.redraw();
  }

  function blockAgain(): void {
    o.state().remote.delete(path);
    fetchNote = '';
    notify({ kind: 'info', transient: true, text: 'Blocked again.' }, { pane: o.pane() });
    o.redraw();
  }

  function bar(): HTMLElement | null {
    const all = urls();
    if (all.length === 0) return null;
    const box = el('div', 'marxy-mail-remote');
    const words = el('p', 'marxy-mail-remote-words');
    if (loaded()) {
      box.dataset.marxyOn = '';
      words.append(
        noun === 'message'
          ? 'Images from the network, loaded for this message until its tab closes; not remembered for the sender or for other messages.'
          : 'Images from the network, loaded for this page until its tab closes; not remembered for other pages.',
      );
      if (fetchNote) words.append(' ', el('span', 'marxy-mail-quiet', fetchNote));
      const back = el('button', 'marxy-linkish', 'Block them again');
      back.type = 'button';
      back.addEventListener('click', blockAgain);
      box.append(words, back);
      return box;
    }
    const imgs = (o.page()?.left.images ?? []).filter((x) => !x.css && /^https?:\/\//i.test(x.url));
    const pixels = imgs.filter((x) => x.width > 0 && x.height > 0 && x.width <= 2 && x.height <= 2).length;
    const hosts = [...new Set(all.map(hostOf).filter(Boolean))];
    words.append(el('b', '', `${plural(all.length, 'image')} from the network ${all.length === 1 ? 'is' : 'are'} not loaded.`), ' ');
    if (pixels) words.append(`${pixels === 1 ? 'One is' : `${pixels} are`} 1 × 1 pixel, the size ${noun === 'message' ? 'senders use to learn that a message' : 'used to learn that a page'} was opened. `);
    words.append('Loading them tells ');
    hosts.forEach((h, i) => {
      if (i > 0) words.append(i === hosts.length - 1 ? ' and ' : ', ');
      words.append(el('code', '', h));
    });
    words.append(` that this ${noun} was read, and when.`);
    const button = el('button', 'marxy-btn', loading ? 'Loading…' : `Load them for this ${noun}`);
    button.type = 'button';
    button.disabled = loading;
    button.addEventListener('click', () => void load());
    box.append(words, button);
    return box;
  }

  return { urls, loaded, bar };
}
