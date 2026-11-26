// Audio and video's page from the container's facts: the line above the player,
// the type a player is asked whether it can play, the Media card's rows, and a waveform's peaks drawn from samples the
// webview decoded. The facts are the shell's (`media_facts`, src-tauri/src/facts/media.rs). Pure: no DOM, no I/O.

export interface MediaTrack {
  /** `video`, `audio`, `text` or `other`. */
  readonly kind: string;
  readonly codec: string;
  readonly codecName: string;
  readonly codecs: string | null;
  readonly compressor: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: number | null;
  readonly frameRateAverage: boolean;
  readonly frames: number | null;
  readonly channels: number | null;
  readonly sampleRate: number | null;
  readonly bits: number | null;
}

export interface MediaTag {
  readonly key: string;
  readonly value: string;
  readonly id: string;
}

/** What an audio or video file is, from its container's header (`media_facts`). */
export interface MediaFacts {
  /** `wav`, `aiff`, `mp4`, `mov`, `matroska`, `webm`, `mp3`, `ogg` or `flac`. */
  readonly container: string;
  readonly brand: string | null;
  readonly duration: number | null;
  /** `data`, `movie`, `segment`, `frames`, `bitrate`, `granule` or `streaminfo`. */
  readonly durationFrom: string | null;
  readonly fragmented: boolean;
  readonly boxes: readonly string[];
  readonly indexFirst: boolean | null;
  readonly tracks: readonly MediaTrack[];
  readonly tags: readonly MediaTag[];
  readonly pcm: { readonly dataAt: number; readonly dataLen: number; readonly channels: number; readonly bits: number; readonly float: boolean; readonly rate: number } | null;
}

/** A waveform: per bucket the lowest and highest sample, -1 to 1 (`media_envelope`). */
export interface Envelope {
  readonly peaks: readonly (readonly [number, number])[];
  readonly sampled: boolean;
}

/** The buckets a waveform is asked in; the canvas draws them to its width. */
export const ENVELOPE_BUCKETS = 1000;
/** Compressed audio is decoded by the webview for its waveform only up to this size and this length. */
export const DECODE_BYTES_MAX = 20 * 1024 * 1024;
export const DECODE_SECONDS_MAX = 600;

const n2 = (n: number): string => n.toLocaleString('en-GB');

const CONTAINER_NAMES: Readonly<Record<string, string>> = { wav: 'WAV', aiff: 'AIFF', mp4: 'MP4', mov: 'QuickTime', matroska: 'Matroska', webm: 'WebM', mp3: 'MP3', ogg: 'Ogg', flac: 'FLAC' };

/** The container as the head and the line name it: "WAV", "MP4", "QuickTime". */
export const containerName = (container: string, ext = ''): string => CONTAINER_NAMES[container] ?? (ext ? ext.toUpperCase() : 'media');

/** "5.0 s", "2 min 5 s", "1 h 2 min". */
export function durationWords(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return 'length not written';
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s - h * 3600) / 60)} min`;
}

/** "mono", "stereo", "6 channels". */
export const channelWords = (n: number | null): string | null => (n === null || n === 0 ? null : n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} channels`);

const rate = (r: number): string => `${+r.toFixed(3)}`;

export const videoOf = (f: Pick<MediaFacts, 'tracks'>): MediaTrack | undefined => f.tracks.find((t) => t.kind === 'video');
export const audioOf = (f: Pick<MediaFacts, 'tracks'>): MediaTrack | undefined => f.tracks.find((t) => t.kind === 'audio');

/** The line above the player: "MP4 · H.264 (AVC), 640 × 360, about 18 frames a second · AAC (mp4a), stereo, 48,000 Hz · 4.2 s". */
export function mediaLine(f: MediaFacts): string {
  const v = videoOf(f);
  const a = audioOf(f);
  const parts = [containerName(f.container)];
  if (v) {
    const size = v.width && v.height ? `, ${v.width} × ${v.height}` : '';
    const fps = v.frameRate ? `, ${v.frameRateAverage ? `about ${Math.round(v.frameRate)}` : rate(v.frameRate)} frames a second` : '';
    parts.push(`${v.codecName}${size}${fps}`);
  }
  if (a) parts.push([a.codecName, a.bits ? `${a.bits}-bit` : null, channelWords(a.channels), a.sampleRate ? `${n2(a.sampleRate)} Hz` : null].filter(Boolean).join(', '));
  parts.push(durationWords(f.duration));
  return parts.join(' · ');
}

const BASE_TYPES: Readonly<Record<string, string>> = { wav: 'audio/wav', aiff: 'audio/aiff', mp3: 'audio/mpeg', flac: 'audio/flac', webm: 'video/webm', matroska: 'video/x-matroska', mov: 'video/quicktime' };

/** The type a player is asked whether it can play: `video/mp4; codecs="avc1.42C01F, mp4a.40.2"`. */
export function mimeOf(f: MediaFacts): string {
  const v = videoOf(f);
  const base =
    f.container === 'mp4' ? (v ? 'video/mp4' : 'audio/mp4') : f.container === 'ogg' ? (v ? 'video/ogg' : 'audio/ogg') : f.container === 'webm' && !v ? 'audio/webm' : (BASE_TYPES[f.container] ?? 'application/octet-stream');
  if (f.container === 'wav' || f.container === 'aiff' || f.container === 'mp3' || f.container === 'flac') return base;
  if (f.container === 'matroska' && !v) {
    const sound = f.tracks.filter((t) => t.kind === 'audio');
    // Tracks missing or cut short: nothing to vouch for, so the card, not a dead player.
    if (sound.length === 0) return '';
    // A track whose codec has no codecs string is one this cannot vouch for: no type, so the card says it cannot play it.
    if (sound.some((t) => !t.codecs)) return '';
    const codecs = sound.map((t) => t.codecs!);
    // Only Opus and Vorbis are asked as WebM; anything else a Matroska holds is asked as Matroska.
    const webm = codecs.length > 0 && codecs.every((c) => c === 'opus' || c === 'vorbis');
    return `${webm ? 'audio/webm' : 'audio/x-matroska'}${codecs.length ? `; codecs="${codecs.join(', ')}"` : ''}`;
  }
  // A video track's own code where the header gives no codecs string (ProRes's apch), so a player that lacks it says so.
  const codecs = f.tracks.flatMap((t) => (t.codecs ? [t.codecs] : t.kind === 'video' && t.codec ? [t.codec] : []));
  return codecs.length ? `${base}; codecs="${codecs.join(', ')}"` : base;
}

/** The type of a file whose facts are not known, from its extension. */
export function mimeOfExtension(ext: string): string {
  const types: Readonly<Record<string, string>> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs="opus"', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
    aiff: 'audio/aiff', aif: 'audio/aiff', wma: 'audio/x-ms-wma', ac3: 'audio/ac3', mka: 'audio/x-matroska', amr: 'audio/amr',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  };
  return types[ext] ?? '';
}

const CONTAINER_WORDS: Readonly<Record<string, string>> = {
  wav: 'RIFF WAVE',
  aiff: 'AIFF, read from its COMM chunk',
  mov: 'QuickTime (moov, mdat)',
  matroska: 'Matroska',
  webm: 'WebM (Matroska)',
  mp3: 'MPEG audio, with its ID3 tag where it has one',
  ogg: 'Ogg, read from its first and last pages',
  flac: 'FLAC, read from its metadata blocks',
};

const FROM_WORDS: Readonly<Record<string, string>> = {
  data: 'from the data size and byte rate',
  movie: 'from the movie header',
  segment: "from the segment's Info",
  frames: 'from its frame count',
  bitrate: 'from its bit rate and size: an estimate',
  granule: "from its last page's granule position",
  streaminfo: "from STREAMINFO's sample count",
};

/** The Media card's rows: container, length, each track, data rate, boxes, and whether it plays here. */
export function mediaRows(f: MediaFacts, size: number, plays: boolean): [string, string][] {
  const rows: [string, string][] = [];
  const container = f.container === 'mp4' ? `ISO base media (MP4)${f.fragmented ? ', fragmented' : ''}` : (CONTAINER_WORDS[f.container] ?? f.container);
  rows.push(['container', f.brand && f.container !== 'webm' && f.container !== 'matroska' ? `${container} · brand ${f.brand}` : container]);
  rows.push(['length', f.duration !== null ? `${durationWords(f.duration)}, ${FROM_WORDS[f.durationFrom ?? ''] ?? 'from the header'}` : 'not written in the file']);
  for (const t of f.tracks) {
    if (t.kind === 'video') {
      const name = t.compressor && t.compressor !== t.codecName ? `${t.codecName} (“${t.compressor}”)` : t.codecName;
      const size_ = t.width && t.height ? ` · ${t.width} × ${t.height}` : '';
      const fps = t.frameRate
        ? t.frameRateAverage
          ? ` · ${t.frames ? `${n2(t.frames)} frames, ` : ''}about ${t.frameRate.toFixed(1)} a second: a recording, with no fixed rate`
          : ` · ${rate(t.frameRate)} frames a second`
        : ' · frame rate not in the header';
      rows.push(['video', `${name}${size_}${fps}`]);
    } else if (t.kind === 'audio') {
      rows.push(['audio', [t.codecName, channelWords(t.channels), t.sampleRate ? `${n2(t.sampleRate)} Hz` : null, t.bits ? `${t.bits}-bit` : null].filter(Boolean).join(' · ')]);
    } else if (t.kind === 'text') {
      rows.push(['text', t.codecName]);
    }
  }
  if (f.duration && f.duration > 0) rows.push(['data rate', `${n2(Math.round((size * 8) / f.duration / 1000))} kbit/s over the whole file`]);
  if (f.boxes.length > 0) rows.push(['boxes', `${f.boxes.join(' ')}${f.indexFirst ? ' · the index first, so it starts at once' : f.indexFirst === false ? ' · the index last, so a player reads to the end first' : ''}`]);
  rows.push(['plays', plays ? 'in the webview' : 'not here: no decoder for it']);
  return rows;
}

/** What the facts-only card names: the video's codec, else the audio's, else the container. */
export function cannotPlayWhat(f: MediaFacts): string {
  const v = videoOf(f);
  const a = audioOf(f);
  if (v) return `${v.codecName}${a ? ' video' : ''}`;
  return a?.codecName ?? containerName(f.container);
}

/** Asks a player's `canPlayType` about `type`; anything but an empty answer is a yes. The one place the probe's verdict is read, so a test can stub it both ways. */
export const canPlay = (probe: (type: string) => string, type: string): boolean => type !== '' && probe(type) !== '';

const SPOKEN_VOWEL = 'aefhilmnorsx';
/** Extensions said as words, not letter by letter: "a .mov", "a .flac". */
const SAID_AS_WORDS: ReadonlySet<string> = new Set(['mov', 'flac']);

/** The card's heading: "This system cannot play Opus in an .m4a". The codec where the header names one, else the container. */
export function cannotPlayTitle(f: MediaFacts | null, ext: string): string {
  const dot = ext ? `.${ext.toLowerCase()}` : '';
  const first = dot[1] ?? '';
  const article = dot && (SAID_AS_WORDS.has(dot.slice(1)) ? 'aeiou' : SPOKEN_VOWEL).includes(first) ? 'an' : 'a';
  const codec = f && (videoOf(f) || audioOf(f)) ? cannotPlayWhat(f) : null;
  if (codec) return `This system cannot play ${codec}${dot ? ` in ${article} ${dot}` : ''}`;
  const name = containerName(f?.container ?? '', ext);
  return `This system cannot play this ${name} file`;
}

/** The facts-only card's sentence: what the boxes say, and why this system cannot play it. */
export function cannotPlayWords(f: MediaFacts): string {
  const v = videoOf(f);
  const a = audioOf(f);
  const bits: string[] = [];
  if (v) bits.push(`${v.codecName}${v.width && v.height ? ` at ${v.width} × ${v.height}` : ''}${v.frameRate ? `, ${v.frameRateAverage ? `about ${Math.round(v.frameRate)}` : rate(v.frameRate)} frames a second` : ''}`);
  if (a) bits.push(`${v ? 'with ' : ''}${a.codecName} sound`);
  const said = `${bits.join(', ')}${bits.length ? ', ' : ''}${durationWords(f.duration)}${f.duration !== null ? ' long' : ''}`;
  const from =
    f.container === 'wav'
      ? "the file's own chunks"
      : f.container === 'matroska' || f.container === 'webm'
        ? "the file's own header"
        : f.container === 'ogg'
          ? "the file's own pages"
          : f.container === 'flac'
            ? "the file's own metadata blocks"
            : "the file's own boxes";
  const why = v && /ProRes/.test(v.codecName)
    ? "ProRes is an editing format; this system's player has no decoder for it on Windows and Linux, and the app does not ship one."
    : 'The app does not ship decoders of its own.';
  return `The facts here are read from ${from}: ${said}. ${why}`;
}

/** Peaks over `samples` (one channel or several, the same length) in `buckets` steps. */
export function peaksOf(channels: readonly Float32Array[], buckets: number): [number, number][] {
  const n = channels[0]?.length ?? 0;
  const out: [number, number][] = Array.from({ length: buckets }, () => [0, 0]);
  if (n === 0) return out;
  for (const ch of channels) {
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor((b * n) / buckets);
      const to = Math.max(from + 1, Math.floor(((b + 1) * n) / buckets));
      const p = out[b]!;
      for (let i = from; i < to && i < n; i++) {
        const s = ch[i]!;
        if (s < p[0]) p[0] = s;
        if (s > p[1]) p[1] = s;
      }
    }
  }
  return out;
}

/** Where a click at `x` of `width` lands in a recording `duration` long, in seconds. */
export const seekAt = (x: number, width: number, duration: number): number => (width > 0 && duration > 0 ? Math.max(0, Math.min(duration, (x / width) * duration)) : 0);
