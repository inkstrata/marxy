// Scratch: the new parseMarkdown (with the label hook) gives exactly master's parse, over the corpus,
// the conformance cases and many generated documents with definitions and references.
import { readFileSync, readdirSync } from 'node:fs';
const fresh = 'C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const master = 'C:/Dev/reader/app/packages/core/src/parse/';
const { parseMarkdown: now } = await import(`file:///${fresh}parse.ts`);
const { parseMarkdown: then } = await import(`file:///${master}parse.ts`);
const { BLOCKS, HOSTILE_BLOCKS, generatedHostile, random } = await import(`file:///${fresh}testing/structured.ts`);

let compared = 0;
const same = (input: string | Uint8Array, where: string): void => {
  compared++;
  const a = JSON.stringify(now(input, { file: '/x.md' }));
  const b = JSON.stringify(then(input, { file: '/x.md' }));
  if (a !== b) {
    console.log(`DIFFERS: ${where}`, JSON.stringify(typeof input === 'string' ? input.slice(0, 200) : ''));
    process.exitCode = 1;
  }
};
const dir = 'C:/Dev/reader/worktrees/definitions-index/fixtures/corpus/';
for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) same(new Uint8Array(readFileSync(dir + name)), name);

const DEFS = [
  '[foo]: http://f.example\n', '[Foo]: http://second.example "dup"\n', "[ bar\tbaz ]: </b b> 't'\n", '[img]:\n  /i.png\n',
  '> [quoted]: /q\n', '- [listed]: /l\n', '[^n]: a note\n', '[^N]: caps\n', '> [^q]: q\n', '[^m]: a\n\n    b\n',
  'See [foo], [Foo][], [x][bar baz], ![i][img], [quoted] and [nope].\n', 'Notes[^n] [^m] [^q] [^missing] ![^n] [^n][foo]\n',
  '[foo][^n] [^n]: inline? [x]: y\n', '[\\]]: /esc\n', 'see [\\]] and [a\\]b]\n', '[a\nb]: /two-lines\n\n[a b]\n',
  '[ü]: /u\n\n[Ü] [SS] [ß]\n\n[ß]: /sz\n', '[^ß]: n\n\nx[^SS] y[^ß]\n', '*[foo]*\n', '[foo]: /a\n===\n', 'p\n[foo]: /not\n',
];
for (let seed = 1; seed <= 3000; seed++) {
  const next = random(seed);
  let text = '';
  for (let count = 5 + Math.floor(next() * 40); count > 0; count--) {
    const r = next();
    const pool = r < 0.4 ? DEFS : r < 0.6 ? HOSTILE_BLOCKS : BLOCKS;
    text += pool[Math.floor(next() * pool.length)] + (next() < 0.7 ? '\n' : '');
  }
  same(text, `seed ${seed}`);
  if (seed % 3 === 0) same(generatedHostile(random(seed + 100000)), `hostile ${seed}`);
}
console.log(`compared ${compared} parses with master's`);
