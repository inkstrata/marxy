// Checks the taste review #0 artifact against MARXY-17's acceptance: two complete PNG sets at 1× and
// 2×, set at the docs/design-language.md type scale and a 68ch measure in the two ADR-0015 pairs,
// rendering with nothing but locally vendored OFL fonts and no network, and linked from the review
// queue with the reviewer's checklist. Run it after render.mjs; it reads only what render.mjs wrote.
// The kit is the record of what review #0 looked at, and ADR-0033 has since moved the scale (20/30,
// a measure in characters). So the kit is held to the scale and measure it was rendered at, which
// render.mjs writes into its manifest, not to today's: re-rendering it would rewrite the record.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTROL_RESOURCES, DPRS, OUT, SOURCE, VARIANTS, VIEWPORT, pages, pairs, pngSize, repo, repoPath, specimenPage } from './specimen.mjs';

const unit = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./specimen.test.mjs', import.meta.url))], { cwd: repoPath('.'), encoding: 'utf8' });
if (unit.status !== 0) {
  console.error((unit.stdout + unit.stderr).trim() || 'specimen unit checks failed');
  process.exit(1);
}

const fails = [];
const check = (ok, message) => { if (!ok) fails.push(message); return ok; };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// 0. Wired into pnpm and CI as a required step, not a reminder. MARXY-17's checks only count if
// something runs them; this section fails if the alias or the CI step drifts off, becomes
// advisory, or starts re-rendering (which would need a browser CI does not install for this step).
const pkg = JSON.parse(readFileSync(repo('package.json'), 'utf8'));
check(pkg.scripts?.['gate:specimen'] === 'node scripts/specimen/verify.mjs',
  `package.json gate:specimen is ${JSON.stringify(pkg.scripts?.['gate:specimen'])}, not node scripts/specimen/verify.mjs`);
const ci = readFileSync(repo('.github/workflows/ci.yml'), 'utf8');
check(/os:\s*\[macos-latest,\s*ubuntu-latest\]/.test(ci),
  'ci.yml gates job is not on both macos-latest and ubuntu-latest');
const specimenAt = ci.search(/^      - run: pnpm gate:specimen$/m);
check(specimenAt !== -1, 'ci.yml does not run pnpm gate:specimen as a required step');
check(!/pnpm gate:specimen\s*\|\|\s*true/.test(ci), 'ci.yml treats gate:specimen as advisory (|| true)');
check(!/continue-on-error:/.test(ci.slice(Math.max(0, specimenAt - 160), specimenAt + 160)),
  'ci.yml treats gate:specimen as advisory (continue-on-error)');
const browsersAt = ci.search(/playwright install/);
check(specimenAt !== -1 && (browsersAt === -1 || specimenAt < browsersAt),
  'gate:specimen runs after Playwright browsers; verify.mjs does not need a browser');

const manifestPath = `${OUT}/manifest.json`;
if (!existsSync(repo(manifestPath))) { console.error(`specimen not rendered: ${manifestPath} is missing — run node scripts/specimen/render.mjs`); process.exit(1); }
const manifest = JSON.parse(readFileSync(repo(manifestPath), 'utf8'));
// The scale the kit was set at, recorded by render.mjs (see the header): every role must be there.
const scale = manifest.scale ?? {};
for (const key of ['title', 'section', 'sub', 'body', 'code', 'caption']) check(scale[key], `manifest.json records no ${key} role in its scale`);
const queue = readFileSync(repo('docs/taste-review/queue.md'), 'utf8');

check(JSON.stringify(manifest.variants) === JSON.stringify(VARIANTS), `manifest variants are ${JSON.stringify(manifest.variants)}, expected ${JSON.stringify(VARIANTS)}`);

// 1. Two complete PNG sets per variant, 1× and 2×, of the long document.
check(manifest.source === SOURCE, `manifest renders ${manifest.source}, not ${SOURCE}`);
check(manifest.pairs.length === 2, `${manifest.pairs.length} pairs rendered, expected 2`);
for (const pair of pairs) {
  const entry = manifest.pairs.find(p => p.slug === pair.slug);
  if (!check(entry, `no rendered set for ${pair.slug}`)) continue;
  for (const variant of VARIANTS) {
    for (const page of pages) {
      const at = dpr => entry.images.find(i => i.page === page.id && i.variant === variant && i.dpr === dpr);
      for (const dpr of DPRS) {
        const image = at(dpr);
        if (!check(image, `${pair.slug} is missing ${page.id} ${variant} at ${dpr}×`)) continue;
        if (!check(existsSync(repo(image.path)), `${image.path} is in the manifest but not on disk`)) continue;
        const { width, height } = pngSize(repo(image.path));
        check(width === VIEWPORT.width * dpr && height === VIEWPORT.height * dpr, `${image.path} is ${width}×${height}, expected ${VIEWPORT.width * dpr}×${VIEWPORT.height * dpr}`);
        check(image.bytes > 20_000, `${image.path} is ${image.bytes} bytes — too small to be a page of text`);
      }
      const [one, two] = DPRS.map(at);
      if (one && two) check(two.width === one.width * 2 && two.height === one.height * 2, `${pair.slug} ${page.id} ${variant}: the 2× PNG is not twice the 1× PNG`);
      if (one && two) check(JSON.stringify(one.anchor) === JSON.stringify(two.anchor), `${pair.slug} ${page.id} ${variant}: the 1× and 2× captures anchored to different elements`);
    }
  }
  for (const page of pages) {
    for (const dpr of DPRS) {
      const legacy = `${OUT}/${pair.slug}/${page.id}-${dpr}x.png`;
      check(!existsSync(repo(legacy)), `${legacy} is the pre-variant name and must be removed`);
    }
  }

  // 2. Set at the type scale, in this pair's faces.
  const m = entry.measured;
  if (!check(m, `${pair.slug} has no measurements`)) continue;
  for (const [key, want] of Object.entries(scale)) {
    const got = m.roles[key];
    if (!check(got, `${pair.slug} did not measure the ${key} role`)) continue;
    const family = key === 'code' ? pair.mono : pair.text;
    check(got.fontFamily === family, `${pair.slug} ${key}: rendered in ${got.fontFamily}, expected ${family}`);
    check(got.fontSize === want.size, `${pair.slug} ${key}: ${got.fontSize}px, the scale says ${want.size}px`);
    check(got.fontWeight === want.weight, `${pair.slug} ${key}: weight ${got.fontWeight}, the scale says ${want.weight}`);
    const tracking = want.tracking === '0' ? 0 : parseFloat(want.tracking) * want.size;
    check(near(parseFloat(got.letterSpacing), tracking, 0.01), `${pair.slug} ${key}: tracking ${got.letterSpacing}, the scale says ${want.tracking} (${tracking.toFixed(3)}px)`);
    // Inline code sits on the body line box; the 22px code line box belongs to fenced blocks, and
    // this document has none — so assert the one that applies rather than skipping the role.
    const lineHeight = key === 'code' && m.codeBlocks === 0 ? scale.body.lineHeight : want.lineHeight;
    check(got.lineHeight === lineHeight, `${pair.slug} ${key}: line box ${got.lineHeight}px, expected ${lineHeight}px`);
    if (key !== 'code') check(got.marginTop === want.spaceAbove, `${pair.slug} ${key}: space above ${got.marginTop}px, the scale says ${want.spaceAbove}px`);
  }

  // 3. 68ch measure, resolved optically in this pair's body face (design constraint 1).
  check(near(m.measureCh, 68, 0.05), `${pair.slug}: column measures ${m.measureCh}ch, expected 68ch`);
  check(near(m.columnPx, 68 * m.chPx, 0.5), `${pair.slug}: column ${m.columnPx}px ≠ 68 × ${m.chPx}px`);

  // 4. Only the vendored faces, each loaded, each under its own OFL licence.
  for (const face of pair.faces) {
    check(existsSync(repo(face.file)), `${face.file} is not vendored`);
    const licence = face.file.replace(/\/[^/]+$/, '/LICENSE');
    check(existsSync(repo(licence)) && readFileSync(repo(licence), 'utf8').includes('SIL Open Font License, Version 1.1'), `${licence} is missing or is not the OFL 1.1`);
    check(m.fontsLoaded.some(f => f.startsWith(`${face.family} ${face.style} ${face.weight} loaded`)), `${pair.slug}: face ${face.family} ${face.style} ${face.weight} did not load (${m.fontsLoaded.join('; ')})`);
  }
  check(m.fontsLoaded.length === pair.faces.length, `${pair.slug}: ${m.fontsLoaded.length} faces registered, expected ${pair.faces.length}`);
  check(new Set([pair.text, pair.mono]).size === 2 && [...new Set(pair.faces.map(f => f.family))].every(f => f === pair.text || f === pair.mono), `${pair.slug}: a face outside the pair is registered`);
}

// 5. Both sets show the same passage. The pairs set the document to different heights, so this is
// asserted from the anchors render.mjs recorded, not inferred from the scroll offsets.
const describe = a => (a ? `<${a.tag}> block ${a.block} "${a.text.slice(0, 40)}"` : 'nothing');
for (const page of pages) {
  const anchored = manifest.pairs.map(p => ({ slug: p.slug, anchor: p.images.find(i => i.page === page.id)?.anchor }));
  const [first, ...rest] = anchored;
  check(first?.anchor?.text, `${page.id}: no anchor was recorded, so nothing says the two sets show the same passage`);
  for (const other of rest) check(JSON.stringify(first.anchor) === JSON.stringify(other.anchor), `${page.id}: ${first.slug} anchored to ${describe(first.anchor)}, ${other.slug} to ${describe(other.anchor)}`);
}

// 6. Nothing is downloaded at render time.
//
// What this proves: the render ran behind an interception that aborts and records every http(s)
// request, and a control page referencing a remote image, video, iframe, stylesheet, @import and
// fetch() was caught by it in the same run — so the specimen's empty request list is a measurement,
// not an unwatched silence. Every face is inlined as a data: URL in the page the render fed the
// browser, which the static scan below re-checks against this committed file.
// What it does not prove: that a *future* edit renders offline. It is re-measured on every render.
// CI runs this file against the committed PNGs and does not re-render (MARXY-62).
const control = manifest.networkControl;
if (check(control, 'the manifest has no network control: the zero-request claim rests on nothing')) {
  for (const kind of CONTROL_RESOURCES) check(control.kinds.includes(kind), `the network control's remote ${kind} was not intercepted, so the interception the no-network claim rests on is not watching everything it claims`);
  check(control.blocked.length >= CONTROL_RESOURCES.length, `the network control intercepted ${control.blocked.length} requests, expected at least ${CONTROL_RESOURCES.length}`);
  check(control.blocked.every(u => u.includes('specimen-control.invalid')), `the network control blocked a request it did not make: ${control.blocked.filter(u => !u.includes('specimen-control.invalid')).slice(0, 3).join(', ')}`);
}
check(manifest.blocked.length === 0, `the specimen attempted ${manifest.blocked.length} network requests: ${manifest.blocked.slice(0, 5).join(', ')}`);
check(manifest.requests.every(u => /^(data|about|blob):/i.test(u)), `the specimen requested a non-local URL: ${manifest.requests.filter(u => !/^(data|about|blob):/i.test(u)).slice(0, 5).join(', ')}`);
for (const pair of pairs) {
  for (const variant of VARIANTS) {
    const html = specimenPage(pair, variant);
    const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map(m => m[1]);
    check(urls.length === pair.faces.length, `${pair.slug} ${variant}: the specimen page has ${urls.length} url() references, expected one inlined face per ${pair.faces.length}`);
    check(urls.every(u => u.startsWith('data:font/ttf;base64,')), `${pair.slug} ${variant}: a font is referenced by URL rather than inlined`);
    // Anything that can fetch, by attribute as well as by tag: a remote <video src> reads as neither
    // <img> nor <script>, and the first version of this scan let one through.
    const fetching = [...html.matchAll(/<(?:link|script|img|picture|source|iframe|frame|video|audio|track|embed|object|applet)\b|\b(?:src|srcset|poster|background|data|codebase|formaction|ping)\s*=|@import/gi)].map(m => m[0].trim());
    check(fetching.length === 0, `${pair.slug} ${variant}: the specimen page contains ${fetching.length} things that can fetch (${[...new Set(fetching)].slice(0, 5).join(', ')})`);
  }
}
const fontsReadme = readFileSync(repo('fonts/README.md'), 'utf8');
for (const family of new Set(pairs.flatMap(p => [p.text, p.mono]))) check(fontsReadme.includes(family), `fonts/README.md does not list ${family}`);
check(manifest.measure === '68ch', `the kit was rendered at a measure of ${manifest.measure}, not the 68ch review #0 judged`);

// 7. The queue entry is the deliverable: it links every PNG and carries the reviewer's checklist.
const linked = new Set([...queue.matchAll(/\(([^)]*review-0[^)]*\.png)\)/g)].map(m => m[1].replace(/^\.\//, '')));
for (const image of manifest.pairs.flatMap(p => p.images)) {
  const rel = image.path.replace('docs/taste-review/', '');
  check(linked.has(rel) || linked.has(image.path), `docs/taste-review/queue.md does not link ${image.path}`);
}
for (const link of linked) check(existsSync(repo(`docs/taste-review/${link.replace('docs/taste-review/', '')}`)), `docs/taste-review/queue.md links ${link}, which does not exist`);
for (const required of ['## Review #0', 'What to compare', 'What would count as wrong', 'ADR-0015', 'Decision to record']) check(queue.includes(required), `docs/taste-review/queue.md is missing "${required}"`);
check(pages.every(p => queue.includes(p.shows)), 'the queue entry does not say what each page shows');

if (fails.length) { console.error(`specimen gate failed:\n - ${fails.join('\n - ')}`); process.exit(1); }
const images = manifest.pairs.flatMap(p => p.images).length;
console.log(`specimen gate ok: ${manifest.pairs.length} pairs × ${VARIANTS.length} variants × ${pages.length} pages × ${DPRS.length} densities = ${images} PNGs at the type scale, 68ch (${manifest.pairs.map(p => `${p.text} ${p.measured.columnPx}px`).join(', ')}), same ${pages.length} anchors in both sets, ${manifest.blocked.length} network requests against ${control.kinds.length}/${CONTROL_RESOURCES.length} control references intercepted, ${linked.size} linked from the queue`);
