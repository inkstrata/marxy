// Audio and video's page model: the line, the type a player is asked about, the Media card's rows, the facts-only
// card's words, and a waveform's peaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPlay, cannotPlayTitle, cannotPlayWhat, cannotPlayWords, durationWords, mediaLine, mediaRows, mimeOf, mimeOfExtension, peaksOf, seekAt, type MediaFacts, type MediaTrack } from './media.ts';

const track = (o: Partial<MediaTrack>): MediaTrack => ({
  kind: 'audio', codec: '', codecName: '', codecs: null, compressor: null, width: null, height: null, frameRate: null, frameRateAverage: false, frames: null,
  channels: null, sampleRate: null, bits: null, ...o,
});

const wav: MediaFacts = {
  container: 'wav', brand: null, duration: 5, durationFrom: 'data', fragmented: false, boxes: [], indexFirst: null,
  tracks: [track({ codec: 'pcm', codecName: 'PCM', channels: 1, sampleRate: 22050, bits: 16 })],
  tags: [{ key: 'title', value: 'Bell buoy, outer channel', id: 'INAM' }],
  pcm: { dataAt: 44, dataLen: 220500, channels: 1, bits: 16, float: false, rate: 22050 },
};

const mp4: MediaFacts = {
  container: 'mp4', brand: 'isom', duration: 4.157, durationFrom: 'movie', fragmented: true, boxes: ['ftyp', 'moov', 'moof', 'mdat', 'moof', 'mdat', 'mfra'], indexFirst: true,
  tracks: [
    track({ kind: 'video', codec: 'avc1', codecName: 'H.264 (AVC)', codecs: 'avc1.42C01F', compressor: 'AVC1 Coding', width: 640, height: 360, frameRate: 18.282, frameRateAverage: true, frames: 76 }),
    track({ codec: 'mp4a', codecName: 'AAC (mp4a)', codecs: 'mp4a.40.2', channels: 2, sampleRate: 48000 }),
  ],
  tags: [],
  pcm: null,
};

const prores: MediaFacts = {
  container: 'mov', brand: 'qt', duration: 12, durationFrom: 'movie', fragmented: false, boxes: ['ftyp', 'moov', 'mdat'], indexFirst: true,
  tracks: [
    track({ kind: 'video', codec: 'apch', codecName: 'Apple ProRes 422 HQ', compressor: 'Apple ProRes 422 HQ', width: 1920, height: 1080, frameRate: 25, frames: 300 }),
    track({ codec: 'sowt', codecName: 'PCM, little-endian', channels: 2, sampleRate: 48000, bits: 16 }),
  ],
  tags: [{ key: 'title', value: 'Interview on the quay', id: '©nam' }],
  pcm: null,
};

const opus: MediaFacts = {
  container: 'ogg', brand: null, duration: 0.5, durationFrom: 'granule', fragmented: false, boxes: [], indexFirst: null,
  tracks: [track({ codec: 'opus', codecName: 'Opus', codecs: 'opus', channels: 1, sampleRate: 48000 })],
  tags: [{ key: 'title', value: 'Chime', id: 'TITLE' }],
  pcm: null,
};

const flac: MediaFacts = {
  container: 'flac', brand: null, duration: 0.5, durationFrom: 'streaminfo', fragmented: false, boxes: [], indexFirst: null,
  tracks: [track({ codec: 'flac', codecName: 'FLAC', codecs: 'flac', channels: 1, sampleRate: 8000, bits: 16 })],
  tags: [],
  pcm: null,
};

test('an Ogg and a FLAC say their codec, channels, rate and length, and where the length came from', () => {
  assert.equal(mediaLine(opus), 'Ogg · Opus, mono, 48,000 Hz · 0.5 s');
  assert.equal(mediaLine(flac), 'FLAC · FLAC, 16-bit, mono, 8,000 Hz · 0.5 s');
  assert.equal(mimeOf(opus), 'audio/ogg; codecs="opus"');
  assert.equal(mimeOf(flac), 'audio/flac');
  const o = Object.fromEntries(mediaRows(opus, 401, true));
  assert.equal(o.container, 'Ogg, read from its first and last pages');
  assert.equal(o.length, "0.5 s, from its last page's granule position");
  const f = Object.fromEntries(mediaRows(flac, 8278, false));
  assert.equal(f.length, "0.5 s, from STREAMINFO's sample count");
  assert.equal(f.audio, 'FLAC · mono · 8,000 Hz · 16-bit');
  assert.match(cannotPlayWords(flac), /^The facts here are read from the file's own metadata blocks: FLAC sound, 0\.5 s long\./);
});

test('the line above the player says the container, each track and the length', () => {
  assert.equal(mediaLine(wav), 'WAV · PCM, 16-bit, mono, 22,050 Hz · 5.0 s');
  assert.equal(mediaLine(mp4), 'MP4 · H.264 (AVC), 640 × 360, about 18 frames a second · AAC (mp4a), stereo, 48,000 Hz · 4.2 s');
  assert.equal(mediaLine(prores), 'QuickTime · Apple ProRes 422 HQ, 1920 × 1080, 25 frames a second · PCM, little-endian, 16-bit, stereo, 48,000 Hz · 12.0 s');
  assert.equal(durationWords(125), '2 min 5 s');
  assert.equal(durationWords(null), 'length not written');
});

test('a player is asked about the codecs the header names, a video with none by its own code', () => {
  assert.equal(mimeOf(wav), 'audio/wav');
  assert.equal(mimeOf(mp4), 'video/mp4; codecs="avc1.42C01F, mp4a.40.2"');
  assert.equal(mimeOf(prores), 'video/quicktime; codecs="apch"');
  assert.equal(mimeOfExtension('flac'), 'audio/flac');
  assert.equal(mimeOfExtension('xyz'), '');
});

test('the Media card says where each fact came from, and a recording’s rate as an average', () => {
  const rows = Object.fromEntries(mediaRows(mp4, 144_897, true));
  assert.equal(rows.container, 'ISO base media (MP4), fragmented · brand isom');
  assert.equal(rows.length, '4.2 s, from the movie header');
  assert.equal(rows.video, 'H.264 (AVC) (“AVC1 Coding”) · 640 × 360 · 76 frames, about 18.3 a second: a recording, with no fixed rate');
  assert.equal(rows.audio, 'AAC (mp4a) · stereo · 48,000 Hz');
  assert.equal(rows['data rate'], '279 kbit/s over the whole file');
  assert.equal(rows.boxes, 'ftyp moov moof mdat moof mdat mfra · the index first, so it starts at once');
  assert.equal(rows.plays, 'in the webview');
  const w = Object.fromEntries(mediaRows(wav, 220_672, true));
  assert.equal(w.container, 'RIFF WAVE');
  assert.equal(w.length, '5.0 s, from the data size and byte rate');
  assert.equal(w.audio, 'PCM · mono · 22,050 Hz · 16-bit');
  assert.equal(w['data rate'], '353 kbit/s over the whole file');
  const p = Object.fromEntries(mediaRows(prores, 62_417, false));
  assert.equal(p.container, 'QuickTime (moov, mdat) · brand qt');
  assert.equal(p.video, 'Apple ProRes 422 HQ · 1920 × 1080 · 25 frames a second');
  assert.equal(p.plays, 'not here: no decoder for it');
});

test('the facts-only card names what cannot play and says why plainly', () => {
  assert.equal(cannotPlayWhat(prores), 'Apple ProRes 422 HQ video');
  assert.equal(
    cannotPlayWords(prores),
    "The facts here are read from the file's own boxes: Apple ProRes 422 HQ at 1920 × 1080, 25 frames a second, with PCM, little-endian sound, 12.0 s long. ProRes is an editing format; this system's player has no decoder for it on Windows and Linux, and the app does not ship one.",
  );
  assert.equal(cannotPlayWhat(wav), 'PCM');
});

test('the article follows how the extension is said', () => {
  const a = (ext: string): string => cannotPlayTitle(wav, ext).replace(/^.* in /, '').split(' ')[0]!;
  assert.deepEqual(['mov', 'flac', 'm4a', 'mp3', 'wav', 'webm', 'ogg'].map(a), ['a', 'a', 'an', 'an', 'a', 'a', 'an']);
});

test('the card heading names the codec and the container, in words', () => {
  const opus: MediaFacts = { ...wav, container: 'mp4', tracks: [track({ codec: 'Opus', codecName: 'Opus' })], pcm: null };
  assert.equal(cannotPlayTitle(opus, 'm4a'), 'This system cannot play Opus in an .m4a');
  assert.equal(cannotPlayTitle(wav, 'wav'), 'This system cannot play PCM in a .wav');
  assert.equal(cannotPlayTitle(prores, 'mov'), 'This system cannot play Apple ProRes 422 HQ video in a .mov');
  assert.equal(cannotPlayTitle(null, 'wma'), 'This system cannot play this WMA file');
});

test('the probe is read both ways, and an unknown type is never asked', () => {
  assert.equal(canPlay(() => '', 'audio/mp4'), false);
  assert.equal(canPlay(() => 'maybe', 'audio/mp4'), true);
  assert.equal(canPlay(() => 'probably', ''), false);
});

test('the newer names have a type to ask, and AIFF and audio-only Matroska are asked as such', () => {
  for (const e of ['wma', 'aiff', 'aif', 'ac3', 'mka', 'amr']) assert.notEqual(mimeOfExtension(e), '', e);
  assert.equal(mimeOf({ ...wav, container: 'aiff', pcm: null }), 'audio/aiff');
  const mka = (...codecs: (string | null)[]): MediaFacts => ({ ...wav, container: 'matroska', tracks: codecs.map((codecs) => track({ codecs })), pcm: null });
  assert.equal(mimeOf(mka('opus')), 'audio/webm; codecs="opus"');
  assert.equal(mimeOf(mka('opus', 'vorbis')), 'audio/webm; codecs="opus, vorbis"');
  assert.equal(mimeOf(mka('mp4a.40.2')), 'audio/x-matroska; codecs="mp4a.40.2"');
  assert.equal(mimeOf(mka('opus', 'flac')), 'audio/x-matroska; codecs="opus, flac"');
  assert.equal(mimeOf({ ...mka('opus'), tracks: [track({ kind: 'text', codecs: null }), track({ codecs: 'opus' })] }), 'audio/webm; codecs="opus"', 'a subtitle track does not block it');
  assert.equal(mimeOf(mka()), '', 'no audio track found is the card');
  assert.equal(mimeOf(mka(null)), '', 'a codec with no entry is never a yes');
  assert.equal(mimeOf(mka('opus', null)), '');
});

test('peaks span every channel, and a click lands in proportion', () => {
  const a = new Float32Array([0, 0.5, -0.25, 0, 0, 0, 0.1, -0.9]);
  const b = new Float32Array([0, 0, 0, 0.75, 0, 0, 0, 0]);
  assert.deepEqual(peaksOf([a, b], 2), [[-0.25, 0.75], [Math.fround(-0.9), Math.fround(0.1)]]);
  assert.deepEqual(peaksOf([], 3), [[0, 0], [0, 0], [0, 0]]);
  assert.equal(seekAt(250, 1000, 5), 1.25);
  assert.equal(seekAt(-5, 1000, 5), 0);
  assert.equal(seekAt(10, 0, 5), 0);
});
