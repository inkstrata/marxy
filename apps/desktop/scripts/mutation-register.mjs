// Preload for a mutation run (scripts/mutations.mjs): installs the loader hooks that patch one product file.
import { register } from 'node:module';

register('./mutation-hooks.mjs', import.meta.url);
