// Module import rules (docs/design/00-architecture.md §Modules), enforced in one place for every
// package and the app. usage: node scripts/check-boundaries.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, walk, rel, stripComments, fail, fix } from './lib/repo.mjs';
import { readFileSync as rf } from 'node:fs';
const pending = JSON.parse(rf(join(ROOT, 'scripts/allowlists/dependencies.json'), 'utf8')).pendingRemoval || {};
const isTest = f => /\.(test|spec)\.[mc]?[jt]sx?$/.test(f) || /\/testing\//.test(f) || /\/scripts\//.test(f) || /\/test\//.test(f);
const NODE = /^node:|^(fs|path|os|child_process|crypto|url|util|stream|http|https|net|zlib|readline|worker_threads)$/;
const rules = [
  { under: 'packages/core/src/', forbid: [[/@tauri-apps/, 'core never sees the shell (ADR-0020)'], [/^@marxy\/(typeset|theme)/, 'core does not depend on typeset or theme'], [/^apps\//, 'core does not import the app'], [/^(markdown-it|dompurify|remark|rehype|shiki$)/, 'forbidden dependency (docs/design/README.md)']], forbidNode: true, forbidDom: true },
  { under: 'packages/typeset/src/', forbid: [[/@tauri-apps/, 'typeset never sees the shell'], [/^@marxy\/theme/, 'typeset reads tokens through computed styles, not the theme package']], forbidNode: true },
  { under: 'packages/theme/src/', forbid: [[/^@marxy\//, 'theme imports nothing from other packages'], [/@tauri-apps/, 'theme never sees the shell']], forbidNode: true },
  { under: 'packages/shell-api/src/', forbid: [[/^(?!\.)/, 'shell-api is types only; it imports nothing']], forbidNode: true },
  { under: 'apps/desktop/src/', except: 'apps/desktop/src/shell/', forbid: [[/@tauri-apps/, '@tauri-apps only under apps/desktop/src/shell (ADR-0010)'], [/^(markdown-it|dompurify)/, 'forbidden dependency']], forbidNode: true, forbidRawInvoke: true },
];
const files = walk(ROOT, f => /\.(m?[jt]sx?)$/.test(f) && /\/(packages|apps)\//.test(f));
const problems = [];
for (const f of files) {
  const r = rel(f); if (isTest(r)) continue;
  const rule = rules.find(x => r.startsWith(x.under) && !(x.except && r.startsWith(x.except))); if (!rule) continue;
  const text = stripComments(readFileSync(f, 'utf8'));
  const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?\bfrom\s+['"]([^'"]+)['"]/g), ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g), ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  for (const s of specs) {
    for (const [re, why] of rule.forbid) if (re.test(s)) { if (pending[s]) { console.warn(`· ${r}: imports "${s}", pending removal by ${pending[s]}`); continue; } problems.push(`${r}: imports "${s}" — ${why}${fix('move the code to the module that owns it, or report blocked')}`); }
    if (rule.forbidNode && NODE.test(s)) problems.push(`${r}: imports Node built-in "${s}" in browser code${fix('packages and the app run in the webview; use web APIs or the shell')}`);
  }
  if (rule.forbidDom && /\b(?:window|globalThis|navigator|localStorage|sessionStorage)\s*\.|\bdocument\s*\.\s*(?:querySelector|querySelectorAll|getElementById|createElement|createRange|body|fonts|documentElement)\b|\bnew\s+(?:DOMParser|Range|Highlight)\b/.test(text)) problems.push(`${r}: touches the DOM inside packages/core${fix('core is shell-free and DOM-free (ADR-0020); DOM work belongs in apps/desktop or packages/typeset')}`);
  if (rule.forbidRawInvoke && /\binvoke\s*(<[^>]*>)?\s*\(/.test(text)) problems.push(`${r}: calls the Tauri IPC function directly outside src/shell${fix('add a method to src/shell/tauri.ts and call that')}`);
}
if (fail(problems)) process.exit(1);
console.log(`boundaries ok (${files.length} source files)`);
