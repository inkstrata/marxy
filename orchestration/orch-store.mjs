// Durable orchestration metrics outside the repo (~/.config/marxy/orchestration).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @param {string} [home] */
export function orchestrationStoreDir(home = homedir()) {
  return join(home, '.config', 'marxy', 'orchestration');
}

/** @param {string} [home] */
export function storePaths(home = homedir()) {
  const dir = orchestrationStoreDir(home);
  return {
    dir,
    events: join(dir, 'events.jsonl'),
    implementFailures: join(dir, 'implement-failures.jsonl'),
    turnLatest: join(dir, 'turn-latest.md'),
  };
}

/** @param {Record<string, unknown>} row @param {{ home?: string }} [opts] */
export function appendJsonl(file, row, opts = {}) {
  mkdirSync(storePaths(opts.home).dir, { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
}

/** @param {string} text @param {{ home?: string }} [opts] */
export function writeTurnLatest(text, opts = {}) {
  const { dir, turnLatest } = storePaths(opts.home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(turnLatest, text.endsWith('\n') ? text : `${text}\n`);
}
