// Golden-file gate (MARXY-11 implements the parser; until then this asserts the corpus exists).
import { readdirSync } from 'node:fs';
const corpus = readdirSync(new URL('../../../fixtures/corpus/', import.meta.url)).filter(f => !f.startsWith('.'));
if (corpus.length < 10) { console.error('corpus too small'); process.exit(1); }
console.log(`golden: ${corpus.length} fixtures present; parser goldens land with MARXY-11`);
