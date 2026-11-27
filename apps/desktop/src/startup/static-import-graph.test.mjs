// static import walk from main.ts — the entry chunk must not pull grammars, KaTeX or CodeMirror.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
const FORBIDDEN = [/^@shikijs\//, /^katex$/, /^katex\//, /^@codemirror\//];

/**
 * Static ESM import/export-from specifiers in a module (not dynamic import()). `import type` and `export type` are left
 * out: TypeScript erases them, so they put nothing in the chunk.
 */
export function staticImportSpecifiers(source) {
  const out = [];
  for (const m of source.matchAll(/(?:import|export)\s+(type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g)) {
    if (!m[1]) out.push(m[2]);
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

/** Whether `abs` is `dir` or inside it; `dir` may end in a separator or not (fileURLToPath of a folder URL does). */
function inside(abs, dir) {
  const r = relative(dir, abs);
  return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && !/^[a-zA-Z]:/.test(r));
}

function displayPath(abs, desktopSrcDir, corePkgDir) {
  if (inside(abs, desktopSrcDir)) return relative(desktopSrcDir, abs).split(sep).join('/');
  if (inside(abs, corePkgDir)) return `@marxy/core/${relative(corePkgDir, abs).split(sep).join('/')}`;
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
    // dirname, not a split on '/': on Windows the paths use '\\', and a split on '/' stopped the walk at main.ts.
    const dir = dirname(abs);
    const rel = displayPath(abs, desktopSrcDir, corePkgDir);
    for (const spec of staticImportSpecifiers(text)) {
      if (FORBIDDEN.some((re) => re.test(spec))) hits.push({ from: rel, spec });
      const next = resolveModule(dir, spec, desktopSrcDir, corePkgDir);
      if (!next) continue;
      if (inside(next, desktopSrcDir) || inside(next, corePkgDir)) queue.push(next);
    }
  }
  return hits;
}
