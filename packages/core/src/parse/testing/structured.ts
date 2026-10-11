// Structured random documents (from B-23's review of #467), shared by the property tests that hold a second way
// of building a document to the first: the parse in slices (D-15) and the render in slices.

/** A small deterministic generator (mulberry32), so a failure names a seed that reproduces it. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BLOCKS: readonly string[] = [
  'para one\n', 'para two\nlazy line\n', '# H\n', 'Setext\n===\n', 'Setext2\n---\n', '---\n', '***\n',
  '```\ncode\n```\n', '~~~js\na\n\nb\n~~~\n', '    indented\n    code\n', '- a\n- b\n', '- a\n\n- b\n', '1. one\n2. two\n',
  '* x\n  cont\n', '> quote\nlazy\n', '> q\n>\n> q2\n', '| a | b |\n|---|---|\n| 1 | 2 |\n', '<div>\nhtml\n</div>\n',
  '<!--\ncomment\n\nstill\n-->\n', '<pre>\nx\n\ny\n</pre>\n', '<script>\na\n\nb\n</script>\n', '<?php\n\n?>\n', '<!X\n\n>\n',
  '<![CDATA[\n\n]]>\n', '<custom-el>\n', '$$\nx^2\n\ny\n$$\n', '- [ ] task\n- [x] done\n', 'text with $m$ and `c`\n',
  '- a\n  - b\n\n    c\n', '1) x\n\n   y\n', 'Term\n: def?\n', '\\\n', 'a  \nb\n', '<del>x</del>\n', 'www.example.com\n',
  '+ p\n+ q\n', '> - a\n> - b\n', '- > a\n  > b\n', '| x |\n|:-:|\n', 'a | b\n-|-\n',
  '1.   wide\n\n    under\n', '-\n\n    after empty\n', '2.\n', ' -    b\n',
];

export function generated(next: () => number): string {
  const blank = (): string => {
    const r = next();
    return r < 0.6 ? '\n' : r < 0.8 ? '' : r < 0.95 ? '\n\n' : '  \n';
  };
  let text = '';
  for (let count = 20 + Math.floor(next() * 60); count > 0; count--) text += BLOCKS[Math.floor(next() * BLOCKS.length)]! + blank();
  if (next() < 0.1) text = `---\na: 1\n---\n${text}`;
  if (next() < 0.05) text = `\ufeff${text}`;
  if (next() < 0.15) text = text.replace(/\n/g, '\r\n');
  return text;
}


/**
 * The cases a second road to the same bytes can get wrong (D-15's oracle): raw inline HTML left open across
 * blocks or never closed, a closer with no opener, an element the sanitiser takes to a later end tag,
 * footnotes and link definitions (which reach across the file), fences that never close, and the remote
 * images and scripts whose removals must come in the order a whole render gives them.
 */
export const HOSTILE_BLOCKS: readonly string[] = [
  '<b>open\n', 'text <i>x</i> and <u>y\n', 'a <span class="k">b\nc</span> d\n', '</b>\n', 'stray </em> closer\n',
  '<details>\n<summary>s</summary>\n\nbody\n\n</details>\n', 'inline <script>x\n', 'an <svg> open\n', 'a <style> open\n',
  'nested <b><i>x</b></i> wrongly\n', '<p>\nhtml paragraph\n', '</p>\n', 'a <br> and <img src=x onerror=y> here\n',
  'ref[^a]\n', '[^a]: note\n', '[^b]: note\n    more\n', 'twice[^a] and [^a]\n',
  '[ref]: http://example.com "t"\n', 'see [ref] and [other]\n', '[other]: <http://example.com/o>\n',
  '```js\nnever closed\n', '~~~\nopen\n', '````\nfour\n```\nstill\n',
  '![x](https://example.com/a.png)\n', '![y](https://example.org/b.png "t")\n', '[x](javascript:alert(1))\n',
  '<img src="https://example.com/c.png">\n', '<script>alert(1)</script>\n', '<iframe src="x"></iframe>\n',
  'a <p> b\n', '# h <h1> x\n', 'item <li> y\n', '| a <td> | b |\n|---|---|\n| 1 | 2 |\n',
  '# Same\n', '# Same\n', '## Same\n', '> <b>quote open\n', '- item <i>open\n- next</i>\n',
];

/** `generated` with the hostile blocks among them, a quarter of the time, and sometimes a front matter that never closes. */
export function generatedHostile(next: () => number): string {
  const blank = (): string => {
    const r = next();
    return r < 0.6 ? '\n' : r < 0.8 ? '' : r < 0.95 ? '\n\n' : '  \n';
  };
  let text = '';
  for (let count = 20 + Math.floor(next() * 80); count > 0; count--) {
    const pool = next() < 0.3 ? HOSTILE_BLOCKS : BLOCKS;
    text += pool[Math.floor(next() * pool.length)]! + blank();
  }
  const r = next();
  if (r < 0.08) text = `---\na: 1\n---\n${text}`;
  else if (r < 0.12) text = `---\na: 1\n\n${text}`; // front matter that never closes
  else if (r < 0.14) text = `+++\na = 1\n+++\n${text}`;
  if (next() < 0.05) text = `﻿${text}`;
  if (next() < 0.15) text = text.replace(/\n/g, '\r\n');
  return text;
}
