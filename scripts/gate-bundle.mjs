// Bundle size budget (ADR-0013). Measures the built bundle when present.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8')).bundle_installed_mb;
const dir = new URL('../apps/desktop/src-tauri/target/release/bundle/', import.meta.url).pathname;
if (!existsSync(dir)) { console.log('bundle gate: no bundle built; skipping'); process.exit(0); }
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const files = walk(dir).filter(f => /\.(dmg|AppImage|deb)$/.test(f));
let fail = false;
for (const f of files) { const mb = statSync(f).size / 1048576; const limit = f.endsWith('.dmg') ? budgets.macos : budgets.linux; console.log(`${f.split('/').pop()}: ${mb.toFixed(1)} MB (limit ${limit})`); if (mb > limit) fail = true; }
if (fail) { console.error('bundle gate failed'); process.exit(1); }
console.log('bundle gate ok');
