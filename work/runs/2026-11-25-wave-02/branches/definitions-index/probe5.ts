// Scratch: what the label hook costs a whole parse, and the one-line reload of the long reference, master against this branch.
import { readFileSync } from 'node:fs';
const fresh = 'C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const master = 'C:/Dev/reader/app/packages/core/src/parse/';
const now = await import(`file:///${fresh}parse.ts`);
const then = await import(`file:///${master}parse.ts`);
const nowRe = await import(`file:///${fresh}reparse.ts`);
const thenRe = await import(`file:///${master}reparse.ts`);

const bytes = new Uint8Array(readFileSync('C:/Dev/reader/worktrees/definitions-index/fixtures/corpus/32-long-reference.md'));
const median = (xs: number[]): number => xs.sort((a, b) => a - b)[xs.length >> 1]!;
const time = (f: () => unknown, n: number): number => {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    f();
    xs.push(performance.now() - t0);
  }
  return median(xs);
};
for (let round = 0; round < 2; round++) {
  console.log(`whole parse, 195 KB: master ${time(() => then.parseMarkdown(bytes, { file: '/r.md' }), 9).toFixed(0)} ms, branch ${time(() => now.parseMarkdown(bytes, { file: '/r.md' }), 9).toFixed(0)} ms`);
}
const text = new TextDecoder().decode(bytes);
const cut = new TextEncoder().encode(text.slice(0, text.indexOf('\n\n', 90_000) + 2)).length;
const line = new TextEncoder().encode('One line an outside editor wrote.\n\n');
const after = new Uint8Array(bytes.length + line.length);
after.set(bytes.subarray(0, cut));
after.set(line, cut);
after.set(bytes.subarray(cut), cut + line.length);
const prevThen = then.parseMarkdown(bytes, { file: '/r.md' });
const prevNow = now.parseMarkdown(bytes, { file: '/r.md' });
console.log(`one-line reload: master ${time(() => thenRe.reparseMarkdown(prevThen, bytes, after, { file: '/r.md' }), 9).toFixed(1)} ms (${thenRe.lastReparse().kind}), branch ${time(() => nowRe.reparseMarkdown(prevNow, bytes, after, { file: '/r.md' }), 9).toFixed(1)} ms (${nowRe.lastReparse().kind}, ${nowRe.lastReparse().parsed} bytes)`);
