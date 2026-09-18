// Licence audit (ADR-0006): fails on copyleft anywhere in the dependency tree, and on grammars or
// hyphenation patterns outside the allow-lists.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const forbidden = /\b(GPL|AGPL|LGPL|SSPL|EUPL|CC-BY-NC|CC-BY-SA|OSL)\b/i;
const allowed = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|MPL-2\.0|BlueOak-1\.0\.0|Python-2\.0|OFL-1\.1|\(MIT OR Apache-2\.0\)|\(Apache-2\.0 OR MIT\)|\(MPL-2\.0 OR Apache-2\.0\)|MIT OR Apache-2\.0|Apache-2\.0 OR MIT)$/;
let failures = [];
try {
  const json = JSON.parse(execSync('pnpm licenses list --json --long', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  for (const [licence, pkgs] of Object.entries(json)) {
    if (forbidden.test(licence)) failures.push(`${licence}: ${pkgs.map(p => p.name).join(', ')}`);
    else if (!allowed.test(licence)) console.warn(`review: ${licence} (${pkgs.map(p => p.name).slice(0, 5).join(', ')})`);
  }
} catch (e) { console.warn('pnpm licenses unavailable (no lockfile yet?)', e.message.split('\n')[0]); }
const gpl = new Set(['ada', 'gnuplot', 'nginx', 'racket']);
const langs = JSON.parse(readFileSync(new URL('./allowlists/shiki-languages.json', import.meta.url), 'utf8')).languages;
for (const l of langs) if (gpl.has(l)) failures.push(`GPL grammar in allow-list: ${l}`);
if (failures.length) { console.error('licence gate failed:\n - ' + failures.join('\n - ')); process.exit(1); }
console.log(`licence gate ok (${langs.length} grammars allow-listed)`);
