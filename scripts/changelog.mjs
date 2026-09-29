// Folds changelog.d/ fragments into CHANGELOG.md at release time, in key order, and deletes
// the fragments it folded in. This is the only script that writes CHANGELOG.md; changelog.d's
// rule is docs/README.md there, and scripts/lib/changelog.mjs is the shared reader (MARXY-315).
// usage: node scripts/changelog.mjs --release X.Y.Z [--root DIR] [--date YYYY-MM-DD]
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fix } from './lib/repo.mjs';
import { FRAGMENT_DIR, fragmentKey } from './lib/changelog.mjs';

/** Fragment file names under `dir` (default `changelog.d/`), sorted numerically by key. */
export function fragmentFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f !== 'README.md' && f.endsWith('.md'))
    .sort((a, b) => {
      const na = Number(fragmentKey(`${FRAGMENT_DIR}/${a}`)?.match(/\d+/)?.[0] ?? 0);
      const nb = Number(fragmentKey(`${FRAGMENT_DIR}/${b}`)?.match(/\d+/)?.[0] ?? 0);
      return na - nb || a.localeCompare(b);
    });
}

/**
 * The new CHANGELOG.md text: every fragment line folded in under a new `## version - date`
 * heading, inserted right after the file's `## Unreleased` section (or at the top if there is
 * none), leaving every other byte of the original untouched.
 */
export function foldRelease({ changelog, fragments, version, date }) {
  const heading = `## ${version} - ${date}`;
  const body = fragments.map(f => `- ${f.trim()}`).join('\n');
  const block = `${heading}\n\n${body}\n`;
  const text = String(changelog ?? '');
  const marker = '## Unreleased';
  const idx = text.indexOf(marker);
  if (idx < 0) return `${text.trimEnd()}\n\n${block}`;
  const afterMarkerLine = text.indexOf('\n', idx) + 1 || text.length;
  // Insert after the Unreleased section: the next `## ` heading, or end of file.
  const next = text.indexOf('\n## ', afterMarkerLine);
  const insertAt = next < 0 ? text.length : next + 1;
  return `${text.slice(0, insertAt).replace(/\s*$/, '\n\n')}${block}${next < 0 ? '' : '\n' + text.slice(insertAt).replace(/^\s*/, '')}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]; else continue;
  }
  return out;
}

export function release({ root = ROOT, version, date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!version) throw new Error(`--release needs a version${fix('node scripts/changelog.mjs --release 0.5.0')}`);
  const dir = join(root, FRAGMENT_DIR);
  const files = fragmentFiles(dir);
  const fragments = files.map(f => readFileSync(join(dir, f), 'utf8').trim());
  const changelogPath = join(root, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n\n## Unreleased\n';
  const text = foldRelease({ changelog, fragments, version, date });
  writeFileSync(changelogPath, text);
  for (const f of files) rmSync(join(dir, f));
  return { version, date, folded: files.length, files };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const { version, date, folded } = release({ version: args.release, date: args.date });
    console.log(`changelog ok: folded ${folded} fragment(s) into CHANGELOG.md under ${version} (${date})`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
