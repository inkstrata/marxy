// One parse, one sanitiser (ADR-0001, ADR-0021): leftover markdown-it / DOMPurify must not return,
// desktop and scripts render through @marxy/core, and docs/plan.md keeps naming mdast/micromark.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, walk, fail, fix } from './lib/repo.mjs';

/** Names this story removed. A return in any manifest or the lockfile is a second parser. */
export const LEFTOVER_DEPENDENCIES = [
  'markdown-it',
  'dompurify',
  '@types/markdown-it',
  '@types/dompurify',
];

const LEFTOVER_DEP = /^(markdown-it(?:-[A-Za-z0-9._-]*)?|dompurify|@types\/markdown-it|@types\/dompurify)$/;
const LEFTOVER_IMPORT = /^(markdown-it(?:\/|$|-)|dompurify(?:\/|$)|@types\/(?:markdown-it|dompurify)|isomorphic-dompurify|sanitize-html|xss|rehype-sanitize|marked(?:\/|$)|showdown|remark(?:-|$)|rehype(?:-|$)|unified(?:\/|$))/;
const SOURCE = /\.(m?[jt]sx?|cjs)$/;
const SCAN_UNDER = ['apps/desktop/src', 'scripts'];

export function leftoverDependencyName(name) {
  return LEFTOVER_DEP.test(name) ? name : null;
}

export function leftoverImportSpecifier(specifier) {
  if (specifier === '@marxy/core' || specifier.startsWith('@marxy/core/')) return null;
  if (/(^|\/)packages\/core(\/|$)/.test(specifier)) return null;
  return LEFTOVER_IMPORT.test(specifier) ? specifier : null;
}

export function leftoverDependenciesInManifest(manifest) {
  const found = [];
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[key] || {})) {
      const hit = leftoverDependencyName(name);
      if (hit) found.push(hit);
    }
  }
  return found;
}

export function leftoverDependenciesInLockfile(text) {
  const found = new Set();
  for (const match of text.matchAll(/(?:^|[\s"'/])(@types\/(?:markdown-it|dompurify)|markdown-it(?:-[A-Za-z0-9._-]*)?|dompurify)(?=@|:|'|"|\s|$)/gm)) {
    found.add(match[1]);
  }
  return [...found];
}

export function leftoverImportsInSource(text) {
  const specs = [
    ...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?\bfrom\s+['"]([^'"]+)['"]/g),
    ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(m => m[1]);
  return specs.map(leftoverImportSpecifier).filter(Boolean);
}

export function planNamesOneParse(text) {
  return /mdast/.test(text) && /micromark/.test(text) && !/markdown-it/i.test(text);
}

export function manifestsUnder(root) {
  const out = ['package.json'];
  for (const dir of ['packages', 'apps']) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      const rel = `${dir}/${entry}/package.json`;
      if (existsSync(join(root, rel))) out.push(rel);
    }
  }
  return out;
}

export function check(root = ROOT) {
  const problems = [];
  for (const rel of manifestsUnder(root)) {
    const hits = leftoverDependenciesInManifest(JSON.parse(readFileSync(join(root, rel), 'utf8')));
    for (const name of hits) {
      problems.push(`${rel}: leftover parser/sanitiser dependency "${name}"${fix('remove it; render through @marxy/core')}`);
    }
  }
  const lock = join(root, 'pnpm-lock.yaml');
  if (existsSync(lock)) {
    for (const name of leftoverDependenciesInLockfile(readFileSync(lock, 'utf8'))) {
      problems.push(`pnpm-lock.yaml: leftover parser/sanitiser "${name}"${fix('drop it from every package.json and run pnpm install')}`);
    }
  }
  for (const under of SCAN_UNDER) {
    const dir = join(root, under);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, f => SOURCE.test(f) && !/\.(test|spec)\.[mc]?[jt]sx?$/.test(f))) {
      const rel = relative(root, file);
      for (const spec of leftoverImportsInSource(readFileSync(file, 'utf8'))) {
        problems.push(`${rel}: imports leftover parser/sanitiser "${spec}"${fix('import renderSafeHtml from @marxy/core instead')}`);
      }
    }
  }
  const plan = join(root, 'docs/plan.md');
  if (!existsSync(plan) || !planNamesOneParse(readFileSync(plan, 'utf8'))) {
    problems.push(`docs/plan.md must name mdast/micromark and must not name markdown-it${fix('keep the ADR-0021 wording; do not reintroduce markdown-it')}`);
  }
  return problems;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], `file://${process.cwd()}/`));
if (invoked) {
  const problems = check();
  if (fail(problems)) process.exit(1);
  console.log('one-parse ok (no leftover markdown-it/DOMPurify; plan names mdast/micromark)');
}
