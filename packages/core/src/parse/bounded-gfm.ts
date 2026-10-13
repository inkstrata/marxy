// GFM with a bounded autolink literal (F-90).
//
// micromark-extension-gfm-autolink-literal asks, on every candidate character, whether an unclosed `[`
// (or `![`) sits earlier in the text (`previousUnbalanced`). When one does, its walk back over the events
// finds it but records nothing, so the next character walks the same distance again: a paragraph of n
// characters after one unclosed `[` costs n squared (80,000 characters took 23 s).
//
// The answer it reaches is the same every time until that label closes, so this remembers it. Before an
// autolink construct starts, a cached unclosed label token that is still in the events and still not
// balanced means "no autolink here", exactly the nok the extension would have returned after its walk. In
// every other case the construct runs untouched. Output is unchanged; only the repeated walk is skipped.

import { gfm } from 'micromark-extension-gfm';

type Extension = ReturnType<typeof gfm>;
type Construct = { name?: string; tokenize: (this: any, effects: any, ok: any, nok: any) => any } & Record<string, unknown>;

const AUTOLINK = new Set(['wwwAutolink', 'protocolAutolink', 'emailAutolink']);

interface Seen {
  index: number;
  token: { _balanced?: boolean };
}
// Keyed by the events array of one text tokenizer; dropped with it.
const unclosed = new WeakMap<object, Seen>();

type Event = [string, { type: string; _balanced?: boolean; _gfmAutolinkLiteralWalkedInto?: boolean }, unknown];

/** The same walk as the extension's `previousUnbalanced`, but it remembers a label it found. */
function openLabelBefore(events: Event[]): boolean {
  const seen = unclosed.get(events);
  if (seen && events[seen.index]?.[1] === seen.token && !seen.token._balanced) return true;
  let index = events.length;
  while (index--) {
    const token = events[index]![1];
    if ((token.type === 'labelLink' || token.type === 'labelImage') && !token._balanced) {
      unclosed.set(events, { index, token });
      return true;
    }
    if (token._gfmAutolinkLiteralWalkedInto) return false;
  }
  return false;
}

function bounded(construct: Construct): Construct {
  return {
    ...construct,
    tokenize(effects, ok, nok) {
      const inner = construct.tokenize.call(this, effects, ok, nok);
      return (code: unknown) => (openLabelBefore(this.events) ? nok(code) : inner(code));
    }
  };
}

/** `gfm()` with the autolink literal's repeated walk bounded. Same syntax, same events. */
export function boundedGfm(): Extension {
  const extension = gfm() as unknown as { text: Record<string, Construct | Construct[]> };
  for (const [code, value] of Object.entries(extension.text)) {
    const list = Array.isArray(value) ? value : [value];
    const wrapped = list.map((c) => (c.name !== undefined && AUTOLINK.has(c.name) ? bounded(c) : c));
    extension.text[code] = Array.isArray(value) ? wrapped : wrapped[0]!;
  }
  return extension as unknown as Extension;
}
