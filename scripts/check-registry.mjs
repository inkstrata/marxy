// Names are the registry's, not the agent's (scripts/registry.json): marks, events, data attributes,
// class and token prefixes, and where innerHTML may be assigned. usage: node scripts/check-registry.mjs [--staged]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, registry, walk, rel, stripComments, changedFiles, fail, fix } from './lib/repo.mjs';
const reg = registry();
const staged = process.argv.includes('--staged');
const src = /\.(m?[jt]sx?|rs|css|html)$/;
const files = (staged ? changedFiles({ staged: true }).map(f => join(ROOT, f)).filter(f => existsSync(f) && statSync(f).isFile()) : walk(ROOT, f => !/\/(marxy-spike|marxy-brainstorm)\//.test(f)))
  .filter(f => src.test(f) && !/\/scripts\/registry\.json$/.test(f) && !/fixtures\/corpus\//.test(f));
const problems = [];
const marks = new Set(reg.marks), events = new Set(reg.events), attrs = new Set(reg.dataAttributes);
for (const f of files) {
  const r = rel(f); const text = stripComments(readFileSync(f, 'utf8'));
  const isTestFile = /\.(test|spec)\.[mc]?[jt]sx?$|\/testing\/|\/test\/|fixtures\//.test(r);
  for (const m of text.matchAll(/\bmark(?:_from_webview)?\(\s*['"`]([a-z_]+)['"`]/g)) if (!marks.has(m[1])) problems.push(`${r}: mark "${m[1]}" is not in scripts/registry.json${fix('add it to registry.marks in this PR, or use an existing mark')}`);
  for (const m of text.matchAll(/\b(?:emit|listen|once)\(\s*['"`](marxy:[a-z-]+)['"`]/g)) if (!events.has(m[1])) problems.push(`${r}: event "${m[1]}" is not in the registry${fix('add it to registry.events')}`);
  if (!isTestFile) for (const m of text.matchAll(/\b(data-marxy-[a-z-]+)/g)) if (!attrs.has(m[1])) problems.push(`${r}: attribute "${m[1]}" is not in the registry${fix('use one of ' + [...attrs].join(', ') + ' or add it with an ADR (data-marxy-s/e are contract, ADR-0023)')}`);
  if (!isTestFile) for (const m of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) for (const c of m[1].split(/\s+/).filter(Boolean)) if (!/^(?:marxy-[a-z0-9-]+|language-[A-Za-z0-9#+._-]+|cm-[a-z-]+|katex[a-z-]*)$/.test(c) && /^[a-z]/.test(c) && !c.includes('${')) problems.push(`${r}: class "${c}" must start with "marxy-" (or be a CodeMirror/KaTeX class)${fix('rename to marxy-<thing>')}`);
  for (const m of text.matchAll(/--([a-z][a-z0-9-]*)\s*:/g)) if (r.endsWith('.css') && !m[1].startsWith('marxy-') && !m[1].startsWith('lb') && !/^(cm|katex)/.test(m[1])) problems.push(`${r}: custom property "--${m[1]}" must be "--marxy-*" (contract) or a private "--lb"${fix('rename')}`);
  if (/\.innerHTML\s*=/.test(text) && !reg.innerHtmlAllowedIn.some(p => r === p || r.startsWith(p))) problems.push(`${r}: innerHTML assignment outside the allowed render sites${fix('build DOM with createElement/textContent; innerHTML is only for the sanitised render (docs/design/README.md)')}`);
}
if (fail(problems)) process.exit(1);
console.log(`registry ok (${files.length} files)`);
