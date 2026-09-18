// Generators, so every new unit starts in the house shape. usage:
//   pnpm new module <package> <name>        packages/<package>/src/<name>/{index.ts,<name>.test.ts}
//   pnpm new operation <id> "<Title>"       packages/core/src/operations/<id>.ts + test table (+ index registration)
//   pnpm new command <snake_name>           a Rust command file + the TypeScript binding snippet to paste
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, storyKey } from './lib/repo.mjs';
const [kind, a, b] = process.argv.slice(2); const key = storyKey() || 'MARXY-n';
const header = (what, adr) => `// ${what} (${adr}). Story ${key}.\n`;
const write = (rel, text) => { const p = join(ROOT, rel); if (existsSync(p)) { console.error(`exists: ${rel}`); process.exit(1); } mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); console.log(`created ${rel}`); };
if (kind === 'module' && a && b) {
  const name = b.toLowerCase(); const dir = `packages/${a}/src/${name}`;
  write(`${dir}/index.ts`, header(`${name}: TODO one line saying what this module is responsible for`, 'ADR-00nn') + `\nexport {};\n`);
  write(`${dir}/${name}.test.ts`, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as mod from './index.ts';\n\ntest('${name} exports its public surface', () => {\n  assert.ok(Object.keys(mod).length > 0, 'export something from ${dir}/index.ts');\n});\n`);
} else if (kind === 'operation' && a && b) {
  const id = a.toLowerCase(); const ident = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  write(`packages/core/src/operations/${id}.ts`, header(`Operation "${b}"`, 'ADR-0004') + `import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';\n\n/** ${b}. Pure: text in, text out; never touches bytes outside input.range. */\nexport const ${ident}: Operation = {\n  id: '${id}',\n  title: '${b}',\n  appliesTo: ['block'],\n  canApply(input) {\n    return input.node !== undefined; // TODO: the node types this applies to (docs/design/03-selection-and-operations.md)\n  },\n  run(input: OperationInput): OperationResult {\n    return { replacement: input.text }; // TODO\n  },\n};\n`);
  write(`packages/core/src/operations/${id}.test.ts`, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${ident} } from './${id}.ts';\nimport { parseMarkdown } from '../parse/parse.ts';\n\n// Table from docs/design/03-selection-and-operations.md. Each row: source, the node to select (by index in document order), expected replacement.\nconst cases: { name: string; source: string; pick: (doc: ReturnType<typeof parseMarkdown>) => { start: number; end: number }; expect: string }[] = [\n  // { name: 'TODO', source: '- [ ] a\\n', pick: (d) => ({ start: 2, end: 5 }), expect: '[x]' },\n];\n\nfor (const c of cases) test(\`${id}: \${c.name}\`, () => {\n  const doc = parseMarkdown(c.source, { file: 'test.md' });\n  const range = { file: 'test.md', ...c.pick(doc) };\n  const text = new TextDecoder().decode(new TextEncoder().encode(c.source).slice(range.start, range.end));\n  const out = ${ident}.run({ document: doc, range, text });\n  assert.equal(out.replacement, c.expect);\n});\n\ntest('${id}: has at least one case', () => { assert.ok(cases.length > 0, 'fill the table'); });\n`);
  const idx = join(ROOT, 'packages/core/src/operations/index.ts');
  if (!existsSync(idx)) writeFileSync(idx, header('Operation registry: palette order', 'ADR-0004') + `import type { Operation } from '../contracts/operation.ts';\n\nexport const OPERATIONS: readonly Operation[] = [];\n`);
  appendFileSync(idx, `export { ${ident} } from './${id}.ts'; // TODO: add ${ident} to OPERATIONS in palette order\n`);
  console.log('updated packages/core/src/operations/index.ts');
} else if (kind === 'command' && a) {
  const name = a.toLowerCase(); const camel = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  write(`apps/desktop/src-tauri/src/commands/${name}.rs`, `//! ${name}: TODO one line (docs/design/06-shell.md). Story ${key}.\nuse crate::error::ShellError;\n\n#[tauri::command]\npub fn ${name}() -> Result<(), ShellError> {\n    // TODO\n    Ok(())\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn ${name}_has_a_test() {\n        assert!(false, \"write the first test for ${name}\");\n    }\n}\n`);
  console.log(`\nregister it:  commands/mod.rs → pub mod ${name};  main.rs → generate_handler![…, commands::${name}::${name}]\ncapability:  apps/desktop/src-tauri/capabilities/default.json → "allow-${name.replace(/_/g, '-')}"\nbinding:     apps/desktop/src/shell/tauri.ts →  ${camel}: () => ${'invoke'}${'('}'${name}'),\ncontract:    the method must already exist in packages/shell-api/src/index.ts, or the story needs an ADR`);
} else { console.error('usage: pnpm new module <package> <name> | operation <id> "<Title>" | command <snake_name>'); process.exit(2); }
