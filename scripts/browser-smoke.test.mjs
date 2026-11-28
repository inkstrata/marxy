// The browser files a hosted runner is held to (browser-smoke.json, the pull-request set on macOS, and
// browser-windows.json, the files proved on a hosted Windows runner) stay honest: every file in them exists, is in the
// change map, and is written the way docs/testing.md asks of a test a hosted runner must pass: no fixed sleep, and no
// browser of its own launched outside the kit.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(ROOT, 'scripts', name), 'utf8')).files;
const smoke = read('browser-smoke.json');
const windows = read('browser-windows.json');
const files = [...smoke, ...windows.filter((f) => !smoke.includes(f))];
const map = JSON.parse(readFileSync(join(ROOT, 'scripts', 'verify-map.json'), 'utf8'));
const mapped = new Set([...map.fallback, ...Object.values(map.map).flat()]);

test('each set names each file once, and each file exists and is in the change map', () => {
  assert.equal(new Set(smoke).size, smoke.length, 'a smoke file is named twice');
  assert.equal(new Set(windows).size, windows.length, 'a Windows file is named twice');
  for (const f of files) {
    assert.ok(existsSync(join(ROOT, 'apps', 'desktop', 'test', f)), `${f} is gone`);
    assert.ok(mapped.has(f), `${f} is in no entry of verify-map.json`);
  }
});

test('a listed file waits for conditions: no fixed sleep and no browser launched outside the kit', () => {
  for (const f of files) {
    const text = readFileSync(join(ROOT, 'apps', 'desktop', 'test', f), 'utf8');
    const code = text.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /waitForTimeout|setTimeout\(/, `${f} has a fixed sleep`);
    assert.doesNotMatch(code, /launchWebkit\(|webkit\.launch\(/, `${f} launches its own browser`);
  }
});
