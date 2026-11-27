// Folds on a data tree: one state for the tree's own folding (a branch's summary pressed, the
// cursor going into a closed branch), `z` on a node, `Z` and the depth commands. A depth folds every branch at that depth
// and below, as Source's "Fold to depth" does (depth 1: the top level's branches closed); a branch opened or closed by hand
// or by `z` after it keeps its own way. The state is the article's, in memory only, kept by each branch's path of keys, so
// it holds across a redraw of the tree (an edit, the file changed on disk); another file starts afresh.

const BRANCH = 'details.marxy-tree-branch';
const ROOT = '[data-marxy-reading="tree"]';

interface State {
  path: string | null;
  depth: number | null;
  own: Map<string, boolean>;
  applying: boolean;
  observer: MutationObserver | null;
  frame: number;
}

const states = new WeakMap<HTMLElement, State>();

/** The tree on `article`, or null when it shows none. */
export const treeRoot = (article: Element): HTMLElement | null => article.querySelector<HTMLElement>(ROOT);

/** How many branches hold `d`, inside the tree. */
function depthOf(d: Element, root: Element): number {
  let n = 0;
  for (let up = d.parentElement?.closest(BRANCH); up && root.contains(up); up = up.parentElement?.closest(BRANCH)) n++;
  return n;
}

/** A branch's path of keys from the tree's top: what it is found again by after a redraw. */
function keyOf(d: Element, root: Element): string {
  const steps: string[] = [];
  for (let at: Element | null = d; at && root.contains(at); at = at.parentElement?.closest(BRANCH) ?? null) {
    const key = at.querySelector(':scope > summary > .marxy-tree-key, :scope > summary > .marxy-tree-index');
    steps.unshift(key?.textContent ?? '?');
  }
  return steps.join('\u0000');
}

function stateFor(article: HTMLElement, path: string | null): State {
  let st = states.get(article);
  if (!st || st.path !== path) {
    st?.observer?.disconnect();
    st = { path, depth: null, own: new Map(), applying: false, observer: null, frame: 0 };
    states.set(article, st);
  }
  return st;
}

/** The state laid on the tree as it is drawn now. */
function apply(article: HTMLElement, st: State): void {
  const root = treeRoot(article);
  if (!root) return;
  st.applying = true;
  for (const d of root.querySelectorAll<HTMLDetailsElement>(BRANCH)) {
    const own = st.own.get(keyOf(d, root));
    const open = own ?? (st.depth === null ? null : depthOf(d, root) < st.depth - 1);
    if (open !== null && d.open !== open) d.open = open;
  }
  // `toggle` is sent after the task: what this pass opened or closed is not taken for a hand's.
  setTimeout(() => {
    st.applying = false;
  }, 0);
}

/**
 * A branch opened or closed by its summary, or by the cursor going into it, is the reader's own, whether or not the tree
 * was folded by a key first. `pathOf` names the file an article shows.
 */
export function installTreeFolds(pathOf: (article: HTMLElement) => string | null, signal: AbortSignal): void {
  if (typeof document === 'undefined') return;
  resolve = pathOf;
  // A branch drawn open says so with a `toggle` of its own: only one that follows a press on its summary is a hand's.
  let pressed: Element | null = null;
  document.addEventListener(
    'click',
    (e) => {
      const summary = e.target instanceof Element ? e.target.closest('summary') : null;
      pressed = summary?.parentElement?.matches(BRANCH) ? summary.parentElement : null;
    },
    { capture: true, signal },
  );
  document.addEventListener(
    'toggle',
    (e) => {
      if (e.target !== pressed || !(e.target instanceof HTMLDetailsElement)) return;
      pressed = null;
      branchSet(e.target, e.target.open);
    },
    { capture: true, signal },
  );
}

let resolve: (article: HTMLElement) => string | null = () => null;

/** Branch `d` opened or closed by the reader (its summary, or the cursor going into it): kept as its own way. */
export function branchSet(d: Element, open: boolean): void {
  const article = d.closest<HTMLElement>('.marxy-article');
  const root = article ? treeRoot(article) : null;
  if (!article || !root?.contains(d)) return;
  const st = stateFor(article, resolve(article));
  st.own.set(keyOf(d, root), open);
  follow(article, st);
}

function follow(article: HTMLElement, st: State): void {
  if (st.observer) return;
  st.observer = new MutationObserver((records) => {
    if (states.get(article) !== st || !records.some((r) => r.addedNodes.length > 0)) return;
    st.frame ||= requestAnimationFrame(() => {
      st.frame = 0;
      apply(article, st);
    });
  });
  st.observer.observe(article, { childList: true, subtree: true });
}

/** The tree folded to `depth` (1: its top level's branches closed), or every branch opened (null). */
export function foldTreeTo(article: HTMLElement, path: string | null, depth: number | null): void {
  const st = stateFor(article, path);
  st.own.clear();
  const root = treeRoot(article);
  // Opened all: the depth is past the deepest branch, so nothing folds.
  st.depth = depth ?? Number.MAX_SAFE_INTEGER;
  if (depth === null && root) for (const d of root.querySelectorAll<HTMLDetailsElement>(BRANCH)) d.open = true;
  follow(article, st);
  apply(article, st);
}

/** Whether `Z` has folded the tree: then `Z` again opens it. */
export function treeFolded(article: HTMLElement, path: string | null): boolean {
  const st = states.get(article);
  return st !== undefined && st.path === path && st.depth !== null && st.depth < Number.MAX_SAFE_INTEGER;
}

/** `z` on a branch: closed, or opened again. Returns the branch's new way, or null when `el` is no branch. */
export function toggleBranch(article: HTMLElement, path: string | null, el: Element): boolean | null {
  const root = treeRoot(article);
  if (!root || !(el instanceof HTMLDetailsElement) || !el.matches(BRANCH)) return null;
  const st = stateFor(article, path);
  follow(article, st);
  const open = !el.open;
  st.own.set(keyOf(el, root), open);
  apply(article, st);
  return open;
}
