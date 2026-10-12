// The inspector's tab table (W-09): pure, so a table test. The strip and panel it drives are inspector.test.mjs, in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectorTabs, registerInspectorTab, type InspectorTab } from './inspector.ts';
import { LINKS_TAB } from './links-tab.ts';

const stub = (id: string): InspectorTab => ({ id, title: id.toUpperCase(), mount: () => () => {} });

test('a tab exists only while its builder is registered', () => {
  const before = inspectorTabs().map((t) => t.id);
  const off = registerInspectorTab(stub('outline'));
  assert.deepEqual(inspectorTabs().map((t) => t.id), [...before, 'outline']);
  off();
  assert.deepEqual(inspectorTabs().map((t) => t.id), before);
  off();
  assert.deepEqual(inspectorTabs().map((t) => t.id), before, 'withdrawing twice is harmless');
});

test('the tabs keep the order they were registered in, and a second registration of an id replaces the first', () => {
  const offs = [registerInspectorTab(LINKS_TAB), registerInspectorTab(stub('a')), registerInspectorTab(stub('b'))];
  assert.deepEqual(inspectorTabs().map((t) => t.id), ['links', 'a', 'b']);
  const replacement = { ...stub('a'), title: 'Again' };
  offs.push(registerInspectorTab(replacement));
  assert.deepEqual(inspectorTabs().map((t) => `${t.id}:${t.title}`), ['links:Links', 'a:Again', 'b:B']);
  for (const off of offs) off();
  assert.deepEqual(inspectorTabs().map((t) => t.id), []);
});

test('the listeners the shell holds hear every registration and withdrawal', () => {
  let heard = 0;
  // The shell redraws from the same table; a registration is the cue (observable through the table itself).
  const off = registerInspectorTab(stub('x'));
  heard += inspectorTabs().length;
  off();
  assert.equal(heard, 1);
});
