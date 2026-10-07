#!/usr/bin/env node
// Copies the slice of the L-00 layout probe that 12-conformance.md cites into a stable path,
// lab/data/layout-probe.json. The probe kit itself (docs/taste-review/2026-10-layout-audit/) is dated
// and regenerated, so a lasting document must not cite it (AGENTS.md, "No rotting paths").
//
//   node docs/research/reader-typography/lab/layout/slice-probe.mjs [path/to/probe.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../../../../..');
const from = process.argv[2] ?? join(root, 'docs/taste-review/2026-10-layout-audit/probe.json');
const p = JSON.parse(readFileSync(from, 'utf8'));

// Per document and cell: the viewport (sideways page scroll, the H4 count); the column and centre only
// for the reference cells (20 px, dark, overlay), where the room per width is read. Block lists,
// per-kind aggregates and per-cell offenders stay in the kit.
const documents = {};
for (const [doc, cells] of Object.entries(p.documents)) {
  documents[doc] = {};
  for (const [cell, c] of Object.entries(cells)) {
    const { scrollbar, scrollWidth, hScroll } = c.viewport;
    documents[doc][cell] = { viewport: { scrollbar, scrollWidth, hScroll } };
    if (cell.endsWith('x20-dark-overlay')) Object.assign(documents[doc][cell], { column: c.column, centre: c.centre });
  }
}
const out = {
  generatedBy: 'docs/research/reader-typography/lab/layout/slice-probe.mjs',
  generatedFrom: 'scripts/probe-layout.mjs, run by L-00.1 into docs/taste-review/2026-10-layout-audit/probe.json',
  ref: p.ref,
  tree: p.tree,
  engine: p.engine,
  matrix: p.matrix,
  definitions: p.definitions,
  headlines: p.headlines,
  rankings: p.rankings,
  rankingsByKind: p.rankingsByKind,
  rankingsAtReadingWidths: p.rankingsAtReadingWidths,
  static: p.static,
  documents,
};
const file = join(here, '../data/layout-probe.json');
writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(`wrote ${file}`);
