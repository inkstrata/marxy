// The weight-offset table (MARXY-21): applied on Linux only, by WebKitGTK version.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { platformOf, weightOffset } from '../src/theme/offset.ts';

test('the §05 table', () => {
  assert.equal(weightOffset('linux', { major: 2, minor: 52, micro: 6 }), 75);
  assert.equal(weightOffset('linux', { major: 2, minor: 50, micro: 6 }), 125);
  assert.equal(weightOffset('linux', { major: 2, minor: 48, micro: 0 }), 100);
  assert.equal(weightOffset('linux', null), 100);
  assert.equal(weightOffset('macos', null), 0);
  assert.equal(weightOffset('macos', { major: 2, minor: 52, micro: 0 }), 0);
  assert.equal(weightOffset('windows', null), 0);
});

test('the platform from the webview user agent', () => {
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'), 'macos');
  assert.equal(platformOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'), 'linux');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'), 'windows');
});
