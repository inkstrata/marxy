// Random documents rich in footnotes, and chains of edits to them, for the differentials that hold a splice or a
// sliced render to the whole render.
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS = ['a', 'b', 'c', 'd', 'A', 'B', 'a b', 'A  B', 'long-one', 'z9'];
const WORDS = ['alpha', 'beta', 'gamma', '*stress*', '`code`', 'delta', '**bold**', 'eps', 'zeta'];

export function makeChain(seed: number, edits: number): { texts: string[]; ops: string[] } {
  const rnd = mulberry32(seed * 104729 + 17);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const label = () => pick(LABELS);
  const ref = () => `[^${label()}]`;
  const prose = (refs: number): string => {
    const out: string[] = [];
    const n = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) out.push(pick(WORDS));
    for (let i = 0; i < refs; i++) out.splice(Math.floor(rnd() * out.length), 0, ref());
    return out.join(' ');
  };
  const refCount = () => (rnd() < 0.4 ? 0 : rnd() < 0.7 ? 1 : 1 + Math.floor(rnd() * 3));
  const def = () => {
    const l = label();
    const style = rnd();
    const body = `${prose(rnd() < 0.2 ? 1 : 0)}`;
    if (style < 0.5) return `[^${l}]: ${body}`;
    if (style < 0.65) return `[^${l}]: ${body}\n    continued ${prose(0)}`;
    if (style < 0.75) return `[^${l}]: ${body}\n\n    second paragraph ${prose(rnd() < 0.3 ? 1 : 0)}`;
    if (style < 0.85) return `[^${l}]: ${body}\n\ninterrupting paragraph\n\n    indented after`;
    if (style < 0.9) return `[^${l}]: ${body}\nlazy line`;
    if (style < 0.95) return `[^${l}]: ${body} <span onclick="x()">kept</span> <script>no()</script>`;
    if (style < 0.97) return `[^${l}]: ![remote](http://example.com/a.png) ${body}`;
    return `[^${l}]: # ${pick(['heading in note', 'Same', 'Head'])}\n\n    - item ${ref()}`;
  };
  const block = () => {
    const r = rnd();
    if (r < 0.34) return prose(refCount());
    if (r < 0.52) return def();
    if (r < 0.58) return `> ${prose(refCount())}\n>\n> [^${label()}]: nested ${prose(0)}`;
    if (r < 0.63) return `> ${prose(refCount())}`;
    if (r < 0.69) return `- ${prose(refCount())}\n- [^${label()}]: in a list\n- ${prose(refCount())}`;
    if (r < 0.74) return `| h ${ref()} | k |\n|---|---|\n| ${prose(refCount())} | ${ref()} |`;
    if (r < 0.82) return `${'#'.repeat(1 + Math.floor(rnd() * 3))} ${pick(['Same', 'Head', 'Same'])} ${rnd() < 0.5 ? ref() : ''}`;
    if (r < 0.86) return '```\ncode [^a]\n```';
    if (r < 0.88) return '---';
    if (r < 0.9) return `<div class="x">raw ${ref()}</div>`;
    if (r < 0.902) return `<b>open ${prose(0)}`;
    if (r < 0.95) return `Term ${ref()}\n: not a dl`;
    return `${prose(1)}\n[^${label()}]: def right under a paragraph`;
  };
  const blocks: string[] = Array.from({ length: 12 + Math.floor(rnd() * 28) }, block);
  const isDef = (b: string): boolean => /^\[\^[^\]]+\]:/.test(b);
  const idx = (f: (b: string) => boolean): number => {
    const xs = blocks.map((b, i) => (f(b) ? i : -1)).filter((i) => i >= 0);
    return xs.length ? pick(xs) : -1;
  };
  const join = () => blocks.join(rnd() < 0.9 ? '\n\n' : '\n') + '\n';
  const texts = [join()];
  const ops: string[] = [];
  for (let e = 0; e < edits; e++) {
    const r = rnd();
    let op: string;
    if (r < 0.14) {
      op = 'prose';
      const i = idx((b: string) => !isDef(b) && !b.includes('[^') && !b.startsWith('<'));
      if (i >= 0) blocks[i] += ` ${pick(WORDS)}`;
    } else if (r < 0.26) {
      op = 'add-ref';
      const i = idx((b: string) => /^[a-z*`]/.test(b) && !isDef(b));
      if (i >= 0) blocks[i] += ` ${ref()}`;
    } else if (r < 0.36) {
      op = 'remove-ref';
      const i = idx((b: string) => !isDef(b) && /\[\^[^\]]+\]/.test(b));
      if (i >= 0) blocks[i] = blocks[i].replace(/\[\^[^\]]+\]/, '');
    } else if (r < 0.46) {
      op = 'edit-def';
      const i = idx(isDef);
      if (i >= 0) blocks[i] += rnd() < 0.5 ? ` ${pick(WORDS)}` : `\n    more ${pick(WORDS)}`;
    } else if (r < 0.56) {
      op = 'add-def';
      blocks.splice(Math.floor(rnd() * (blocks.length + 1)), 0, def());
    } else if (r < 0.64) {
      op = 'remove-def';
      const i = idx(isDef);
      if (i >= 0) blocks.splice(i, 1);
    } else if (r < 0.72) {
      op = 'reorder-def';
      const i = idx(isDef);
      if (i >= 0) {
        const [b] = blocks.splice(i, 1) as [string];
        blocks.splice(Math.floor(rnd() * (blocks.length + 1)), 0, b);
      }
    } else if (r < 0.8) {
      op = 'para-to-def';
      const i = idx((b: string) => /^[a-z]/.test(b) && !isDef(b));
      if (i >= 0) blocks[i] = `[^${label()}]: ${blocks[i]}`;
    } else if (r < 0.86) {
      op = 'def-to-para';
      const i = idx(isDef);
      if (i >= 0) blocks[i] = blocks[i].replace(/^\[\^[^\]]+\]: /, '');
    } else if (r < 0.9) {
      op = 'relabel-case';
      const i = idx(isDef);
      if (i >= 0) blocks[i] = blocks[i].replace(/^\[\^([^\]]+)\]/, (_m: string, l: string) => `[^${l === l.toUpperCase() ? l.toLowerCase() : l.toUpperCase()}]`);
    } else if (r < 0.95) {
      op = 'insert-block';
      blocks.splice(Math.floor(rnd() * (blocks.length + 1)), 0, block());
    } else {
      op = 'raw-char';
      const i = Math.floor(rnd() * blocks.length);
      const b = blocks[i]!;
      const at = Math.floor(rnd() * b.length);
      blocks[i] = b.slice(0, at) + pick([' [^a]', '[^', ']', '\n', ' x ', '[^b]:']) + b.slice(at);
    }
    ops.push(op);
    texts.push(join());
  }
  return { texts, ops };
}
