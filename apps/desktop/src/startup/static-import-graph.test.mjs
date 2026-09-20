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

/** Depth-first walk of relative static imports under apps/desktop/src. */
export function forbiddenStaticImportsFromEntry(desktopSrcDir, entryRel = 'main.ts') {
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
    const rel = abs.slice(desktopSrcDir.length + 1);
    for (const spec of staticImportSpecifiers(text)) {
      if (FORBIDDEN.some((re) => re.test(spec))) hits.push({ from: rel, spec });
      const next = resolveRelative(dir, spec);
      if (next?.startsWith(desktopSrcDir)) queue.push(next);
    }
  }
  return hits;
}
