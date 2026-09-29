// Folds changelog.d/ fragments into CHANGELOG.md at release time, in key order, and deletes
// the fragments it folded in. This is the only script that writes CHANGELOG.md; changelog.d's
// rule is docs/README.md there, and scripts/lib/changelog.mjs is the shared reader (MARXY-315).
// usage: node scripts/changelog.mjs --release X.Y.Z [--root DIR] [--date YYYY-MM-DD]
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fix } from './lib/repo.mjs';
import { FRAGMENT_DIR, fragmentKey, validFragment } from './lib/changelog.mjs';

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

/**
 * The legacy bullets under `## Unreleased` (lines written straight into CHANGELOG.md before
 * fragments existed), taken out of the text. Returns the changelog without them and the bullets
 * without their `- ` marker, continuation lines kept.
 */
export function takeLegacyBullets(changelog) {
  const text = String(changelog ?? '');
  const start = text.indexOf('## Unreleased');
  if (start < 0) return { changelog: text, bullets: [] };
  const bodyStart = text.indexOf('\n', start) + 1 || text.length;
  const next = text.indexOf('\n## ', bodyStart);
  const end = next < 0 ? text.length : next + 1;
  const bullets = [];
  const kept = [];
  let current = null;
  for (const line of text.slice(bodyStart, end).split('\n')) {
    if (/^- /.test(line)) { current = [line.slice(2)]; bullets.push(current); }
    else if (current && /^\s+\S/.test(line)) current.push(line);
    else { current = null; kept.push(line); }
  }
  const rest = kept.join('\n').replace(/\n{3,}/g, '\n\n');
  return { changelog: text.slice(0, bodyStart) + rest + text.slice(end), bullets: bullets.map(b => b.join('\n').trim()) };
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

export function release({ root = ROOT, version, date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!version) throw new Error(`--release needs a version${fix('node scripts/changelog.mjs --release 0.5.0')}`);
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 0.5.0${fix('node scripts/changelog.mjs --release 0.5.0 [--date YYYY-MM-DD]')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`"${date}" is not a YYYY-MM-DD date${fix('pass --date 2026-09-28')}`);
  const dir = join(root, FRAGMENT_DIR);
  const files = fragmentFiles(dir);
  const contents = files.map(f => readFileSync(join(dir, f), 'utf8').trim());
  // Validate everything before touching a byte: a half-folded release cannot be re-run.
  const bad = files.filter((f, i) => !validFragment(contents[i], fragmentKey(`${FRAGMENT_DIR}/${f}`)));
  if (bad.length) throw new Error(`${bad.map(f => `${FRAGMENT_DIR}/${f}`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not one line ending in the story key${fix('changelog.d/README.md has the rule; nothing was changed')}`);
  const changelogPath = join(root, 'CHANGELOG.md');
  const current = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n\n## Unreleased\n';
  if (new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'm').test(current)) {
    throw new Error(`CHANGELOG.md already has a ${version} heading${fix('pick the next version; nothing was changed')}`);
  }
  const { changelog, bullets } = takeLegacyBullets(current);
  if (files.length === 0 && bullets.length === 0) {
    throw new Error(`nothing to release: no fragments in ${FRAGMENT_DIR}/ and no bullets under Unreleased${fix('nothing was changed')}`);
  }
  const text = foldRelease({ changelog, fragments: [...bullets, ...contents], version, date });
  writeFileSync(changelogPath, text);
  for (const f of files) rmSync(join(dir, f));
  return { version, date, folded: files.length, legacy: bullets.length, files };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const argv = process.argv.slice(2);
    const { version, date, folded, legacy } = release({ root: flagValue(argv, '--root') ? resolve(flagValue(argv, '--root')) : ROOT, version: flagValue(argv, '--release'), date: flagValue(argv, '--date') });
    console.log(`changelog ok: folded ${folded} fragment(s) and ${legacy} Unreleased bullet(s) into CHANGELOG.md under ${version} (${date})`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
