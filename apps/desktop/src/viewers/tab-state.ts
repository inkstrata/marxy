// What a viewer remembers for its tab while the tab is open, and nowhere else: the image page's size, its ground under
// transparent pixels and its strip; a location shown; the card shown in place of an image; where a data tree is drawn
// from. Kept in memory only, never written: the fence holds (nothing kept of what was read), and a closed tab's state is
// never asked for again.
import { appHandle } from '../commands/app-handle.ts';
import { peekIntent } from '../frame/intent.ts';
import type { TreeFrom } from '@marxy/core/src/reading/tree.ts';

export interface TabState {
  /** `fit`, or a scale (1 is 100 %). Kept as the tab steps through the folder's images. */
  zoom: 'fit' | number;
  ground: 'checks' | 'light' | 'dark';
  /** Null until the folder is read: then on when it holds three or more images. */
  strip: boolean | null;
  /** Images whose location the reader asked to see, in this tab. */
  readonly revealed: Set<string>;
  /** Files shown as the file card and the bytes in place of their page, in this tab. */
  readonly asCard: Set<string>;
  /** A message's part shown in this tab, when the reader chose one. */
  readonly mailPart: Map<string, 'html' | 'text'>;
  /** A message's images from the network the reader asked for, in this tab only: path, then each image's address and its URL. */
  readonly remote: Map<string, Map<string, string>>;
  /** Messages whose headers the panel shows all of, as written. */
  readonly allHeaders: Set<string>;
  /** Where each data tree shown in this tab is drawn from (Draw from here); the top when a file has none. */
  readonly treeFrom: Map<string, TreeFrom>;
}

const byTab = new Map<string, TabState>();
const byPane = new WeakMap<Element, TabState>();

const fresh = (): TabState => ({
  zoom: 'fit',
  ground: 'checks',
  strip: null,
  revealed: new Set(),
  asCard: new Set(),
  mailPart: new Map(),
  remote: new Map(),
  allHeaders: new Set(),
  treeFrom: new Map(),
});

/**
 * The state of the tab that shows `path` in the pane at `host` (one per pane where there are no tabs, as in a harness
 * page). Asked while `path` is still landing, before the head has its tab: an open into the same tab (a step, Back) is
 * that tab's, a tab shown is its own, and a new tab starts fresh.
 */
export function tabState(host: Element, path: string): TabState {
  const handle = appHandle();
  const pane = handle?.panes().panes.find((p) => p.host === host);
  const tabs = pane ? handle?.frame?.()?.tabs.model : undefined;
  if (!tabs || !pane) {
    let s = byPane.get(host);
    if (!s) byPane.set(host, (s = fresh()));
    return s;
  }
  // The window's tab for the path, as this pane shows it: a tab already in the row keeps its state per pane.
  let tab = tabs.byPath(path);
  if (!tab) {
    const { how, tabId } = peekIntent(host, path);
    if (how === 'activate' && tabId !== undefined) tab = tabs.byId(tabId);
    else if (how === 'here' || how === 'back' || how === 'forward') tab = tabs.tabIn(pane.slot);
  }
  if (!tab) return fresh();
  const key = `${pane.slot}:${tab.id}`;
  let s = byTab.get(key);
  if (!s) byTab.set(key, (s = fresh()));
  return s;
}
