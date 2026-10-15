// The newest release of a changelog (K-22): the first version heading, skipping "Unreleased", and the bytes of its section.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { newestRelease, versionLabel } from './release-notes.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const releaseOf = (text: string) => {
  const bytes = enc.encode(text);
  const release = newestRelease(parseMarkdown(bytes, { file: 'CHANGELOG.md' }));
  return release === null ? null : { label: release.label, text: dec.decode(bytes.subarray(release.range.start, release.range.end)) };
};

test('the newest release is the first version heading, through the line before the next one', () => {
  const text = '# Changelog\n\nIntro.\n\n## [1.4.0] - 2026-09-12\n\n### Added\n\n- a\n\n## [1.3.0] - 2026-08-01\n\n- b\n';
  assert.deepEqual(releaseOf(text), { label: '1.4.0', text: '## [1.4.0] - 2026-09-12\n\n### Added\n\n- a\n\n' });
});

test('an Unreleased section is skipped', () => {
  const text = '# Changelog\n\n## Unreleased\n\n- soon\n\n## v2.0.1 — 2026-01-02\n\n- x\n';
  assert.deepEqual(releaseOf(text), { label: 'v2.0.1', text: '## v2.0.1 — 2026-01-02\n\n- x\n' });
});

test('the last release runs to the end of the file, CRLF and a missing final newline kept as they are', () => {
  assert.deepEqual(releaseOf('## 1.0.0\r\n\r\n- first'), { label: '1.0.0', text: '## 1.0.0\r\n\r\n- first' });
});

test('a changelog with no version heading has no release; a version inside a quote is not one', () => {
  assert.equal(releaseOf('# Changelog\n\n## Unreleased\n\n- a\n\n## Older\n\n- b\n'), null);
  assert.equal(releaseOf('# Changelog\n\n> ## 1.0.0\n'), null);
  assert.equal(releaseOf('Just prose with 1.2.3 in it.\n'), null);
});

test('the label is the version without brackets, date or link', () => {
  const label = (md: string) => versionLabel((parseMarkdown(enc.encode(md), { file: 'c.md' }).children[0] as never));
  assert.equal(label('## [1.4.0](https://example.invalid/x) - 2026-09-12\n'), '1.4.0');
  assert.equal(label('## Version 3.1\n'), '3.1');
  assert.equal(label('## Added\n'), null);
});
