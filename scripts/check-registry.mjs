// Names are the registry's, not the agent's (scripts/registry.json): marks, events, data attributes,
// class and token prefixes, and every route from a string to parsed markup. usage: node scripts/check-registry.mjs [--staged]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripCommentsAst } from './lib/imports.mjs';
import { ROOT, registry, walk, rel, stripComments, changedFiles, fail, fix } from './lib/repo.mjs';

/** Comments removed without mistaking `/*` or `//` inside a string, template or regex for one (AST for JS/TS). */
export const stripForRegistry = (text, fileName = 'file.ts') => (/\.[mc]?[jt]sx?$/.test(fileName) ? stripCommentsAst(text, fileName) : stripComments(text));

const KEY = '[\'"\\x60]';
const HTML_PROP = 'innerHTML|outerHTML|srcdoc';

/** Plain `=` or JS compound assignment (`+=`, `||=`, …) after optional whitespace. */
const HTML_ASSIGN_OP = String.raw`\s*(?:\*\*|<<|>>>|>>|[+\-*/%&|^]|&&|\|\||\?\?)?=(?![=>])`;

/** Routes from a string to parsed DOM; each { form, re } is one way around a single-regex gate. */
export const HTML_ROUTE_TABLE = [
  { form: '.innerHTML =', re: new RegExp(String.raw`\.innerHTML${HTML_ASSIGN_OP}`) },
  {
    form: '["innerHTML"] =',
    re: new RegExp(
      String.raw`\[\s*(?:${KEY}innerHTML${KEY}|${KEY}inner${KEY}\s*\+\s*${KEY}HTML${KEY})\s*\]${HTML_ASSIGN_OP}`,
    ),
  },
  {
    form: '["outerHTML"] =',
    re: new RegExp(
      String.raw`\[\s*(?:${KEY}(?:outerHTML|srcdoc)${KEY}|${KEY}outer${KEY}\s*\+\s*${KEY}HTML${KEY})\s*\]${HTML_ASSIGN_OP}`,
    ),
  },
  { form: '.srcdoc =', re: new RegExp(String.raw`\.srcdoc${HTML_ASSIGN_OP}`) },
  { form: "setAttribute('srcdoc', ...)", re: new RegExp(String.raw`setAttribute\s*\(\s*${KEY}srcdoc${KEY}`) },
  { form: '["insertAdjacentHTML"](', re: new RegExp(String.raw`\[\s*${KEY}(?:insertAdjacentHTML|setHTMLUnsafe|createContextualFragment|parseHTMLUnsafe)${KEY}\s*\]`) },
  { form: 'Object.assign(..., { innerHTML })', re: new RegExp(String.raw`Object\.assign\s*\([^;]{0,300}?[{,]\s*${KEY}?(?:${HTML_PROP})${KEY}?\s*[:,}]`) },
  { form: "Object.defineProperty(..., 'innerHTML')", re: new RegExp(String.raw`Object\.defineProperty\s*\(\s*[^,]+,\s*${KEY}(?:${HTML_PROP})${KEY}`) },
  { form: 'DOMParser', re: /\bnew\s+(?:[\w$]+\s*\.\s*)*DOMParser\b|\.parseFromString\s*\(|\[\s*['"`]parseFromString['"`]\s*\]/ },
  { form: '.parseHTMLUnsafe(', re: /\.parseHTMLUnsafe\s*\(/ },
  {
    form: "Reflect.set(..., 'innerHTML', ...)",
    re: new RegExp(String.raw`Reflect\.set\s*\(\s*[^,]+,\s*(?:${KEY}(?:${HTML_PROP})${KEY}|${KEY}inner${KEY}\s*\+\s*${KEY}HTML${KEY})\s*,`),
  },
  { form: '.outerHTML =', re: new RegExp(String.raw`\.outerHTML${HTML_ASSIGN_OP}`) },
  { form: '.insertAdjacentHTML(', re: /\.insertAdjacentHTML\s*\(/ },
  { form: '.setHTMLUnsafe(', re: /\.setHTMLUnsafe\s*\(/ },
  { form: 'document.write(', re: new RegExp(String.raw`\bdocument(?:\.write(?:ln)?\s*\(|\[\s*${KEY}write(?:ln)?${KEY}\s*\])`) },
  { form: '.createContextualFragment(', re: /\.createContextualFragment\s*\(/ },
];

/** Form names present in stripped source (for tests and the CLI). */
export function htmlRoutes(text) {
  return HTML_ROUTE_TABLE.filter(({ re }) => re.test(text)).map(({ form }) => form);
}

export function htmlRouteProblems(r, text, innerHtmlAllowedIn) {
  const allowed = innerHtmlAllowedIn.some(p => r === p || r.startsWith(p));
  if (allowed) return [];
  return htmlRoutes(text).map(
    form =>
      `${r}: ${form} outside innerHtmlAllowedIn${fix(
        'parsed markup only at sanitised render sites — see docs/design/README.md',
      )}`,
  );
}

/** Registry names must appear literally; assembling them evades the attribute scan (MARXY-229, P12). */
export function constructedRegistryNameProblems(rel, text) {
  const problems = [];
  if (/data-marxy-\$\{['"]/.test(text)) {
    problems.push(`${rel}: data-marxy-* attribute name built with a template literal${fix('spell the registered name literally, e.g. data-marxy-remote')}`);
  }
  if (/(?:['"]data-marxy-['"]\s*\+|['"]data-marxy-['"]\s*\.concat\s*\()/.test(text)) {
    problems.push(`${rel}: data-marxy-* attribute name built by concatenation${fix('spell the registered name literally')}`);
  }
  // `(?<!data-)` so `data-marxy-${'remote'}` is one finding, not also a generic marxy- hit.
  if (/(?<!data-)marxy-\$\{['"]/.test(text)) {
    problems.push(`${rel}: marxy-* name built with a template literal${fix('use a literal registered class or data attribute')}`);
  }
  if (/(?:['"]marxy-['"]\s*\+|['"]marxy-['"]\s*\.concat\s*\()/.test(text)) {
    problems.push(`${rel}: marxy-* name built by concatenation${fix('use a literal registered class or data attribute')}`);
  }
  return problems;
}

/** The `--marxy-*` names a file uses: whole names, and a name that ends in `-` where the rest is assembled (`--marxy-face-${n}`). */
export function customPropertiesIn(text) {
  return [...new Set([...text.matchAll(/--marxy-[a-z0-9]+(?:-[a-z0-9]+)*-?/g)].map(m => m[0]))];
}

const listedCovers = (listed, name) => listed.some(l => (l.endsWith('-') ? name.startsWith(l) : name === l));

/**
 * A `--marxy-*` custom property used in app or package source is a theme token (tokens.contract.json) or a private one
 * the registry lists (`customProperties`); a listed one that no source uses is stale. `used` maps a name to the first
 * file that uses it. A listed entry ending in `-` stands for a family whose names are assembled in code.
 */
export function customPropertyProblems(used, tokens, listed) {
  const problems = [];
  for (const [name, file] of used) {
    if (tokens.has(name) || listedCovers(listed, name)) continue;
    problems.push(`${file}: custom property "${name}" is neither a theme token nor in registry.customProperties${fix('add it to customProperties in scripts/registry.json, or use a theme token')}`);
  }
  for (const l of listed) {
    const inUse = [...used.keys()].some(name => (l.endsWith('-') ? name.startsWith(l) : name === l));
    if (!inUse) problems.push(`scripts/registry.json: customProperties lists "${l}", which no source in apps/desktop/src or packages/*/src uses${fix('remove it from customProperties')}`);
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
const reg = registry();
const staged = process.argv.includes('--staged');
const src = /\.(m?[jt]sx?|rs|css|html)$/;
// Design prototypes kept under docs/plan/<round>/ (mock*, galley, studio) are reference HTML, not the app.
// So are the project's agent skills under .claude/skills/ (a local review page is not shipped).
const prototype = /\/(marxy-spike|marxy-brainstorm)\/|\/docs\/plan\/[^/]+\/(mock[^/]*|galley|studio)\/|\/\.claude\/skills\//;
const files = (staged ? changedFiles({ staged: true }).map(f => join(ROOT, f)).filter(f => existsSync(f) && statSync(f).isFile() && !prototype.test(f)) : walk(ROOT, f => !prototype.test(f)))
  .filter(f => src.test(f) && !/\/scripts\/registry\.json$/.test(f) && !/fixtures\/corpus\//.test(f));
const problems = [];
const marks = new Set(reg.marks), events = new Set(reg.events), attrs = new Set(reg.dataAttributes);
for (const f of files) {
  const r = rel(f); const text = stripForRegistry(readFileSync(f, 'utf8'), f);
  const isTestFile = /\.(test|spec)\.[mc]?[jt]sx?$|\/testing\/|\/test\/|fixtures\//.test(r);
  for (const m of text.matchAll(/\bmark(?:_from_webview)?\(\s*['"`]([a-z_]+)['"`]/g)) if (!marks.has(m[1])) problems.push(`${r}: mark "${m[1]}" is not in scripts/registry.json${fix('add it to registry.marks in this PR, or use an existing mark')}`);
  for (const m of text.matchAll(/\b(?:emit|listen|once)\(\s*['"`](marxy:[a-z-]+)['"`]/g)) if (!events.has(m[1])) problems.push(`${r}: event "${m[1]}" is not in the registry${fix('add it to registry.events')}`);
  if (!isTestFile) for (const m of text.matchAll(/\b(data-marxy-[a-z-]+)/g)) if (!attrs.has(m[1])) problems.push(`${r}: attribute "${m[1]}" is not in the registry${fix('use one of ' + [...attrs].join(', ') + ' or add it with an ADR (data-marxy-s/e are contract, ADR-0023)')}`);
  if (!isTestFile) for (const m of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) for (const c of m[1].split(/\s+/).filter(Boolean)) if (!/^(?:marxy-[a-z0-9-]+|language-[A-Za-z0-9#+._-]+|cm-[a-z-]+|katex[a-z-]*)$/.test(c) && /^[a-z]/.test(c) && !c.includes('${')) problems.push(`${r}: class "${c}" must start with "marxy-" (or be a CodeMirror/KaTeX class)${fix('rename to marxy-<thing>')}`);
  for (const m of text.matchAll(/--([a-z][a-z0-9-]*)\s*:/g)) if (r.endsWith('.css') && !m[1].startsWith('marxy-') && !m[1].startsWith('lb') && !/^(cm|katex)/.test(m[1])) problems.push(`${r}: custom property "--${m[1]}" must be "--marxy-*" (contract) or a private "--lb"${fix('rename')}`);
  problems.push(...htmlRouteProblems(r, text, reg.innerHtmlAllowedIn));
  if (!isTestFile) problems.push(...constructedRegistryNameProblems(r, text));
}
// Custom properties: the whole tree, whatever --staged says, since "listed but used nowhere" is a fact about all of it.
{
  const tokens = new Set(JSON.parse(readFileSync(join(ROOT, 'packages/theme/tokens.contract.json'), 'utf8')).map(d => d.name));
  const used = new Map();
  const inScope = r => /^(?:apps\/desktop\/src|packages\/[^/]+\/src)\/.*\.(?:[mc]?[jt]sx?|css)$/.test(r) && !/\.(?:test|spec)\.[mc]?[jt]sx?$|\/(?:testing|test)\/|\/tokens\.css$/.test(r);
  for (const f of walk(ROOT, f => !prototype.test(f))) {
    const r = rel(f);
    if (!inScope(r)) continue;
    for (const name of customPropertiesIn(stripForRegistry(readFileSync(f, 'utf8'), f))) if (!used.has(name)) used.set(name, r);
  }
  problems.push(...customPropertyProblems(used, tokens, reg.customProperties ?? []));
}
if (fail(problems)) process.exit(1);
console.log(`registry ok (${files.length} files)`);
}
