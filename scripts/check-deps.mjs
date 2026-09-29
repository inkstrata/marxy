// Every dependency in every manifest must be in scripts/allowlists/dependencies.json, and none may be forbidden.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, fix } from './lib/repo.mjs';

const DEP_INLINE = /^(?:target\.[^[\]]+\.)?(?:(?:build-|dev-)?dependencies)$/;
const DEP_TABLE = /^(?:target\.[^[\]]+\.)?(?:(?:build-|dev-)?dependencies)\.([a-zA-Z0-9_-]+)$/;

/** @param {string} relPath @param {string} toml @param {{ cargo: string[], forbidden: { cargo: string[] } }} allow */
export function cargoDependencyProblems(relPath, toml, allow) {
  const cargo = new Set(allow.cargo);
  const problems = [];
  const check = (n) => {
    if (allow.forbidden.cargo.includes(n)) problems.push(`${relPath}: crate "${n}" is forbidden`);
    else if (!cargo.has(n)) problems.push(`${relPath}: crate "${n}" is not in the allow-list${fix('add it to scripts/allowlists/dependencies.json (cargo) in this PR if a card names it')}`);
  };
  let inlineDeps = false;
  for (const line of toml.split('\n')) {
    const s = /^\[(.+)\]/.exec(line);
    if (s) {
      const section = s[1];
      const table = DEP_TABLE.exec(section);
      inlineDeps = false;
      if (table) check(table[1]);
      else if (DEP_INLINE.test(section)) inlineDeps = true;
      continue;
    }
    if (!inlineDeps) continue;
    const m = /^([a-zA-Z0-9_-]+)\s*=/.exec(line);
    if (!m) continue;
    check(m[1]);
  }
  return problems;
}

const allow = JSON.parse(readFileSync(join(ROOT, 'scripts/allowlists/dependencies.json'), 'utf8'));
const npm = new Set(allow.npm), cargo = new Set(allow.cargo), problems = [], pending = allow.pendingRemoval || {};
const manifests = ['package.json', ...['packages', 'apps'].flatMap(d => readdirSync(join(ROOT, d)).map(e => `${d}/${e}/package.json`))].filter(p => existsSync(join(ROOT, p)));
for (const p of manifests) { const j = JSON.parse(readFileSync(join(ROOT, p), 'utf8')); for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const n of Object.keys(j[k] || {})) { if (n.startsWith('@marxy/')) continue; if (pending[n]) console.warn(`· ${p}: "${n}" is pending removal by ${pending[n]}`); else if (allow.forbidden.npm.includes(n)) problems.push(`${p}: "${n}" is forbidden${fix('see docs/design/README.md; use the pinned alternative')}`); else if (!npm.has(n)) problems.push(`${p}: "${n}" is not in the allow-list${fix('if the design or card names it, add it to scripts/allowlists/dependencies.json in this PR; otherwise report blocked')}`); } }
for (const c of ['apps/desktop/src-tauri/Cargo.toml']) problems.push(...cargoDependencyProblems(c, readFileSync(join(ROOT, c), 'utf8'), allow));
if (fail(problems)) process.exit(1);
console.log(`deps ok (${manifests.length} manifests + Cargo.toml)`);
