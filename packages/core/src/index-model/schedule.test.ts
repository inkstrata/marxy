// Indexing must not precede first paint, and the ceiling notice is not chrome at rest.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_SCHEDULE } from './index.ts';

test('the model declares that index build does not precede first paint', () => {
  assert.equal(INDEX_SCHEDULE.precedesFirstPaint, false);
  assert.equal(INDEX_SCHEDULE.noticeIsStandingChrome, false);
});

test('importing the model does not call buildIndex — the file has no top-level walk', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  // Re-exports only. A top-level buildIndex(...) here would start work on import.
  assert.equal(/\nbuildIndex\(/.test(source), false);
  assert.equal(/\ncollectFiles\(/.test(source), false);
});

test('the Tauri walk is demand-driven and is not started from main', () => {
  const walk = readFileSync(new URL('../../../../apps/desktop/src-tauri/src/index/mod.rs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../../../../apps/desktop/src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(walk, /fn walk_root/);
  assert.doesNotMatch(main, /index::walk_root/);
  assert.doesNotMatch(main, /index::build/);
  // A constructor or lazy_static walk would run before first paint once the module is wired.
  assert.doesNotMatch(walk, /lazy_static|\[ctor\]|inventory::submit/);
});
