// Change detection for CI: which categories of file changed between the base and HEAD, so jobs that
// cannot be affected are skipped. Writes GITHUB_OUTPUT (docs_only, web, rust, workflow) and prints a line.
// usage: node scripts/ci-changes.mjs <base-ref>
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const base = process.argv[2];
let files = [];
try { files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); }
catch { try { files = execSync(`git diff --name-only ${base} HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { files = ['<unknown>']; } }
const isDoc = f => /^(docs\/|orchestration\/|\.cursor\/|\.githooks\/|README\.md$|CONTRIBUTING\.md$|CHANGELOG\.md$|AGENTS\.md$|LICENSE$|\.editorconfig$|\.gitattributes$|fonts\/.*\/(LICENSE|README)|docs\/.*\.png$)/.test(f) || (/\.md$/.test(f) && !f.startsWith('fixtures/'));
const workflow = files.some(f => f.startsWith('.github/'));
const rust = files.some(f => f.startsWith('apps/desktop/src-tauri/'));
const web = files.some(f => /^(packages\/|apps\/desktop\/(src|index\.html|vite\.config|package\.json|scripts)|fixtures\/|scripts\/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|mise\.toml)/.test(f));
const docs_only = !workflow && !rust && !web && files.length > 0 && files.every(isDoc);
const out = { docs_only, web: web || workflow, rust: rust || workflow, workflow, changed: files.length };
if (process.env.GITHUB_OUTPUT) for (const [k, v] of Object.entries(out)) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
console.log(`ci-changes: ${JSON.stringify(out)}${docs_only ? ' — docs only: build and browser jobs are skipped' : ''}`);
