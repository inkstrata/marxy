import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearTray, collect, collectMany, onTray, trayPieces } from './tray.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const piece = (i: number) => ({ path: '/r/a.md', first: i, last: i, text: `line ${i}`, note: '' });

test('collectMany appends every piece once and tells the listeners once', () => {
  clearTray();
  collect(piece(0));
  let told = 0;
  const off = onTray(() => told++);
  const many = Array.from({ length: 50_000 }, (_, i) => piece(i + 1));
  const t0 = cpuNow();
  const n = collectMany(many);
  const ms = cpuNow() - t0;
  off();
  assert.equal(n, 50_001);
  assert.equal(trayPieces().length, 50_001);
  assert.equal(trayPieces()[50_000]!.first, 50_000);
  assert.equal(told, 1);
  assert.ok(ms < 100, `${ms} ms`);
  clearTray();
});

test('collectMany of nothing tells no one', () => {
  clearTray();
  let told = 0;
  const off = onTray(() => told++);
  assert.equal(collectMany([]), 0);
  off();
  assert.equal(told, 0);
});
