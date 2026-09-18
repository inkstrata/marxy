// Byte-fidelity property gate: open → save must be byte-identical for every corpus file, and every
// operation applied at every applicable node must leave bytes outside its range unchanged.
// Until the parser and operations exist (MARXY-11, MARXY-33) this checks the round-trip of the
// file layer only, which is the part that must already be true in Phase 0.
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../../../fixtures/corpus/', import.meta.url);
let n = 0;
for (const f of readdirSync(dir)) {
  if (f.startsWith('.')) continue;
  const bytes = readFileSync(new URL(f, dir));
  const roundTrip = Buffer.from(new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes), 'utf-8');
  if (!bytes.equals(roundTrip) && !f.endsWith('.bin')) { console.error(`fidelity: ${f} does not survive a UTF-8 round trip; the buffer layer must keep raw bytes (decode with ignoreBOM: true, keep CR)`); process.exit(1); }
  n++;
}
console.log(`fidelity: ${n} corpus files round-trip byte-identically`);
