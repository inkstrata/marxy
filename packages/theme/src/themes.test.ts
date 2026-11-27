// Themes as looks: pins drawn as written and held to their floors, dials that carry a
// palette rather than drop it, a palette written down when it is saved, the file form, one-scheme themes and faces by kind.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hexToRgb, rgbToOklch } from './lang-palettes.ts';
import { hexRatio, merged, palette, resolve, type Look } from './look.ts';
import { defaultLookState, fromFile, saveAs, setLook, toFile, tweak } from './look-state.ts';
import { LOOKS, LOOK_GROUPS } from './looks.ts';

const look = (id: string): Look => LOOKS.find((l) => l.id === id)!;
const hue = (hex: string): number => rgbToOklch(hexToRgb(hex)!)[2];

test('every shipped look stands on a shelf, the shelves are in order, and Ink comes first', () => {
  assert.equal(LOOKS[0]!.id, 'ink');
  const shelves = LOOK_GROUPS.map((g) => g.id);
  for (const l of LOOKS) assert.ok(l.group && shelves.includes(l.group), l.id);
  assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length, 'ids are unique');
  for (const id of ['polar', 'midnight', 'black', 'ember', 'solarized', 'gruvbox', 'rose-pine', 'catppuccin', 'dim', 'mint', 'newsprint', 'moss']) assert.ok(look(id), id);
  // Dark first, as the app opens dark; the dark ones named for their dark page.
  assert.deepEqual(LOOKS.slice(0, 5).map((l) => l.name), ['Ink', 'Night', 'Midnight', 'Black', 'Ember']);
  const firstLight = LOOKS.findIndex((l) => l.group === 'light');
  assert.ok(firstLight > 0 && LOOKS.slice(firstLight).every((l) => l.group === 'light'), 'every dark look before every light one');
});

test('a shipped theme resolves to its pins as drawn: nothing a built-in draws has to move to hold its floor', () => {
  for (const l of LOOKS.filter((k) => k.pins)) {
    for (const scheme of Object.keys(l.pins!) as ('day' | 'night')[]) {
      const p = palette(l, scheme);
      assert.deepEqual(p.moved, [], `${l.id} ${scheme}`);
      assert.equal(p.tokens['--marxy-color-bg'], l.pins![scheme]!.bg, `${l.id} ${scheme} ground`);
      if (l.pins![scheme]!.text) assert.equal(p.tokens['--marxy-color-text'], l.pins![scheme]!.text, `${l.id} ${scheme} text`);
    }
  }
});

test('Ink 2 by night: a quiet ladder, a code well, and no two code colours that fall together for any eye', () => {
  const t = palette(look('ink'), 'night').tokens;
  const on = (k: string): number => hexRatio(t[k]!, t['--marxy-color-bg']!);
  assert.ok(on('--marxy-color-text') > 13 && on('--marxy-color-text') < 13.6, `text ${on('--marxy-color-text')}`);
  assert.ok(on('--marxy-color-text-strong') > on('--marxy-color-text'));
  assert.ok(on('--marxy-color-text-secondary') >= 7, 'secondary holds AAA');
  assert.ok(on('--marxy-color-text-faint') < on('--marxy-color-text-secondary') - 1, 'faint sits a step below secondary');
  assert.ok(hexRatio(t['--marxy-color-code-bg']!, t['--marxy-color-bg']!) >= 1.1, 'the code well is apart from the page');
  assert.notEqual(t['--marxy-tok-number'], t['--marxy-tok-function']);
});

test('a pin drawn under its floor is walked to it, keeps its hue, and is said to have moved', () => {
  const s = tweak(defaultLookState(), 'pins', { ...look('ink').pins, night: { ...look('ink').pins!.night!, text: '#4a4844' } });
  const r = resolve(s, { kind: 'article', width: 900 }, { scheme: 'night' });
  assert.ok(r.facts.contrast >= 7, String(r.facts.contrast));
  const m = r.moved.find((x) => x.token === '--marxy-color-text');
  assert.ok(m && m.drawn === '#4a4844', JSON.stringify(r.moved));
  assert.ok(Math.abs(hue(r.tokens['--marxy-color-text']!) - hue('#4a4844')) < 12, 'the hue is kept');
});

test('the dials carry a palette: the tone moves its grounds together, the accent turns its family, the ink re-solves its text', () => {
  const ink = look('ink');
  const at = (tweaks: Partial<Look>): Readonly<Record<string, string>> => resolve(defaultLookState(), { kind: 'article', width: 900 }, { id: 'ink', tweaks, scheme: 'night' }).tokens;
  const base = at({});
  const warmer = at({ night: { ...ink.night, l: ink.night.l + 0.04 } });
  // The surface keeps its lift over the page: both moved, by the same step.
  const lift = (t: Readonly<Record<string, string>>): number => rgbToOklch(hexToRgb(t['--marxy-color-surface']!)!)[0] - rgbToOklch(hexToRgb(t['--marxy-color-bg']!)!)[0];
  assert.notEqual(warmer['--marxy-color-bg'], base['--marxy-color-bg']);
  assert.ok(Math.abs(lift(warmer) - lift(base)) < 0.01, `${lift(warmer)} ${lift(base)}`);
  const turned = at({ accent: ink.accent + 120 });
  assert.ok(Math.abs(((hue(turned['--marxy-color-accent']!) - hue(base['--marxy-color-accent']!) + 540) % 360) - 180 - 120) < 15, 'the accent turned by the dial');
  assert.equal(turned['--marxy-tok-string'], base['--marxy-tok-string'], 'code colours are not the accent dial’s');
  const brighter = at({ inkNight: 16 });
  assert.ok(hexRatio(brighter['--marxy-color-text']!, brighter['--marxy-color-bg']!) >= 15.9, 'the text meets the new target');
  const quiet = at({ code: 0 });
  assert.equal(quiet['--marxy-tok-string'], quiet['--marxy-color-code-text'], 'ink only: every token is the code’s ink');
});

test('saved as mine, a moved palette is written down: the look of one’s own resolves as the moved look did', () => {
  const ink = look('ink');
  const s = tweak(defaultLookState(), 'night', { ...ink.night, l: ink.night.l + 0.05, h: 60 });
  const before = resolve(s, { kind: 'article', width: 900 }, { scheme: 'night' }).tokens;
  const { state, look: mine } = saveAs(s, 'Warmer ink');
  assert.equal(mine.theme, undefined, 'a look of one’s own names no bundled sheet');
  const after = resolve(state, { kind: 'article', width: 900 }, { scheme: 'night' }).tokens;
  for (const k of ['--marxy-color-bg', '--marxy-color-surface', '--marxy-color-text', '--marxy-color-accent', '--marxy-tok-string']) assert.equal(after[k], before[k], k);
});

test('a theme as a file: palette, faces and type read back the same; an older file without them reads as Paper did', () => {
  const s = setLook(defaultLookState(), 'polar');
  const file = toFile(s, 'polar');
  assert.match(file, /\[palette\.night\.code\]\nkeyword = "#ff99c4"/);
  assert.match(file, /size_face = "literata"/);
  const back = fromFile('mine-polar', file)!;
  assert.deepEqual(back.pins, merged(s, 'polar').pins);
  assert.equal(back.headTracking, look('polar').headTracking);
  assert.equal(back.credit, look('polar').credit);
  const old = fromFile('mine-old', 'name = "Old"\n[tone]\naccent = 30\n[type]\nface = "sitka"\n')!;
  assert.equal(old.pins, undefined);
  assert.equal(old.faces, undefined);
  assert.equal(old.size, look('paper').size);
  // A palette without a ground is no palette: there is nothing to hold its colours against.
  assert.equal(fromFile('x', '[palette.night]\ntext = "#ffffff"\n')!.pins, undefined);
  // Only colours and references are read as colours.
  assert.equal(fromFile('y', '[palette.night]\nbg = "#000000"\ntext = "url(x)"\n')!.pins!.night!.text, undefined);
});

test('a theme drawn for one scheme keeps it: Fjord by day is Fjord’s night, and the page is dark', () => {
  const r = resolve(setLook(defaultLookState(), 'fjord'), { kind: 'article', width: 900 }, { scheme: 'day' });
  assert.equal(r.scheme, 'night');
  assert.equal(r.tokens['--marxy-color-bg'], look('fjord').pins!.night!.bg);
  assert.ok(r.why.some((w) => /^Drawn for night only/.test(w.text)));
});

test('faces by kind: in Ink an article is set in Source Serif, a README in Inter, a report in Hyperlegible, all at one size', () => {
  const s = defaultLookState();
  const at = (kind: string) => resolve(s, { kind, width: 900, scheme: 'day' });
  assert.match(at('article').tokens['--marxy-font-text']!, /Source Serif 4/);
  assert.match(at('readme').tokens['--marxy-font-text']!, /^"Inter"/);
  assert.match(at('report').tokens['--marxy-font-text']!, /Atkinson Hyperlegible Next/);
  assert.match(at('book').tokens['--marxy-font-text']!, /^"Literata"/);
  assert.equal(at('article').facts.size, 20);
  assert.equal(at('readme').facts.size, 20);
  assert.equal(at('book').facts.size, 20);
});
