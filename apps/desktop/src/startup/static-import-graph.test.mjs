// MARXY-33: static import walk from main.ts — the entry chunk must not pull grammars, KaTeX or CodeMirror.
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
const FORBIDDEN = [/^@shikijs\//, /^katex$/, /^katex\//, /^@codemirror\//];

/** Static ESM import/export-from specifiers in a module (not dynamic import()). */
export function staticImportSpecifiers(source) {
  const out = [];
  for (const m of source.matchAll(/(?:import|export)\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g)) {
    out.push(m[1]);
  }
  return out;
}

function resolveRelative(fromDir, spec) {
  if (!spec.startsWith('.')) return null;
  let path = join(fromDir, spec);
  if (!extname(path)) {
    for (const suffix of ['.ts', '.mts', '.js', '.mjs']) {
      const candidate = path + suffix;
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  return existsSync(path) ? path : null;
}

function resolveMarxyCore(corePkgDir, spec) {
  if (spec === '@marxy/core') return join(corePkgDir, 'src/index.ts');
  if (spec.startsWith('@marxy/core/')) {
    let path = join(corePkgDir, spec.slice('@marxy/core/'.length));
    if (!extname(path)) {
      for (const suffix of ['.ts', '.mts', '.js', '.mjs']) {
        const candidate = path + suffix;
        if (existsSync(candidate)) return candidate;
      }
      return null;
    }
    return existsSync(path) ? path : null;
  }
  return null;
}

function resolveModule(fromDir, spec, desktopSrcDir, corePkgDir) {
  const rel = resolveRelative(fromDir, spec);
  if (rel) return rel;
  return resolveMarxyCore(corePkgDir, spec);
}

function displayPath(abs, desktopSrcDir, corePkgDir) {
  if (abs.startsWith(desktopSrcDir)) return abs.slice(desktopSrcDir.length + 1);
  if (abs.startsWith(corePkgDir)) return `@marxy/core/${abs.slice(corePkgDir.length + 1)}`;
  return abs;
}

/** Depth-first walk of static imports from main.ts through desktop src and @marxy/core. */
export function forbiddenStaticImportsFromEntry(desktopSrcDir, entryRel = 'main.ts') {
  const corePkgDir = join(desktopSrcDir, '../../../packages/core');
  const hits = [];
  const queue = [join(desktopSrcDir, entryRel)];
  const seen = new Set();
  while (queue.length) {
    const abs = queue.pop();
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const dir = abs.slice(0, abs.lastIndexOf('/'));
    const rel = displayPath(abs, desktopSrcDir, corePkgDir);
    for (const spec of staticImportSpecifiers(text)) {
      if (FORBIDDEN.some((re) => re.test(spec))) hits.push({ from: rel, spec });
      const next = resolveModule(dir, spec, desktopSrcDir, corePkgDir);
      if (!next) continue;
      if (next.startsWith(desktopSrcDir) || next.startsWith(corePkgDir)) queue.push(next);
    }
  }
  return hits;
}
