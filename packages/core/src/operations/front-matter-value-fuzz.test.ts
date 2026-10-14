// W-17: the differential fuzz of `setFrontMatterValue`. Seeded front matter (YAML and TOML; quoted, block, anchored, flow and
// multi-line values; comments; CRLF, lone CR and mixed endings; a BOM) behind a body that looks like front matter. For every
// scalar the generator says is editable and several awkward new values: edit, splice, then parse the result again and require
// that every other key reads exactly as before, every byte outside the value's token is unchanged, the body is byte for byte
// what it was, the edited key reads as the value asked for, and the K-20 row reader (`frontmatterRows`, independent of the
// operation's own scanner) and, for TOML, a real TOML parser agree. Every value the generator says cannot be edited must be
// refused. `FM_FUZZ_SEEDS` raises the count (default 1500); a failure names its seed. The checks are `problemsWith`
// (testing/front-matter-docs.ts), which scripts/gate-fidelity.mjs runs too, over the real save path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { seededRandom } from './testing/test-kit.ts';
import { frontOf, generateDoc, NEW_VALUES, problemsWith, type GeneratedDoc } from './testing/front-matter-docs.ts';
import { frontMatterValues, setFrontMatterValue } from './front-matter-value.ts';

const enc = new TextEncoder();
const SEEDS = Number(process.env.FM_FUZZ_SEEDS ?? 1500);

function check(doc: GeneratedDoc, seed: number): number {
  const bytes = enc.encode(doc.source);
  const parsed = parseMarkdown(bytes, { file: 'f.md' });
  assert.ok(frontOf(parsed) !== null, `seed ${seed}: the generated document has no front matter:\n${JSON.stringify(doc.source)}`);
  const shown = frontMatterValues(parsed, bytes);
  assert.ok(shown !== null, `seed ${seed}`);
  assert.equal(shown.unreadable, null, `seed ${seed}: ${shown.unreadable}\n${JSON.stringify(doc.source)}`);
  assert.deepEqual(shown.values.map((v) => v.key), doc.entries.map((e) => e.key), `seed ${seed}: the keys listed\n${JSON.stringify(doc.source)}`);
  const rng = seededRandom(seed + 7);
  let edits = 0;
  doc.entries.forEach((model, i) => {
    const row = shown.values[i]!;
    assert.equal(row.refusal === null, model.editable, `seed ${seed}: ${model.key} should ${model.editable ? '' : 'not '}be editable (${row.refusal})\n${JSON.stringify(doc.source)}`);
    if (!model.editable) {
      // Whatever the new value, it is refused and nothing is offered to write.
      const refusal = setFrontMatterValue(parsed, bytes, model.key, 'Anything');
      assert.equal(refusal.ok, false, `seed ${seed}: ${model.key} was edited though it cannot be\n${JSON.stringify(doc.source)}`);
      return;
    }
    assert.equal(row.value, model.value, `seed ${seed}: ${model.key} reads ${JSON.stringify(row.value)}\n${JSON.stringify(doc.source)}`);
    for (let n = 0; n < 4; n++) {
      const value = NEW_VALUES[Math.floor(rng() * NEW_VALUES.length)]!;
      const edit = setFrontMatterValue(parsed, bytes, model.key, value);
      assert.ok(edit.ok, `seed ${seed}: ${model.key} to ${JSON.stringify(value)} was refused: ${edit.ok ? '' : edit.reason}\n${JSON.stringify(doc.source)}`);
      if (edit.unchanged) {
        assert.equal(value, model.value);
        continue;
      }
      const problems = problemsWith(bytes, model.key, value, edit, doc.format);
      assert.deepEqual(problems, [], `seed ${seed}: ${model.key} to ${JSON.stringify(value)} -> ${JSON.stringify(edit.replacement)}\n${JSON.stringify(doc.source)}`);
      edits++;
    }
  });
  return edits;
}

test(`fuzz: ${SEEDS} seeded front matters, every edit changes one value's bytes and nothing else`, () => {
  let edits = 0;
  let editable = 0;
  let refused = 0;
  const formats = { yaml: 0, toml: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const doc = generateDoc(seed);
    formats[doc.format]++;
    editable += doc.entries.filter((e) => e.editable).length;
    refused += doc.entries.filter((e) => !e.editable).length;
    edits += check(doc, seed);
  }
  assert.ok(formats.yaml > SEEDS / 3 && formats.toml > SEEDS / 5, 'both formats are generated');
  assert.ok(edits > SEEDS && editable > SEEDS / 2 && refused > SEEDS / 2, `the fuzz exercised ${edits} edits, ${editable} editable and ${refused} refused values`);
});

test('fuzz: the checker can fail (an edit that reaches past its value, or into the body, is caught)', () => {
  const src = '---\r\ntitle: Old\r\nb: 1\r\n---\r\nBody\r\n';
  const bytes = enc.encode(src);
  const doc = parseMarkdown(bytes, { file: 'f.md' });
  const edit = setFrontMatterValue(doc, bytes, 'title', 'New');
  assert.ok(edit.ok && !edit.unchanged);
  assert.deepEqual(problemsWith(bytes, 'title', 'New', edit, 'yaml'), []);
  // Normalising the line ending, as a careless splice would, is seen.
  const eatsEol = { ...edit, range: { ...edit.range, end: edit.range.end + 2 }, replacement: 'New\n' };
  assert.notDeepEqual(problemsWith(bytes, 'title', 'New', eatsEol, 'yaml'), []);
  // Touching the next key is seen.
  const next = src.indexOf('b: 1');
  const touchesNext = { ...edit, range: { ...edit.range, end: enc.encode(src.slice(0, next)).length + 4 }, replacement: 'New\r\nb: 2' };
  assert.notDeepEqual(problemsWith(bytes, 'title', 'New', touchesNext, 'yaml'), []);
  // A value that does not read back as asked is seen.
  const wrong = { ...edit, replacement: 'Newer' };
  assert.notDeepEqual(problemsWith(bytes, 'title', 'New', wrong, 'yaml'), []);
});
