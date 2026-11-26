import { grammarProblems, grammarScopes } from 'file:///C:/Dev/reader/worktrees/grammars-once/scripts/gate-highlight-bundle.mjs';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const d = process.argv[2];
const a = join(d, 'assets');
const js = readdirSync(a).filter(f => f.endsWith('.js'));
let bytes = 0; for (const f of js) bytes += statSync(join(a, f)).size;
console.log('js files', js.length, 'bytes', bytes);
const names = new Map(); for (const f of js) { const n = f.replace(/-[\w-]{8}\.js$/, ''); names.set(n, [...(names.get(n) ?? []), f]); }
for (const [n, fs] of names) if (fs.length > 1) console.log('dup', n, fs.map(f => `${f}:${statSync(join(a,f)).size}`).join(' '));
const fonts = readdirSync(a).filter(f => /KaTeX/.test(f)); console.log('katex fonts', fonts.length, fonts.filter(f=>!f.endsWith('.woff2')));
let grammarChunks = 0; for (const f of js) if (grammarScopes(readFileSync(join(a,f),'utf8')).length) grammarChunks++;
console.log('chunks defining grammars', grammarChunks);
const p = grammarProblems(d); console.log('problems', p.length, p.slice(0,5));
