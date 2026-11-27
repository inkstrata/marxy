// Ensures no copyleft or unlicensed Shiki grammar is imported and the desktop bundle does not embed one.
// Every grammar Shiki ships that is not on the allow-list is checked, not only the forbidden ones: a listed grammar's
// module imports the grammars it embeds (C++ imports GLSL), so the bundle is proved by what it holds, by each grammar's
// own definition (`"scopeName":"source.glsl"`), not by the import paths bundling erases.
//
// And that the grammars are in the build once: the highlight worker is their only reader, so no chunk that defines a
// grammar may be reachable from a page (its script, its preloads, and every import and dynamic import after them), and
// no grammar may be defined by two chunks.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** The scope names a built chunk defines as grammars, in either of the forms a bundle holds a grammar's JSON. */
export function grammarScopes(text) {
  return [...text.matchAll(/\\?"scopeName\\?":\\?"([^"\\]+)\\?"/g)].map((m) => m[1]);
}

/** Relative chunk specifiers in built JS: `from"./x"`, `import("./x")` and side-effect `import"./x"`. */
const chunkSpecs = (text) => [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{0,2}\/[^"']+)["']/g)].map((m) => m[1]);

/**
 * What is wrong with the grammars in a build's output: a chunk that defines one and is reachable from a page, or one
 * defined by two chunks. Each problem is one line of text; none means the build holds every grammar once, for the worker.
 */
export function grammarProblems(distDir) {
  const files = walk(distDir);
  const chunks = new Map(files.filter((f) => f.endsWith('.js')).map((f) => [resolve(f), readFileSync(f, 'utf8')]));
  const defined = new Map();
  for (const [file, text] of chunks) for (const scope of new Set(grammarScopes(text))) defined.set(scope, [...(defined.get(scope) ?? []), file]);
  const name = (f) => relative(distDir, f).replace(/\\/g, '/');
  const problems = [];
  for (const [scope, where] of defined) {
    if (where.length > 1) problems.push(`the grammar ${scope} is emitted ${where.length} times: ${where.map(name).join(', ')}`);
  }
  const queue = [];
  for (const html of files.filter((f) => f.endsWith('.html'))) {
    const text = readFileSync(html, 'utf8');
    const refs = [...text.matchAll(/<script[^>]+src="([^"]+)"/g), ...text.matchAll(/<link[^>]+href="([^"]+\.js)"/g)];
    for (const [, ref] of refs) queue.push({ file: resolve(dirname(html), ref), from: name(html) });
  }
  const seen = new Set();
  while (queue.length > 0) {
    const { file, from } = queue.pop();
    if (seen.has(file) || !chunks.has(file)) continue;
    seen.add(file);
    const text = chunks.get(file);
    if (grammarScopes(text).length > 0) problems.push(`${name(file)} defines a grammar and a page reaches it (from ${from})`);
    for (const spec of chunkSpecs(text)) queue.push({ file: resolve(dirname(file), decodeURIComponent(spec)), from: name(file) });
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const allowlist = JSON.parse(readFileSync(join(root, 'scripts/allowlists/shiki-languages.json'), 'utf8'));
  const forbidden = [...allowlist.forbiddenGrammars, ...(allowlist.unlicensedGrammars ?? [])];
  const allowed = new Set(allowlist.languages.map((l) => l.grammar));
  const highlightDir = join(root, 'packages/core/src/highlight');
  const sources = readdirSync(highlightDir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(highlightDir, f), 'utf8')).join('\n');

  for (const id of forbidden) {
    if (sources.includes(`'@shikijs/langs/${id}'`) || sources.includes(`"@shikijs/langs/${id}"`)) {
      console.error(`highlight bundle gate: forbidden grammar import ${id} in packages/core/src/highlight`);
      process.exit(1);
    }
  }

  /** Every grammar module Shiki ships that is not an alias: its name and the scope it defines. */
  const shippedGrammars = () => {
    // core's own link to the package (pnpm), whose exports name no package.json to resolve.
    const dist = join(root, 'packages/core/node_modules/@shikijs/langs/dist');
    const out = [];
    for (const file of readdirSync(dist)) {
      if (!file.endsWith('.mjs') || file === 'index.mjs') continue;
      const text = readFileSync(join(dist, file), 'utf8');
      const scope = /\\"scopeName\\":\\"([^"\\]+)\\"/.exec(text)?.[1];
      if (scope) out.push({ name: file.slice(0, -'.mjs'.length), scope });
    }
    return out;
  };

  const notAllowed = shippedGrammars().filter((g) => !allowed.has(g.name));
  for (const id of forbidden) {
    if (!notAllowed.some((g) => g.name === id)) {
      console.error(`highlight bundle gate: "${id}" is on a deny list but Shiki ships no grammar of that name; fix the list`);
      process.exit(1);
    }
  }

  const dist = join(root, 'apps/desktop/dist');
  if (existsSync(dist)) {
    const chunks = walk(dist).filter((f) => f.endsWith('.js'));
    const bundle = chunks.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const { name, scope } of notAllowed) {
      // A grammar is defined where its scopeName is declared; another grammar may still name the scope in an include.
      const needles = [`"scopeName":"${scope}"`, `\\"scopeName\\":\\"${scope}\\"`, `@shikijs/langs/${name}`];
      if (needles.some((needle) => bundle.includes(needle))) {
        console.error(`highlight bundle gate: dist embeds the grammar "${name}" (${scope}), which is not on the allow-list`);
        process.exit(1);
      }
    }
    const problems = grammarProblems(dist);
    if (problems.length > 0) {
      for (const p of problems) console.error(`highlight bundle gate: ${p}`);
      process.exit(1);
    }
    console.log(`highlight bundle gate: dist scanned (${chunks.length} chunks), none of the ${notAllowed.length} grammars off the allow-list present, every grammar once and none on a page's path`);
  } else {
    console.log('highlight bundle gate: no apps/desktop/dist; source import check only');
  }

  console.log('highlight bundle gate ok');
}
