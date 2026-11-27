import { readFileSync, writeFileSync } from 'node:fs';
const p = 'C:/Dev/reader/worktrees/perf-record/scripts/measure-interactions.mjs';
let s = readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };
rep("import { buildRecord, formatCompare, formatTable, medians } from './lib/interactions-record.mjs';",
    "import { buildRecord, formatCompare, formatTable, medians, neutraliseDefinitions } from './lib/interactions-record.mjs';");
rep("import { dirname, join, resolve } from 'node:path';", "import { basename, dirname, join, resolve } from 'node:path';");
rep(`export const DOCUMENTS = {
  long: { file: 'fixtures/corpus/32-long-reference.md', path: '/demo/reading/long-reference.md', tab: 'long-reference.md' },
  short: { file: 'fixtures/demo/tidemark/docs/specs/incremental-indexing.md', path: '/demo/reading/short-document.md', tab: 'short-document.md' },
};`,
`export const DOCUMENTS = {
  'long-reference': { file: 'fixtures/corpus/32-long-reference.md', path: '/demo/reading/long-reference.md', tab: 'long-reference.md' },
  // Its 30 footnote definitions make an in-place page update give up and rebuild the page; with them
  // neutralised the same page can take the in-place path, which only the edit steps tell apart.
  'long-reference-plain': {
    file: 'fixtures/corpus/32-long-reference.md',
    transform: neutraliseDefinitions,
    path: '/demo/reading/long-reference-plain.md',
    tab: 'long-reference-plain.md',
    steps: ['open', 'undo', 'reload'],
  },
  'short-document': { file: 'fixtures/demo/tidemark/docs/specs/incremental-indexing.md', path: '/demo/reading/short-document.md', tab: 'short-document.md' },
};

/** The documents a run measures: the named ones, then each \`--doc\` file under its own name. */
export function documentsFor(o) {
  const out = {};
  for (const name of o.docs) out[name] = DOCUMENTS[name];
  for (const file of o.files) {
    const name = basename(file);
    if (name in out || name in DOCUMENTS) throw new Error(\`--doc \${file}: the name \${name} is already a document of the run\`);
    out[name] = { abs: resolve(file), path: \`/demo/reading/\${name}\`, tab: name };
  }
  return out;
}

const bytesOf = doc => {
  const raw = readFileSync(doc.abs ?? join(ROOT, doc.file));
  return doc.transform ? Buffer.from(doc.transform(raw.toString('utf8')), 'utf8') : raw;
};`);
rep("[--docs long,short]", "[--docs long-reference,short-document] [--doc <path>]");
rep("docs: Object.keys(DOCUMENTS), browser", "docs: null, files: [], browser");
rep("      case '--docs': o.docs = take().split(',').filter(Boolean); break;",
    "      case '--docs': o.docs = take().split(',').filter(Boolean); break;\n      case '--doc': o.files.push(take()); break;");
rep("  for (const d of o.docs) if (!(d in DOCUMENTS)) throw new Error(`--docs names ${Object.keys(DOCUMENTS).join(' and ')}, not ${d}`);\n  if (o.docs.length === 0) throw new Error('--docs names at least one document');",
    "  // Files given with --doc stand alone unless --docs also names some.\n  if (o.docs === null) o.docs = o.files.length ? [] : Object.keys(DOCUMENTS);\n  for (const d of o.docs) if (!(d in DOCUMENTS)) throw new Error(`--docs names ${Object.keys(DOCUMENTS).join(', ')}, not ${d}`);\n  if (o.docs.length + o.files.length === 0) throw new Error('--docs names at least one document');");
// header comments
rep("//   --docs a,b         `long` (195 KB), `short` (25 KB); default both\n",
    "//   --docs a,b         `long-reference` (195 KB), `long-reference-plain` (the same with its footnote and link definitions\n//                      escaped, so the page can be updated in place; open, undo and reload only) and `short-document`\n//                      (25 KB); default all three\n//   --doc <path>       also measure this file, under its own name (repeatable; alone, it replaces the default set)\n");
// measureDocument
rep("async function measureDocument(host, name, o, log) {\n  const doc = DOCUMENTS[name];\n  const bytes = readFileSync(join(ROOT, doc.file));",
    "async function measureDocument(host, name, doc, o, log) {\n  const bytes = bytesOf(doc);\n  const want = step => !doc.steps || doc.steps.includes(step);");
rep("  const click1 = await step('first click', () => click(s, 3));\n  if (click1) result.click = medians([click1]);\n\n  const k = await step('cursor keys', () => keys(s, o.keys));\n  if (k) result.key = medians(k);",
    "  const click1 = want('click') && (await step('first click', () => click(s, 3)));\n  if (click1) result.click = medians([click1]);\n\n  const k = want('key') && (await step('cursor keys', () => keys(s, o.keys)));\n  if (k) result.key = medians(k);");
rep("  const back = [];\n  const away = [];\n  await step('tabs', async () => {", "  const back = [];\n  const away = [];\n  if (want('tabBack')) await step('tabs', async () => {");
rep("  await step('Source and Read', async () => {", "  if (want('toRead')) await step('Source and Read', async () => {");
rep("    for (const name of o.docs) {\n      const doc = DOCUMENTS[name];\n      await warm.page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), c => c.charCodeAt(0))), [doc.path, readFileSync(join(ROOT, doc.file)).toString('base64')]);",
    "    for (const doc of Object.values(docs)) {\n      await warm.page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), c => c.charCodeAt(0))), [doc.path, bytesOf(doc).toString('base64')]);");
rep("    for (const name of o.docs) documents[name] = await measureDocument(host, name, o, log);",
    "    for (const [name, doc] of Object.entries(docs)) documents[name] = await measureDocument(host, name, doc, o, log);");
rep("      documents,\n    });", "      documents,\n      steps: Object.fromEntries(Object.entries(docs).map(([n, d]) => [n, d.steps ?? STEP_NAMES])),\n    });");
rep("import { buildRecord,", "import { STEPS, buildRecord,");
rep("const wait = ms =>", "const STEP_NAMES = STEPS.map(s => s.step);\nconst wait = ms =>");
rep("    host = await launch(o);", "    docs = documentsFor(o);\n    host = await launch(o);");
rep("  let host;\n  let record;", "  let host;\n  let record;\n  let docs;");
writeFileSync(p, s);
