// Runs palette unit tests (MARXY-36). Invoked by pnpm test once MARXY-86 widens the desktop glob.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => join(here, name));

const result = spawnSync(
  process.execPath,
  ['--test', '--experimental-strip-types', ...files],
  { stdio: 'inherit', cwd: join(here, '../../..') },
);
process.exit(result.status ?? 1);
