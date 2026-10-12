// K-07.1: a malformed [strip] or [[kind]] reaches the reader once, as a refusal naming the rule; a good config says nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '@marxy/theme/src/config.ts';
import { createConfigWarningReporter, configWarningText } from './config-copy.ts';

const warningsOf = (toml: string) => parseConfig(new TextEncoder().encode(toml)).warnings;
function harness() {
  const shown: { kind: string; text: string }[] = [];
  return { shown, report: createConfigWarningReporter((n) => void shown.push({ kind: n.kind, text: n.text })) };
}

test('a bad [[kind]] rule shows one refusal that names the rule', () => {
  const h = harness();
  h.report(warningsOf('[[kind]]\nglob = "**/*.md"\nis = "report"\n\n[[kind]]\nis = "report"\n'));
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0]!.kind, 'refused');
  assert.match(h.shown[0]!.text, /^\[\[kind\]\] rule 2 has no glob, so it is skipped · the other rules apply · fix it in config\.toml$/);
});

test('a bad [strip] entry shows one refusal that names the entry', () => {
  const h = harness();
  h.report(warningsOf('[strip]\nreport = ["outline", "nope"]\n'));
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0]!.kind, 'refused');
  assert.match(h.shown[0]!.text, /^\[strip\] report lists "nope", which is not a tool, so that tool is left out · the other tools apply/);
  assert.match(h.shown[0]!.text, /fix it in config\.toml/);
});

test('a good config shows nothing', () => {
  const h = harness();
  h.report(warningsOf('size = 22\n[[kind]]\nglob = "**/*.log"\nis = "log"\n[strip]\nreport = ["outline"]\n'));
  assert.deepEqual(h.shown, []);
});

test('a reload of an unchanged file does not repeat the warning; a changed one does', () => {
  const h = harness();
  const bad = warningsOf('[strip]\nreport = ["nope"]\n');
  h.report(bad);
  h.report(bad);
  assert.equal(h.shown.length, 1);
  h.report(warningsOf('[strip]\ncode = ["nope"]\n'));
  assert.equal(h.shown.length, 2);
  h.report([]);
  h.report(bad);
  assert.equal(h.shown.length, 3);
});

test('more than three problems show three, then one count that says where the rest are', () => {
  const h = harness();
  h.report(warningsOf('[strip]\nreport = ["a", "b", "c", "d", "e"]\n'));
  assert.equal(h.shown.length, 4);
  assert.match(h.shown[3]!.text, /^2 more problems in config\.toml, in \[strip\] or \[\[kind\]\] · /);
});

test('each parser warning reads as plain words, with no parser semicolons', () => {
  const all = warningsOf(
    '[[kind]]\nglob = "a"\nis = "nope"\n[[kind]]\nglob = "rel/x"\nis = "log"\n[[kind]]\nglob = "**/x"\nis = "log"\nread = "yes"\n' +
      '[strip]\nreport = ["outline", "outline", "x"]\nzzz = ["outline"]\ncode = "no"\n',
  );
  const texts = all.map((w) => configWarningText(w));
  for (const t of texts) {
    assert.ok(t !== null);
    assert.doesNotMatch(t, /; |skipped.*skipped/);
    assert.match(t, / · fix it in config\.toml$/);
  }
});
