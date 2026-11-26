// The browser build's stand-in for the native font and media readers answers for every demo font and recording, by the
// same key the Rust test writes (size and FNV-1a), and for nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { nativeKey, standInEnvelope, standInFontFacts, standInGlyph, standInMediaFacts } from './native-stand-in.ts';

const demo = new URL('../../../../fixtures/demo/', import.meta.url);
const files = (dir: string): [string, Uint8Array][] =>
  readdirSync(new URL(`${dir}/`, demo)).map((name) => [name, new Uint8Array(readFileSync(new URL(`${dir}/${name}`, demo)))]);

test('the key is size and FNV-1a, as stand_in.rs writes it', () => {
  assert.equal(nativeKey(new Uint8Array()), '0:811c9dc5');
  assert.equal(nativeKey(new TextEncoder().encode('a')), '1:e40c292c');
});

test('every demo font and recording has its facts; other bytes have none', () => {
  for (const [name, bytes] of files('fonts')) {
    const facts = standInFontFacts(bytes);
    assert.ok(facts && facts.faces.length > 0, name);
    assert.equal(standInMediaFacts(bytes), null, name);
  }
  for (const [name, bytes] of files('media')) assert.ok(standInMediaFacts(bytes), name);
  assert.equal(standInFontFacts(new Uint8Array([0, 1, 0, 0])), null);
});

test('a glyph and a waveform come back in the shell’s shapes', () => {
  const ttf = new Uint8Array(readFileSync(new URL('fonts/TidemarkSans-Regular.ttf', demo)));
  const r = standInGlyph(ttf, 0, 0x52);
  assert.ok(r && r.glyph > 0 && (r.advance ?? 0) > 0 && (r.contours ?? 0) > 0 && (r.points ?? 0) > 0);
  assert.equal(standInGlyph(ttf, 0, 0x4e00), null, 'a character the font does not map');
  const wav = new Uint8Array(readFileSync(new URL('media/bell-buoy.wav', demo)));
  const envelope = standInEnvelope(wav);
  assert.equal(envelope?.peaks.length, 1000);
  assert.equal(envelope?.sampled, false);
  assert.equal(standInEnvelope(new Uint8Array(readFileSync(new URL('media/ferry-leaving.mp4', demo)))), null, 'no waveform for a video');
});
