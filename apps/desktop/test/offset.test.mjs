// The Linux weight offset (B-07): one documented constant, `0` elsewhere, config override.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LINUX_WEIGHT_OFFSET, platformOf, weightOffset } from '../src/theme/offset.ts';

test('the weight offset: one constant on Linux, none elsewhere, config overrides', () => {
  assert.equal(LINUX_WEIGHT_OFFSET, 100);
  assert.equal(weightOffset('linux', null), 100);
  assert.equal(weightOffset('linux', 60), 60);
  assert.equal(weightOffset('linux', 0), 0);
  assert.equal(weightOffset('macos', null), 0);
  assert.equal(weightOffset('macos', 60), 0);
  assert.equal(weightOffset('windows', null), 0);
  assert.equal(weightOffset('windows', 60), 0);
  assert.equal(weightOffset('other', 60), 0);
});

test('offset.ts names no WebKit version', () => {
  const source = readFileSync(new URL('../src/theme/offset.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /webkitversion|WebKitGTK version|\bminor\b|\bmajor\b/i);
});

test('the platform from the webview user agent', () => {
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'), 'macos');
  assert.equal(platformOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'), 'linux');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'), 'windows');
});
