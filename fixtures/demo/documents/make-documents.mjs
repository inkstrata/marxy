// Builds the demo's Word document and deck from the samples the office tests read (packages/core/src/office/testing/samples.ts):
// harbour-survey-2026.docx and tide-gauge-upgrade.pptx. Run from anywhere: node fixtures/demo/documents/make-documents.mjs.
// The bytes are the same on every run.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deckParts, storedZip, wordParts } from '../../../packages/core/src/office/testing/samples.ts';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'harbour-survey-2026.docx'), storedZip(wordParts()));
writeFileSync(join(here, 'tide-gauge-upgrade.pptx'), storedZip(deckParts()));
