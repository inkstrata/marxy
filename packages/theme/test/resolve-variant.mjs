// Loads resolveVariantPreference from loader.ts for tests (no build step).

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/loader.ts', import.meta.url), 'utf8');
const block = source.match(/export function resolveVariantPreference[\s\S]*?\n}/);
if (!block) throw new Error('resolveVariantPreference not found in loader.ts');
const js = stripTypeScriptTypes(block[0]).replace(/^export function /, 'function ');
export const resolveVariantPreference = new Function(`${js}; return resolveVariantPreference;`)();
