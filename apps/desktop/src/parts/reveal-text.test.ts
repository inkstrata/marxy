import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { around, delimiterIn, droppedFields, splitDelimited, splitGap, valueIn } from './reveal-text.ts';

test('a gap across lines: the first line ends the part before, the last leads the next, comments between', () => {
  assert.deepEqual(splitGap(',\n  "river": '), { trail: ',', lines: [], lead: '"river":' });
  assert.deepEqual(splitGap('{\n  "name": '), { trail: '{', lines: [], lead: '"name":' });
  assert.deepEqual(splitGap('\n# the sites we read\n\n- '), { trail: '', lines: ['# the sites we read'], lead: '-' });
  assert.deepEqual(splitGap('\r\n  ]'), { trail: '', lines: [], lead: ']' });
});

test('a gap on one line: a comma ends the part before, the rest leads the next', () => {
  assert.deepEqual(splitGap(', "river": '), { trail: ',', lines: [], lead: '"river":' });
  assert.deepEqual(splitGap('{ "id": '), { trail: '', lines: [], lead: '{ "id":' });
  assert.deepEqual(splitGap(' }'), { trail: '', lines: [], lead: '}' });
});

test('a key is found in what leads its value', () => {
  assert.deepEqual(around('"name":', 'name'), { before: '"', after: '":' });
  assert.deepEqual(around('name = ', 'name'), { before: '', after: ' = ' });
  assert.equal(around('-', '0'), null);
  assert.equal(around('x', ''), null);
});

test('a value is found in its range with its quotes; what is before and after it is the markup', () => {
  assert.deepEqual(valueIn('"gauges"', 'gauges'), { before: '', value: '"gauges"', after: '' });
  assert.deepEqual(valueIn('name: gauges', 'gauges'), { before: 'name: ', value: 'gauges', after: '' });
  assert.deepEqual(valueIn("unit = 'm' # metres", 'm'), { before: 'unit = ', value: "'m'", after: ' # metres' });
  assert.deepEqual(valueIn('"a\\"b"', 'a"b'), { before: '', value: '"a\\"b"', after: '' }, 'an escape: the whole range');
});

test('a delimited line splits into its fields as written, a quoted field keeping its delimiter and doubled quotes', () => {
  assert.deepEqual(splitDelimited('Tees,1.42,2026-10-01', ','), ['Tees', '1.42', '2026-10-01']);
  assert.deepEqual(splitDelimited('"Tees, upper",1.42,"say ""hi"""', ','), ['"Tees, upper"', '1.42', '"say ""hi"""']);
  assert.deepEqual(splitDelimited('a\tb\t', '\t'), ['a', 'b', '']);
  assert.equal(delimiterIn(';'), ';');
  assert.equal(delimiterIn('"\t"'), '\t');
  assert.equal(delimiterIn(''), ',');
});

test('a transcript record: the fields the reading did not draw, the message\'s text left out', () => {
  const rec = { type: 'assistant', uuid: 'abc', timestamp: '2026-10-14T09:00:00Z', message: { role: 'assistant', model: 'm-1', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 3 } }, cwd: 'x'.repeat(100) };
  const got = droppedFields(rec);
  assert.deepEqual(got.slice(0, 5), ['type: assistant', 'uuid: abc', 'timestamp: 2026-10-14T09:00:00Z', 'message.model: m-1', 'message.usage: {1}']);
  assert.match(got[5]!, /^cwd: x{80}…$/);
  assert.deepEqual(droppedFields([1, 2]), []);
  assert.deepEqual(droppedFields('text'), []);
});
