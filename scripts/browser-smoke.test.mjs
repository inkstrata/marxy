// The pull-request browser smoke set (browser-smoke.json) stays honest: every file in it exists, is in the change map,
// and is written the way docs/testing.md asks of a test a hosted runner must pass: no fixed sleep, and no browser of
// its own launched outside the kit.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { files } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'browser-smoke.json'), 'utf8'));
const map = JSON.parse(readFileSync(join(ROOT, 'scripts', 'verify-map.json'), 'utf8'));
const mapped = new Set([...map.fallback, ...Object.values(map.map).flat()]);

test('the smoke set names each file once, and each exists and is in the change map', () => {
  assert.equal(new Set(files).size, files.length, 'a file is named twice');
  for (const f of files) {
    assert.ok(existsSync(join(ROOT, 'apps', 'desktop', 'test', f)), `${f} is gone`);
    assert.ok(mapped.has(f), `${f} is in no entry of verify-map.json`);
  }
});

test('a smoke file waits for conditions: no fixed sleep and no browser launched outside the kit', () => {
  for (const f of files) {
    const text = readFileSync(join(ROOT, 'apps', 'desktop', 'test', f), 'utf8');
    const code = text.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /waitForTimeout|setTimeout\(/, `${f} has a fixed sleep`);
    assert.doesNotMatch(code, /launchWebkit\(|webkit\.launch\(/, `${f} launches its own browser`);
  }
});
