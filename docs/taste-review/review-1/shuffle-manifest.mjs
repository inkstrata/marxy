// Assigns marxy, Typora and Marked 2 to blind labels A/B/C and writes manifest.key.json (MARXY-31).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { FILES, pngName, slug } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const VARIANT = 'light';
const APPS = ['marxy', 'typora', 'marked'];
const LABELS = ['A', 'B', 'C'];
const KINDS = ['first', 'scroll70'];

function shuffle(items, seedBuf) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = seedBuf[i % seedBuf.length] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildAssignment(seed = randomBytes(32)) {
  const shuffled = shuffle(APPS, seed);
  const assignment = Object.fromEntries(LABELS.map((label, i) => [label, shuffled[i]]));
  return { assignment, seed: seed.toString('hex') };
}

export function blindRel(slugName, kind, label) {
  return join('blind', slugName, `${kind}-${label}.png`);
}

export function sourcePath(app, file, kind) {
  return join(here, app, pngName(file, kind));
}

export function writeManifest(assignment) {
  const manifest = {
    review: 1,
    measure: '68ch',
    bodySize: '17px',
    variant: VARIANT,
    viewport: { width: 960, height: 900 },
    dpr: 2,
    corpus: FILES.map((file) => ({
      file,
      slug: slug(file),
      captures: KINDS.map((kind) => ({
        kind,
        blind: Object.fromEntries(
          LABELS.map((label) => [label, blindRel(slug(file), kind, label)]),
        ),
      })),
    })),
    instructions:
      'Open captures under blind/ only. Rank A/B/C per document before opening manifest.key.json.',
  };
  writeFileSync(join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function materializeBlind(assignment) {
  const missing = [];
  for (const file of FILES) {
    const slugName = slug(file);
    for (const kind of KINDS) {
      for (const label of LABELS) {
        const app = assignment[label];
        const src = sourcePath(app, file, kind);
        const dest = join(here, blindRel(slugName, kind, label));
        if (!existsSync(src)) {
          missing.push({ app, src, dest });
          continue;
        }
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    }
  }
  return missing;
}

export function runShuffle({ seed } = {}) {
  const seedBuf = seed ? Buffer.from(seed, 'hex') : randomBytes(32);
  const { assignment, seed: seedHex } = buildAssignment(seedBuf);
  writeManifest(assignment);
  const key = {
    generated: new Date().toISOString().slice(0, 10),
    assignment,
    seed: seedHex,
    note: 'Open only after ranking. A/B/C map to app folders under review-1/.',
  };
  writeFileSync(join(here, 'manifest.key.json'), `${JSON.stringify(key, null, 2)}\n`);
  const missing = materializeBlind(assignment);
  return { assignment, missing };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { assignment, missing } = runShuffle();
  console.log(`manifest.json and manifest.key.json written; A/B/C → ${JSON.stringify(assignment)}`);
  if (missing.length) {
    console.log(`${missing.length} blind copy skipped (competitor captures not on disk yet)`);
    for (const m of missing.slice(0, 6)) console.log(`  missing ${m.src}`);
  } else {
    console.log('blind/ populated');
  }
}
