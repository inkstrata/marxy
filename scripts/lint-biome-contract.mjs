// The lint contract: biome must reject what we say it rejects, ignore what we say it ignores, and CI must run it.
// Lives in a file rather than a `node -e` one-liner so cmd.exe never has to parse it (MARXY-321).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const die = (message, fix) => {
  console.error(`✗ ${message}\n    fix: ${fix}`);
  process.exit(1);
};
// pnpm is a .cmd shim on Windows, which Node only runs through a shell.
const run = (args) =>
  process.platform === 'win32'
    ? spawnSync(args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '), { encoding: 'utf8', shell: true })
    : spawnSync(args[0], args.slice(1), { encoding: 'utf8' });

const dir = mkdtempSync(join(tmpdir(), 'marxy-8-'));
const probe = join(dir, 'unused.ts');
writeFileSync(probe, 'import { readFileSync } from "node:fs";\nexport const x = 1;\n');
const unused = run(['pnpm', 'exec', 'biome', 'check', '--formatter-enabled=false', probe]);
if (unused.status === 0) die('unused import was accepted', 'set correctness.noUnusedImports to error in biome.json');

const fmt = join(dir, 'fmt.ts');
writeFileSync(fmt, 'import x from "y"\n');
const before = readFileSync(fmt);
const formatted = run(['pnpm', 'exec', 'biome', 'check', '--linter-enabled=false', fmt]);
const after = readFileSync(fmt);
rmSync(dir, { recursive: true, force: true });
if (formatted.status === 0) die('formatter check accepted unformatted input', 'keep formatter enabled in biome.json');
if (!before.equals(after)) die('formatter rewrote a file', 'use biome check, never format --write');

for (const path of ['fixtures/corpus', 'fonts']) {
  const out = run(['pnpm', 'exec', 'biome', 'check', path]);
  // Biome prints the path with the platform's separators.
  const text = (out.stdout + out.stderr).replaceAll('\\', '/');
  if (!/ignored/i.test(text) || !text.includes(path)) die(`${path} is not ignored by biome`, `add ${path} to files.includes in biome.json`);
}

// `grep -R` does not exist on Windows; walk the manifests instead.
const echoStubs = [];
for (const top of ['packages', 'apps']) {
  for (const entry of readdirSync(top, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = readFileSync(join(top, entry.name, 'package.json'), 'utf8');
    } catch {
      continue;
    }
    manifest.split('\n').forEach((line, i) => {
      if (/"lint".*echo/.test(line)) echoStubs.push(`${top}/${entry.name}/package.json:${i + 1}:${line}`);
    });
  }
}
if (echoStubs.length) die('lint echo stubs remain', `replace each package lint script with biome check\n${echoStubs.join('\n')}`);

const lint = JSON.parse(readFileSync('package.json', 'utf8')).scripts.lint;
if (/--write/.test(lint) || !lint.includes('biome check')) die('lint must be check-only', 'root lint must run biome check and must not pass --write');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
if (!ci.includes('pnpm lint')) die('CI does not run pnpm lint', 'keep pnpm lint in .github/workflows/ci.yml');
if (!ci.includes('macos-latest') || !ci.includes('ubuntu-latest')) die('CI is not on both runners', 'keep macos-latest and ubuntu-latest in ci.yml');
console.log('biome-contract: ok');
