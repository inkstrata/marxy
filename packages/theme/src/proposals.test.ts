import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, setTopLevelKey } from './config.ts';
import { PROPOSAL_DEFAULTS, PROPOSALS, parseProposals, proposalsAfter } from './proposals.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('every proposal is on by default but Glance tabs, which changes what a click does', () => {
  assert.deepEqual(PROPOSALS.filter((p) => !p.default).map((p) => p.id), ['glance']);
  assert.equal(parseConfig(enc('')).config.proposals.glance, false);
});

test('the file names a proposal by its key; anything else warns and keeps the default', () => {
  const warnings: string[] = [];
  const { proposals, named } = parseProposals({ glance: true, minimap: 'yes', sparkles: true }, warnings);
  assert.equal(proposals.glance, true);
  assert.equal(proposals.minimap, PROPOSAL_DEFAULTS.minimap);
  assert.deepEqual(named, { glance: true });
  assert.equal(warnings.length, 2);
  assert.ok(parseProposals('on', []).proposals === PROPOSAL_DEFAULTS);
});

test('a switch writes only the proposals that differ from their defaults, and none is the key taken out', () => {
  assert.equal(proposalsAfter({}, 'glance', true), '{ glance = true }');
  // In the registry's order, whatever order they were switched in.
  assert.equal(proposalsAfter({ glance: true }, 'minimap', false), '{ minimap = false, glance = true }');
  assert.equal(proposalsAfter({ glance: true }, 'glance', false), null);
  assert.equal(proposalsAfter({ paging: true }, 'paging', true), null);
});

test('the written line reads back as what was switched, through the same edit every setting uses', () => {
  const value = proposalsAfter({}, 'glance', true)!;
  const bytes = setTopLevelKey(enc('size = 22\n[strip]\nreport = ["paths"]\n'), 'proposals', value);
  const { config, warnings } = parseConfig(bytes);
  assert.deepEqual(warnings, []);
  assert.equal(config.proposals.glance, true);
  assert.equal(config.size, 22);
  assert.match(new TextDecoder().decode(bytes), /^size = 22\nproposals = \{ glance = true \}\n\[strip\]/);
});
