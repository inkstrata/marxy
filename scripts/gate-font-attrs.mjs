// Font attribute gate (MARXY-66). Fails if a font binary loses `binary` or gains an `eol` setting,
// if text under fonts/ is marked binary again, or if any file under fonts/ would be rewritten by a
// line-ending renormalisation. Run by `pnpm lint`, which CI runs on both runners.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const FONT = /\.(ttf|otf|woff2?)$/i;
const failures = [];

const attrs = path => Object.fromEntries(
  git('check-attr', 'binary', 'eol', 'text', '--', path).trim().split('\n')
    .map(line => line.split(': ').slice(1)),
);

const tracked = git('ls-files', '-z', 'fonts').split('\0').filter(Boolean);
// Extensions with no file yet still get checked, so a new font format arrives already protected.
const probes = ['otf', 'woff', 'woff2'].map(ext => `fonts/probe.${ext}`);

for (const path of [...tracked.filter(p => FONT.test(p)), ...probes]) {
  const a = attrs(path);
  if (a.binary !== 'set') failures.push(`${path}: binary is '${a.binary}', want set`);
  if (a.eol !== 'unset' && a.eol !== 'unspecified') failures.push(`${path}: eol is '${a.eol}'; an eol setting lets a tool normalise a font`);
}
for (const path of tracked.filter(p => !FONT.test(p))) {
  if (attrs(path).binary === 'set') failures.push(`${path}: is binary; text under fonts/ must show a normal diff`);
}
// Nothing under fonts/ may be eligible for line-ending conversion: a licence is verbatim too, and
// one of them (IBM Plex Mono's) is stored with CRLF endings that `* text=auto eol=lf` would rewrite.
for (const path of tracked) {
  const { text } = attrs(path);
  if (text !== 'unset') failures.push(`${path}: text is '${text}', want unset; git could rewrite its line endings`);
}

if (failures.length) {
  for (const f of failures) console.error(`font-attrs: ${f}`);
  process.exit(1);
}
console.log(`font-attrs: ok (${tracked.length} files under fonts/)`);
