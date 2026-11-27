// Shape as the scrollbar in Source: the runs of lines the strip draws, as Read would set them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceRuns } from './minimap.ts';

const runs = (text: string, markdown = true): string[] =>
  sourceRuns(text.split('\n'), markdown).map((r) => `${r.kind} ${r.from}-${r.to}`);

test('in Markdown a heading is a tick, a fence a box to its closing line, and a paragraph a bar; blank lines are gaps', () => {
  const md = ['# Title', '', 'Some words', 'run on.', '', '```sh', '$ ls', '', 'a  b', '```', 'After.', '#### Small', '## Two'].join('\n');
  assert.deepEqual(runs(md), ['h 1-1', 'p 3-4', 'b 6-10', 'p 11-12', 'h 13-13']);
});

test('a table and a quote are boxes, front matter too, and a fence left open runs to the end', () => {
  const md = ['---', 'title: x', '---', 'Text', '| a | b |', '|---|---|', '> quoted', '', '~~~~', '~~~', 'still code'].join('\n');
  assert.deepEqual(runs(md), ['b 1-3', 'p 4-4', 'b 5-7', 'b 9-11']);
});

test('any other file is runs of lines, a # or a fence no different', () => {
  assert.deepEqual(runs(['# comment', 'x = 1', '', '```', 'y'].join('\n'), false), ['p 1-2', 'p 4-5']);
});
