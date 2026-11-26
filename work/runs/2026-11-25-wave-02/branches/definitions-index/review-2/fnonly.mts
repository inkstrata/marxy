const base = 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const { parseMarkdown } = await import(base + 'parse.ts');
const { reparseMarkdown, lastReparse } = await import(base + 'reparse.ts');
const fm = await import(base + 'from-mdast.ts');
const enc = new TextEncoder();
const pad = Array.from({ length: 40 }, (_, n) => `p${n}`).join('\n\n');
for (const body of ['[^1]: note\n', '[^1]: note\n\ntext\n', 'x[^1]\n\n[^1]: note\n']) {
  const a = enc.encode(`${body}\n${pad}\n`), b = enc.encode(`${body}\n${pad}!\n`);
  const prev = parseMarkdown(a, { file: '/f.md' });
  const idx = fm.definitionIndex(prev);
  const re = reparseMarkdown(prev, a, b, { file: '/f.md' });
  console.log(JSON.stringify(body), idx === 'unknown' ? 'UNKNOWN' : 'index ok', lastReparse().kind, JSON.stringify(re) === JSON.stringify(parseMarkdown(b, { file: '/f.md' })));
}
