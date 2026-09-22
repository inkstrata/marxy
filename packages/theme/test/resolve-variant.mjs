// Loads resolveVariantPreference from loader.ts for tests (no build step).

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const js = stripTypeScriptTypes(readFileSync(new URL('../src/loader.ts', import.meta.url), 'utf8'))
  .replace(/^export type .*$/gm, '')
  .replace(/^export function /gm, 'function ');
export const resolveVariantPreference = new Function(`${js}; return resolveVariantPreference;`)();
