// What an open asked for, carried from the call to the pane that lands it. An open that says nothing is `fallback`
// (Settings: open files in a new tab, or in this tab). An intent is for one path and goes stale quickly, so a refused
// open never steers a later one.
import type { OpenHow } from './tabs.ts';

interface Intent {
  readonly path: string;
  readonly how: OpenHow;
  readonly tabId?: number;
  readonly at: number;
}

const STALE_MS = 15_000;
const pending = new Map<Element, Intent>();
let fallback: OpenHow = 'new';

export function intend(host: Element, path: string, how: OpenHow, tabId?: number): void {
  pending.set(host, { path, how, tabId, at: Date.now() });
}

/** The intent for `path` in the pane at `host`, used up; the fallback when there is none. */
export function takeIntent(host: Element, path: string): { readonly how: OpenHow; readonly tabId?: number } {
  const intent = pending.get(host);
  pending.delete(host);
  if (!intent || intent.path !== path || Date.now() - intent.at > STALE_MS) return { how: fallback };
  return intent;
}

/** The intent for `path` in the pane at `host`, left in place for the head to take: what a page drawn before its tab lands reads. */
export function peekIntent(host: Element, path: string): { readonly how: OpenHow; readonly tabId?: number } {
  const intent = pending.get(host);
  if (!intent || intent.path !== path || Date.now() - intent.at > STALE_MS) return { how: fallback };
  return intent;
}

export function setOpenFallback(how: 'new' | 'here'): void {
  fallback = how;
}
