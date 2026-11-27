import { strict as assert } from 'node:assert';
import { test } from 'node:test';
// @ts-expect-error: the gate is plain JS
import { auditTheme } from '../../../scripts/gate-contrast.mjs';
import { LANG_PALETTES, PALETTE_ROLES, hexToRgb, rgbToOklch } from './lang-palettes.ts';
import { FLOOR, hexRatio, legible, maxContrast, nearestLegible, padFromTone, resolve, ruleMatches, schemeOf, toneFromPad, type Look, type LookState, type Scheme } from './look.ts';
import { addRule, defaultLookState, fromFile, layOver, lookFileError, removeMine, removeRule, reset, saveAs, setLean, setLook, setMode, stateFromToml, stateToToml, toFile, toggleRule, tweak } from './look-state.ts';
import { FACE_IDS, LOOKS } from './looks.ts';

const KINDS = ['article', 'report', 'book', 'readme', 'docs', 'code', 'transcript', 'data', 'notes', 'changelog', 'log', 'terminal', 'diff', 'html'];
const css = (tokens: Readonly<Record<string, string>>): string => `:root { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join(' ')} }`;
const audit = (look: Look | string, scheme: Scheme, more: boolean, state: LookState = defaultLookState()): string[] => {
  const over = typeof look === 'string' ? { id: look, scheme } : { id: 'paper', scheme, tweaks: look };
  const r = resolve(state, { kind: 'code', width: 900, more }, over);
  return auditTheme(`look`, css(r.tokens), ['dark'], more ? { mode: 'more', overrides: {} } : {}).failures as string[];
};

test('every look holds every floor gate-contrast holds, by day and night, with and without more contrast', () => {
  for (const l of LOOKS) for (const scheme of ['day', 'night'] as const) for (const more of [false, true]) assert.deepEqual(audit(l.id, scheme, more), [], `${l.id} ${scheme} ${more}`);
});

test('no setting of the dials makes a page illegible: 240 random looks hold every floor', () => {
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 120; i += 1) {
    const tone = { l: rnd(), c: rnd() * 0.06, h: rnd() * 360 };
    const tw = {
      ...LOOKS[i % LOOKS.length]!,
      day: tone,
      night: { l: rnd() * 0.4, c: rnd() * 0.05, h: rnd() * 360 },
      ink: 7 + rnd() * 14,
      inkNight: 7 + rnd() * 12,
      accent: rnd() * 360,
      code: rnd(),
      tint: rnd() < 0.2 ? { h: rnd() * 360, c: rnd() * 0.1 } : undefined,
    } as Look;
    for (const scheme of ['day', 'night'] as const) assert.deepEqual(audit(tw, scheme, i % 3 === 0), [], `random look ${i} ${scheme}: ${JSON.stringify(tw.day)}`);
  }
});

test('the dead band: a mid grey is pushed to the nearest tone some ink holds 7 : 1 on; a legible tone is left alone', () => {
  const grey = { l: 0.6, c: 0, h: 0 };
  assert.equal(legible(grey), false);
  const moved = nearestLegible(grey);
  assert.ok(legible(moved) && maxContrast(moved) >= FLOOR);
  assert.ok(Math.abs(moved.l - grey.l) < 0.25);
  const paper = LOOKS[0]!.day;
  assert.equal(nearestLegible(paper), paper);
});

test('the tone pad: warmth and lightness go there and back', () => {
  for (const [x, y] of [[0.1, 0.05], [0.9, 0.1], [0.5, 0.8], [0.25, 0.7]] as const) {
    const p = padFromTone(toneFromPad(x, y));
    assert.ok(Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6, `${x},${y} -> ${p.x},${p.y}`);
  }
});

test('resolve maps the look onto the --marxy-* tokens, and the ink is the look\'s target', () => {
  const r = resolve(defaultLookState(), { kind: 'article', width: 900 }, { scheme: 'day' });
  for (const t of ['--marxy-color-bg', '--marxy-color-text', '--marxy-tok-keyword', '--marxy-font-text', '--marxy-size-body', '--marxy-line-box', '--marxy-measure-chars', '--marxy-pl-rust-keyword']) assert.ok(t in r.tokens, t);
  // Ink by day: its paper and its ink as drawn (15.85 : 1).
  assert.ok(r.facts.contrast >= 15.5 && r.facts.contrast < 16.2, String(r.facts.contrast));
  assert.equal(r.facts.chars, 66);
  assert.equal(Number.parseInt(r.tokens['--marxy-line-box']!, 10) % 2, 0, 'an even line box');
  assert.deepEqual(r.why.map((w) => w.text), ['Ink']);
});

test('rules: reading/ uses Book, code is fixed width, a narrow pane is tightened, lean back and night are said', () => {
  let s = defaultLookState();
  const book = resolve(s, { kind: 'article', path: '/home/me/reading/on-margins.md', width: 900, scheme: 'day' });
  assert.equal(book.look.id, 'book');
  assert.match(book.why[0]!.text, /^Book, because: files in reading\/ use Book$/);
  assert.equal(resolve(s, { kind: 'article', path: '/home/me/plans/x.md', scheme: 'day' }).look.id, 'ink');
  const code = resolve(s, { kind: 'code', scheme: 'day' });
  assert.equal(code.subject, 'mono');
  assert.match(code.tokens['--marxy-font-text']!, /JetBrains Mono/);
  assert.ok(code.why.some((w) => w.rule === 'kinds'));
  const narrow = resolve(s, { kind: 'article', width: 520, scheme: 'day' });
  assert.ok(narrow.why.some((w) => w.text === 'Tightened for a 520 px pane'));
  assert.ok(narrow.facts.size < resolve(s, { kind: 'article', width: 900, scheme: 'day' }).facts.size);
  const working = resolve(s, { kind: 'notes', scheme: 'day' });
  assert.equal(working.facts.chars, 73);
  s = setLean(s, true);
  const lean = resolve(s, { kind: 'article', scheme: 'day' });
  assert.equal(lean.facts.chars, 52);
  assert.ok(lean.why.some((w) => w.rule === 'lean'));
  s = toggleRule(s, 'lean', false);
  assert.equal(resolve(s, { kind: 'article', scheme: 'day' }).facts.chars, 66);
  const night = resolve(setLook(setMode(s, 'night'), 'paper'), { kind: 'article' });
  assert.equal(night.scheme, 'night');
  assert.ok(night.why.some((w) => w.rule === 'dark' && /^Night tone; weight eased by 20$/.test(w.text)));
  assert.equal(night.tokens['--marxy-weight-body'], '400', 'Sitka is not a variable face');
  const inkNight = resolve(setMode(s, 'night'), { kind: 'article' });
  assert.ok(inkNight.why.some((w) => w.rule === 'dark' && /^Night tone; the theme's own night weights$/.test(w.text)));
  assert.equal(inkNight.tokens['--marxy-weight-body'], '380', 'Ink sets its night weight by hand');
});

test('day or night: the system, the clock, a choice; with the dark rule off, only a chosen night', () => {
  const s = defaultLookState();
  assert.equal(schemeOf(s, { systemDark: true }), 'night');
  assert.equal(schemeOf(setMode(s, 'clock'), { hour: 21 }), 'night');
  assert.equal(schemeOf(setMode(s, 'clock'), { hour: 9 }), 'day');
  assert.equal(schemeOf(toggleRule(s, 'dark', false), { systemDark: true }), 'day');
  assert.equal(schemeOf(setMode(toggleRule(s, 'dark', false), 'night')), 'night');
});

test('a rule of your own: when it matches, it says so and sets what it sets; removed, it is gone', () => {
  let s = addRule(defaultLookState(), { label: 'Files in notes/ use Slate', when: { path: 'notes/' }, set: { look: 'slate' } });
  s = addRule(s, { label: 'At night, a measure of 58', when: { scheme: 'night' }, set: { measure: 58 } });
  const r = resolve(s, { kind: 'article', path: '/a/notes/b.md', scheme: 'night' });
  assert.equal(r.look.id, 'slate');
  assert.equal(r.facts.chars, 58);
  assert.ok(r.why.some((w) => w.text === 'At night, a measure of 58'));
  s = removeRule(s, s.userRules.at(-1)!.id);
  assert.equal(resolve(s, { kind: 'article', path: '/a/notes/b.md', scheme: 'night' }).facts.chars, 72);
});

test('a rule for an absolute folder takes that folder and what is under it, never a sibling that starts the same', () => {
  const at = (path: string, p: string): boolean => ruleMatches({ path }, { path: p, kind: null, scheme: 'day', width: 800 });
  assert.equal(at('C:/Users/ian/Notes', 'C:/Users/ian/Notes2/a.md'), false);
  assert.equal(at('/home/ian/notes', '/home/ian/notes-private/a.md'), false);
  assert.equal(at('C:\\Users\\ian\\Notes\\', 'c:\\users\\ian\\notes\\sub\\a.md'), true);
  assert.equal(at('/home/ian/notes', '/home/ian/notes'), true);
  assert.equal(at('/', '/anything/a.md'), true);
  assert.equal(at('C:/', 'C:/x/a.md'), true);
});

test('colour in code: at ink only every language takes the shared colour; one set for all too; the accent moves the shared hues only', () => {
  const s = defaultLookState();
  const at = (tweaks: Partial<Look>): Record<string, string> => resolve(s, { kind: 'code', scheme: 'day' }, { id: 'paper', tweaks }).tokens as Record<string, string>;
  const ink = at({ code: 0 });
  for (const id of Object.keys(LANG_PALETTES)) assert.equal(ink[`--marxy-pl-${id}-keyword`], ink['--marxy-tok-keyword'], id);
  const one = at({ perLanguage: false });
  for (const id of Object.keys(LANG_PALETTES)) assert.equal(one[`--marxy-pl-${id}-keyword`], one['--marxy-tok-keyword'], id);
  const a = at({});
  const b = at({ accent: 30 });
  assert.equal(b['--marxy-pl-rust-keyword'], a['--marxy-pl-rust-keyword']);
  assert.notEqual(b['--marxy-tok-keyword'], a['--marxy-tok-keyword']);
  const keywords = Object.keys(LANG_PALETTES).map((id) => a[`--marxy-pl-${id}-keyword`]);
  assert.equal(new Set(keywords).size, keywords.length, 'each language its own keyword colour');
});

test('more colour on the dial is more chroma in a palette, and Rust stays orange', () => {
  const chroma = (code: number): [number, number] => {
    const hex = resolve(defaultLookState(), { kind: 'code', scheme: 'day' }, { id: 'paper', tweaks: { code } }).tokens['--marxy-pl-rust-keyword']!;
    const [, c, h] = rgbToOklch(hexToRgb(hex)!);
    return [c, h];
  };
  const [c1, h1] = chroma(0.25);
  const [c2] = chroma(0.5);
  const [c3, h3] = chroma(1);
  assert.ok(c1 < c2 && c2 <= c3 + 0.005, `${c1} ${c2} ${c3}`);
  for (const h of [h1, h3]) assert.ok(h > 20 && h < 75, String(h));
  assert.equal(PALETTE_ROLES.length, 5);
});

test('state: a change, undone; saved as mine, and removed; switches kept', () => {
  let s = tweak(defaultLookState(), 'size', 22);
  assert.deepEqual(s.tweaks, { ink: { size: 22 } });
  assert.deepEqual(tweak(s, 'size', 20).tweaks, {}, 'the look\'s own value is no change');
  assert.deepEqual(reset(s).tweaks, {});
  const { state, look } = saveAs(s, 'My Paper');
  assert.equal(state.id, 'mine-my-paper');
  assert.equal(look.size, 22);
  assert.deepEqual(state.tweaks, {});
  assert.equal(removeMine(state, look.id).id, 'ink');
  s = toggleRule(s, 'wide');
  assert.equal(s.rules.wide, true);
});

test('Increase contrast holds every language’s own colours to 7 : 1 on the grounds code sits on, in every look', () => {
  const low: string[] = [];
  // Large print draws code in ink only, and the editors' themes put every language in their own one set: their languages
  // take the shared colours, which are not a palette of their own (the gate holds those at 4.5 : 1, like every code role).
  for (const l of LOOKS.filter((k) => k.code > 0.08 && k.perLanguage !== false)) {
    for (const scheme of ['day', 'night'] as const) {
      const t = resolve(defaultLookState(), { kind: 'code', width: 900, more: true }, { id: l.id, scheme }).tokens;
      for (const id of Object.keys(LANG_PALETTES)) {
        for (const role of PALETTE_ROLES) {
          for (const ground of ['--marxy-color-bg', '--marxy-color-code-bg', '--marxy-color-selection']) {
            const r = hexRatio(t[`--marxy-pl-${id}-${role}`]!, t[ground]!);
            if (r < 7) low.push(`${l.id} ${scheme} ${id}.${role} on ${ground}: ${r.toFixed(2)}`);
          }
        }
      }
    }
  }
  assert.deepEqual(low, []);
});

test('own looks never take another’s place: a name whose slug is taken gets a number', () => {
  let s = tweak(defaultLookState(), 'size', 22);
  const a = saveAs(s, 'Ночь');
  s = tweak(a.state, 'size', 24);
  const b = saveAs(s, 'День');
  assert.equal(a.look.id, 'mine-look');
  assert.equal(b.look.id, 'mine-look-2');
  assert.deepEqual(b.state.mine.map((m) => [m.id, m.name, m.size]), [['mine-look', 'Ночь', 22], ['mine-look-2', 'День', 24]]);
  const c = saveAs(saveAs(b.state, 'My look').state, 'my-look');
  assert.deepEqual(c.state.mine.map((m) => m.id), ['mine-look', 'mine-look-2', 'mine-my-look', 'mine-my-look-2']);
});

test('a look as its file: how much colour and which languages, and read back to the same look', () => {
  const s = tweak(tweak(defaultLookState(), 'measure', 70), 'langs', { rust: { keyword: 30 } });
  const file = toFile(s);
  assert.match(file, /code_colour = 0\.5\s+# how much/);
  assert.match(file, /per_language = true\s+# which: Rust, Python, Go, TypeScript, JavaScript, SQL, Shell, CSS/);
  assert.match(file, /\[code\.rust\]\s+# hues of your own/);
  const back = fromFile('mine-x', file)!;
  // Ink is drawn by hand: its file lists its palette and its faces by kind, and both read back as they were.
  assert.match(file, /\[palette\.night\]\nbg = "#151412"/);
  assert.match(file, /\[faces\]\s+# a face of its own/);
  const { id: _a, name: _b, blurb: _c, mine: _d, theme: _e2, partner: _e3, ...want } = { ...LOOKS[0]!, measure: 70, perLanguage: true, langs: { rust: { keyword: 30 } }, headStyle: 'normal', caps: false, figures: 'lining' } as Look;
  const { id: _e, name: _f, blurb: _g, mine: _h, ...got } = back;
  assert.deepEqual(got, want);
  assert.equal(fromFile('x', 'not = [toml'), null);
});

test('look.toml: the state written and read back, with a look of your own beside it', () => {
  let s = setMode(setLean(tweak(defaultLookState(), 'day', { l: 0.95, c: 0.02, h: 90 }), true), 'clock');
  s = toggleRule(addRule(s, { label: 'Wide panes at 72', when: { minWidth: 1400 }, set: { measure: 72 } }), 'logs', true);
  const { state, look } = saveAs(s, 'Mine');
  const back = stateFromToml(stateToToml(state), [look]);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(state)));
  const none = stateFromToml(stateToToml({ ...defaultLookState(), userRules: [] }));
  assert.deepEqual(none.userRules, [], 'removing the sample rules is kept');
  assert.equal(stateFromToml('garbage = [').id, 'ink');
  assert.ok(FACE_IDS.includes('sitka'));
});

test('a narrow pane never makes type larger: Console code and a small Draft stay at or under their wide size', () => {
  const s = defaultLookState();
  for (const [id, kind, tweaks] of [['console', 'code', {}], ['draft', 'article', { size: 14 }], ['paper', 'log', {}]] as const) {
    const at = (width: number): number => resolve(s, { kind, width, scheme: 'day' }, { id, tweaks }).facts.size;
    assert.ok(at(520) <= at(900), `${id} ${kind}: ${at(520)} > ${at(900)}`);
  }
});

test('setting a value a look leaves unsaid to what it means is no change: normal headings, no capitals, lining figures, own hues', () => {
  const s = defaultLookState();
  for (const [k, v] of [['headStyle', 'normal'], ['caps', false], ['figures', 'lining'], ['perLanguage', true], ['langs', {}]] as const) assert.deepEqual(tweak(s, k, v as never).tweaks, {}, k);
  assert.deepEqual(tweak(s, 'headStyle', 'italic').tweaks, { ink: { headStyle: 'italic' } });
});

test('lookFileError says why a look.toml is not TOML, and nothing for one that is', () => {
  assert.equal(lookFileError(stateToToml(defaultLookState())), null);
  assert.equal(typeof lookFileError('look = "paper'), 'string');
});

test('a change made before look.toml is read is laid over what it says, never replaced by it, and keeps the rest', () => {
  const base = defaultLookState();
  const file = saveAs(toggleRule(tweak(setMode(base, 'clock'), 'measure', 70), 'wide', true), 'Mine').state;
  const next = tweak(setLean(setLook(base, 'book'), true), 'size', 24, 'book');
  const s = layOver(file, base, next);
  assert.equal(s.id, 'book');
  assert.equal(s.lean, true);
  assert.equal(s.mode, 'clock', 'what the change left alone is the file’s');
  assert.deepEqual(s.tweaks, { ...file.tweaks, book: { size: 24 } });
  assert.deepEqual(s.mine.map((m) => m.id), ['mine-mine']);
  assert.equal(s.rules.wide, true);
  assert.deepEqual(layOver(file, base, base), file, 'no change keeps the file whole');
});
