// Module import rules (docs/design/00-architecture.md §Modules), enforced in one place for every
// package and the app. usage: node scripts/check-boundaries.mjs
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

/** import()/require() specs from quoted strings and plain template literals (no `${}`). */
export function dynamicImportSpecs(text) {
  const quoted = [
    ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  // Interpolated `` import(`pkg/${x}`) `` cannot be resolved statically; not matched when `${` appears.
  const templated = [
    ...text.matchAll(/\bimport\(\s*`([^`]+)`\s*\)/g),
    ...text.matchAll(/\brequire\(\s*`([^`]+)`\s*\)/g),
  ].filter(m => !m[1].includes('${'));
  return [...quoted, ...templated].map(m => m[1]);
}

function moduleImportSpecs(stripped) {
  return [
    ...stripped.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?\bfrom\s+['"]([^'"]+)['"]/g),
  ].map(m => m[1]).concat(dynamicImportSpecs(stripped));
}

export function boundaryProblemsFor(relPath, text, pendingRemoval = pending, warnPending = () => {}) {
  const rule = rules.find(x => relPath.startsWith(x.under) && !(x.except && relPath.startsWith(x.except)));
  if (!rule) return [];
  const stripped = stripComments(text);
  const problems = [];
  for (const s of moduleImportSpecs(stripped)) {
    for (const [re, why] of rule.forbid) {
      if (re.test(s)) {
        if (pendingRemoval[s]) {
          warnPending(`· ${relPath}: imports "${s}", pending removal by ${pendingRemoval[s]}`);
          continue;
        }
        problems.push(`${relPath}: imports "${s}" — ${why}${fix('move the code to the module that owns it, or report blocked')}`);
      }
    }
    if (rule.forbidNode && NODE.test(s)) {
      problems.push(`${relPath}: imports Node built-in "${s}" in browser code${fix('packages and the app run in the webview; use web APIs or the shell')}`);
    }
  }
  if (rule.forbidDom && /\b(?:window|globalThis|navigator|localStorage|sessionStorage)\s*\.|\bdocument\s*\.\s*(?:querySelector|querySelectorAll|getElementById|createElement|createRange|body|fonts|documentElement)\b|\bnew\s+(?:DOMParser|Range|Highlight)\b/.test(stripped)) {
    problems.push(`${relPath}: touches the DOM inside packages/core${fix('core is shell-free and DOM-free (ADR-0020); DOM work belongs in apps/desktop or packages/typeset')}`);
  }
  if (rule.forbidRawInvoke && /\binvoke\s*(<[^>]*>)?\s*\(/.test(stripped)) {
    problems.push(`${relPath}: calls the Tauri IPC function directly outside src/shell${fix('add a method to src/shell/tauri.ts and call that')}`);
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const files = walk(ROOT, f => /\.(m?[jt]sx?)$/.test(f) && /\/(packages|apps)\//.test(f));
  const problems = [];
  for (const f of files) {
    const r = rel(f);
    if (isTest(r)) continue;
    problems.push(...boundaryProblemsFor(r, readFileSync(f, 'utf8'), pending, msg => console.warn(msg)));
  }
  if (fail(problems)) process.exit(1);
  console.log(`boundaries ok (${files.length} source files)`);
}
