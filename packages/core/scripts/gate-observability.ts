// What `scripts/gate-no-network.mjs` can see a sanitised document attempt, and what it structurally
// cannot (ADR-0009, MARXY-83). Playwright's interception sees a request; it never fires for a
// WebSocket handshake, a `dns-prefetch` hint or a service worker registration, because those are
// not requests the network layer makes on the page's behalf — they need a `<script>` or `<link>`
// element to exist first. The allow-list (`policy.ts`) is what stops that today, but a gate silent
// about what it cannot observe reads as a gate that observed everything, and the next person to
// widen the allow-list would have no reason to doubt it. This module is printed by the gate every
// run and its claims are proved, not merely asserted, in `unobservable-classes.test.ts`.

/** A shape of request the gate's interception genuinely sees fire. */
export const OBSERVED_REQUEST_CLASSES: readonly string[] = [
  'a stylesheet fetch (<link rel="stylesheet">)',
  'an image fetch (<img src>)',
  'a script fetch (<script src>)',
  'a fetch() call',
];

export interface UnobservableRequestClass {
  /** The name a reader would recognise, printed verbatim so a grep for it finds this record. */
  readonly name: string;
  /** The element or API a document needs before this class is reachable at all. */
  readonly requires: string;
  /** Why the allow-list refuses that element or API before the gate would ever need to see it. */
  readonly reason: string;
}

export const UNOBSERVABLE_REQUEST_CLASSES: readonly UnobservableRequestClass[] = [
  {
    name: 'WebSocket',
    requires: '<script>',
    reason: 'script is not in the allow-list; its contents never reach the DOM, so `new WebSocket(...)` never runs',
  },
  {
    name: 'dns-prefetch',
    requires: '<link rel="dns-prefetch">',
    reason: 'link is not in the allow-list; the element is refused whatever its rel is',
  },
  {
    name: 'service worker registration',
    requires: '<script>',
    reason: 'script is not in the allow-list; its contents never reach the DOM, so a service worker is never registered',
  },
];

/** Printed by the gate on every run, pass or fail (`gate-no-network.mjs`), and checked for the
 * three names by `unobservable-classes.test.ts` and by a static read of the gate's own source. */
export function formatObservabilityReport(): string {
  const observed = OBSERVED_REQUEST_CLASSES.join('; ');
  const unobservable = UNOBSERVABLE_REQUEST_CLASSES
    .map((c) => `${c.name} (needs ${c.requires}; refused by the allow-list, so this gate never has to see it — ${c.reason})`)
    .join('; ');
  return `no-network gate observes: ${observed}.\nno-network gate cannot observe: ${unobservable}.`;
}
