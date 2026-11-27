// Audio and video: the webview's own player over the file (`marxy-file://`, served
// a range at a time), never started on its own, its place never kept. The facts come from the container's header, read by
// the shell. A PCM WAV's waveform is read from its samples; other audio under 20 MB and 10 minutes is decoded once by the
// webview for one. A click on the waveform plays from there, and a line follows the playhead. When this system cannot play
// the codec (asked first, then told by the player's error), the page is a card of the facts with the way out, and the head
// says "Facts only · cannot play here" in grey, as a tier. Source is the hex view.
import { accountElement } from '../frame/account.ts';
import { extensionOf } from '@marxy/core/src/viewer/bytes.ts';
import {
  DECODE_BYTES_MAX,
  DECODE_SECONDS_MAX,
  ENVELOPE_BUCKETS,
  canPlay,
  cannotPlayTitle,
  channelWords,
  cannotPlayWords,
  containerName,
  mediaLine,
  mediaRows,
  mimeOf,
  mimeOfExtension,
  peaksOf,
  seekAt,
  videoOf,
  type Envelope,
  type MediaFacts,
  type MediaTrack,
} from '@marxy/core/src/viewer/media.ts';
import { hex2 } from '@marxy/core/src/viewer/bytes.ts';
import { offsetLabel } from '@marxy/core/src/viewer/hex.ts';
import { treeParts } from '../parts/moves.ts';
import { bytesBox } from '../parts/xray-box.ts';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { el, factRow } from '../frame/dom.ts';
import { kindRow, kindSection } from './kind-sections.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { fileCardElement, handOver } from './card.ts';
import { byteCard, factsCard, readingCard } from './cards.ts';
import { asItIs, bytesOf } from './exports.ts';
import type { ViewedFile } from './file.ts';
import { createHexView, type HexView } from './hex.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerPlace, ViewMode } from './types.ts';
import css from './media.css?inline';

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** A top-level box or chunk: its type and its run of the file's bytes, header included. */
interface Run {
  readonly name: string;
  readonly at: number;
  readonly length: number;
}

/** Copied as hex pairs up to this length; a larger box copies its type, offset and length. */
const COPY_BYTES_MAX = 64 * 1024;

function trackWords(t: MediaTrack): string {
  const size = t.width && t.height ? `${t.width} × ${t.height}` : null;
  const fps = t.frameRate ? `${t.frameRateAverage ? 'about ' : ''}${+t.frameRate.toFixed(3)} frames a second` : null;
  return [t.codecName, size, fps, channelWords(t.channels), t.sampleRate ? `${n2(t.sampleRate)} Hz` : null, t.bits ? `${t.bits}-bit` : null].filter(Boolean).join(', ');
}

const u32be = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u32le = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/**
 * The top-level boxes (MP4, QuickTime) or a WAV's chunks inside RIFF, at their offsets: the shell's facts name the boxes
 * but not where they start, so their headers are read again, eight bytes each, never the bodies.
 */
async function walkRuns(read: (at: number, n: number) => Promise<Uint8Array>, size: number, riff: boolean): Promise<Run[]> {
  const out: Run[] = [];
  let at = riff ? 12 : 0;
  while (at + 8 <= size && out.length < 64) {
    const h = await read(at, 16);
    if (h.length < 8) break;
    const name = String.fromCharCode(...(riff ? h.subarray(0, 4) : h.subarray(4, 8)));
    let total: number;
    let next: number;
    if (riff) {
      total = 8 + u32le(h, 4);
      next = at + total + (total & 1);
    } else {
      const s = u32be(h, 0);
      total = s === 1 && h.length >= 16 ? u32be(h, 8) * 2 ** 32 + u32be(h, 12) : s === 0 ? size - at : s;
      next = at + total;
    }
    if (total < 8) break;
    out.push({ name, at, length: Math.min(total, size - at) });
    at = next;
  }
  return out;
}

export interface MediaOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly facts: MediaFacts | null;
  readonly place?: ViewerPlace;
}

/** The container's facts, or null where the shell reads none (AVI, WMV, FLV, or a build without the reader). */
export async function mediaFactsFor(shell: AppShell, file: ViewedFile): Promise<MediaFacts | null> {
  return shell.mediaFacts ? shell.mediaFacts(file.path).catch(() => null) : null;
}

/** Whether a page of the app's own can say anything of the file: facts read, or a type a player may know. */
export const mediaPageFor = (file: ViewedFile, facts: MediaFacts | null): boolean => facts !== null || mimeOfExtension(extensionOf(file.path)) !== '';

/** The type to ask a player about: QuickTime and Matroska are asked as MP4 and WebM, which a webview's demuxer reads. */
function probeType(facts: MediaFacts | null, ext: string): string {
  if (!facts) return mimeOfExtension(ext);
  const mime = mimeOf(facts);
  if (facts.container === 'mov') return mime.replace('video/quicktime', 'video/mp4');
  if (facts.container === 'matroska') return mime.replace('video/x-matroska', 'video/webm');
  return mime;
}

export function createMediaViewer(o: MediaOptions): PaneViewer {
  const { shell, file, facts } = o;
  const path = file.path;
  adoptRuntimeSheet(document, 'marxy-media-style', css);
  const id = nextViewerId();
  const ext = extensionOf(path);
  const audioOnly = facts ? !videoOf(facts) : file.row.id === 'audio';
  const probe = document.createElement(audioOnly ? 'audio' : 'video');
  const asked = probeType(facts, ext);
  let failed = !canPlay((t) => probe.canPlayType(t), asked);
  let failure = '';
  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let asCard = false;
  let player: HTMLMediaElement | null = null;
  let envelope: Envelope | null = null;
  let waveFrom: 'samples' | 'decoded' | null = null;
  let waveAsked = false;
  let frame = 0;
  let resize: ResizeObserver | null = null;
  let scrollBack = o.place?.scroll?.top ?? null;
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  const showsFacts = (): boolean => failed && !asCard && mode === 'rendered';
  const read = (at: number, n: number): Promise<Uint8Array> => shell.readRange(path, at, n);
  const riff = facts?.container === 'wav';
  let runs: Run[] = [];
  if (riff || (facts?.boxes.length ?? 0) > 0) {
    void walkRuns(read, file.size, riff)
      .then((got) => {
        runs = got;
        partsMade = null;
        factEl('boxes');
        viewerChanged();
      })
      .catch(() => {});
  }
  /** The tracks, tags and boxes, drawn after the page's foot; each row a part of the cursor's. */
  let factsBox: { box: HTMLElement; runs: Run[]; groups: Map<string, HTMLElement>; rows: Map<string, HTMLElement> } | null = null;

  /** The group `group`'s element, or row `id`'s, drawn after the page's foot on first asking (the player is never moved). */
  function factEl(group: string, id?: string): HTMLElement | null {
    const col = host && mode === 'rendered' && !asCard ? host.querySelector<HTMLElement>('.marxy-media') : null;
    if (!col) return null;
    if (!factsBox || !factsBox.box.isConnected || factsBox.runs !== runs) {
      factsBox?.box.remove();
      const box = el('div', 'marxy-media-parts');
      const groups = new Map<string, HTMLElement>();
      const rows = new Map<string, HTMLElement>();
      const group = (key: string, g: HTMLElement, items: readonly [string, HTMLElement][]): void => {
        if (items.length === 0) return;
        for (const [rid, row] of items) {
          rows.set(rid, row);
          g.append(row);
        }
        groups.set(key, g);
        box.append(g);
      };
      const tracks = facts?.tracks ?? [];
      const tags = facts?.tags ?? [];
      group('tracks', kindSection('Tracks', `${n2(tracks.length)} in the file`), tracks.map((t, i) => [`track=${i + 1}`, kindRow(`${t.kind} ${i + 1}`, trackWords(t))]));
      group('tags', kindSection('Tags', 'the file’s own'), tags.map((t, i) => [`tag=${i}`, kindRow(t.key, `${t.value} (${t.id})`)]));
      const word = riff ? 'chunk' : 'box';
      group(
        'boxes',
        kindSection(riff ? 'Its chunks' : 'Its boxes', `the top level, ${n2(runs.length)}`, [word, 'at byte', 'bytes']),
        runs.map((r) => [`@${r.at}`, kindRow(r.name.trim(), '', { at: `0x${offsetLabel(r.at, 4)}`, size: n2(r.length) })]),
      );
      col.append(box);
      factsBox = { box, runs, groups, rows };
    }
    return (id === undefined ? factsBox.groups.get(group) : factsBox.rows.get(id)) ?? null;
  }

  let partsMade: PartTree | null = null;
  /** The player (or the facts card), then the tracks, tags and boxes, as the cursor's parts. */
  function mediaParts(): PartTree {
    if (partsMade) return partsMade;
    const top: PartUnit[] = [
      {
        id: 'player',
        get label() {
          return failed ? 'facts' : 'player';
        },
        address: '',
        el: () => (host && mode === 'rendered' && !asCard ? host.querySelector<HTMLElement>(failed ? '.marxy-media-noplay' : '.marxy-media-player') : null),
        stored: () => (facts ? mediaLine(facts) : path),
      },
    ];
    const holder = (id: string, label: string, children: PartUnit[], at?: number): void => {
      if (children.length === 0) return;
      top.push({ id, label, address: `#${id}`, at, children, el: () => factEl(id), stored: async () => (await Promise.all(children.map((u) => u.stored()))).join('\n') });
    };
    holder(
      'tracks',
      'tracks',
      (facts?.tracks ?? []).map((t, i) => ({
        id: `track=${i + 1}`,
        label: `track ${i + 1}`,
        address: `#track=${i + 1}`,
        el: () => factEl('tracks', `track=${i + 1}`),
        stored: () => `${t.kind}: ${trackWords(t)}`,
      })),
    );
    holder(
      'tags',
      'tags',
      (facts?.tags ?? []).map((t, i) => ({
        id: `tag=${i}`,
        label: `tag ${t.key}`,
        address: `#tag=${t.id}`,
        el: () => factEl('tags', `tag=${i}`),
        stored: () => `${t.key}: ${t.value}`,
      })),
    );
    const word = riff ? 'chunk' : 'box';
    holder(
      'boxes',
      riff ? 'chunks' : 'boxes',
      runs.map((r) => ({
        id: `@${r.at}`,
        label: `${word} ${r.name.trim()}`,
        address: `@0x${offsetLabel(r.at, 4)}`,
        at: r.at,
        el: () => factEl('boxes', `@${r.at}`),
        async stored() {
          if (r.length > COPY_BYTES_MAX) return `${r.name.trim()}\t0x${offsetLabel(r.at, 4)}\t${n2(r.length)}`;
          return [...(await read(r.at, r.length))].map(hex2).join(' ');
        },
        async xray() {
          const n = Math.min(r.length, 1024);
          return bytesBox(`As stored · the ${r.name.trim()} ${word} · bytes ${n2(r.at)}–${n2(r.at + r.length - 1)}`, await read(r.at, n), r.at);
        },
      })),
      runs[0]?.at,
    );
    partsMade = treeParts(top, { readOnly: true });
    return partsMade;
  }

  function ensurePlayer(): HTMLMediaElement {
    if (player) return player;
    const p = document.createElement(audioOnly ? 'audio' : 'video');
    p.className = 'marxy-media-player';
    p.controls = true;
    p.autoplay = false;
    p.preload = 'metadata';
    if (p instanceof HTMLVideoElement) p.playsInline = true;
    p.addEventListener('error', () => {
      const err = p.error;
      // An abort is the page letting the player go, not the codec.
      if (!err || err.code === MediaError.MEDIA_ERR_ABORTED) return;
      failed = true;
      failure = err.message || `the player stopped with code ${err.code}`;
      draw();
      viewerChanged();
    });
    p.addEventListener('timeupdate', () => moveHead());
    p.addEventListener('play', () => follow());
    p.src = shell.fileUrl(path);
    player = p;
    return p;
  }

  /** The waveform's line at the player's place. */
  function moveHead(at?: number): void {
    const head = host?.querySelector<HTMLElement>('.marxy-media-head');
    const p = player;
    if (!head || !p) return;
    const d = p.duration || facts?.duration || 0;
    head.style.left = `${d > 0 ? Math.min(100, ((at ?? p.currentTime) / d) * 100) : 0}%`;
  }

  function follow(): void {
    cancelAnimationFrame(frame);
    const step = (): void => {
      moveHead();
      if (player && !player.paused && host) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  async function askWave(): Promise<void> {
    if (waveAsked || !audioOnly) return;
    waveAsked = true;
    if (facts?.pcm) {
      envelope = shell.mediaEnvelope ? await shell.mediaEnvelope(path, ENVELOPE_BUCKETS).catch(() => null) : null;
      if (envelope) waveFrom = 'samples';
    } else if (file.size <= DECODE_BYTES_MAX && (facts?.duration ?? 0) <= DECODE_SECONDS_MAX) {
      try {
        const bytes = await bytesOf(shell, file);
        const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes.slice().buffer);
        if (audio.duration <= DECODE_SECONDS_MAX) {
          const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
          envelope = { peaks: peaksOf(channels, ENVELOPE_BUCKETS), sampled: false };
          waveFrom = 'decoded';
        }
      } catch {
        envelope = null;
      }
    }
    // Put in beside the player, never by drawing the page again: a moved player stops.
    const col = host?.querySelector<HTMLElement>('.marxy-media');
    if (col && envelope && player && player.parentElement === col) {
      col.insertBefore(wave(player), player);
      const held = col.querySelector('.marxy-account');
      const fresh = accountElement(footWords(), facts ? mediaLine(facts) : undefined, 'marxy-media-line');
      if (held && fresh) held.replaceWith(fresh);
    }
  }

  /** The page's account (core reading/account.ts). */
  function footWords(): string[] {
    return [
      'Played by the webview’s own player, from the file. It never starts on its own, and where you stopped is not kept.',
      audioOnly && waveFrom
        ? `The waveform is ${waveFrom === 'samples' ? 'read straight from the samples, which a WAV keeps as they are' : 'decoded once by the webview, since the file is short'}.`
        : '',
      'Source has the bytes.',
    ];
  }

  function paintWave(canvas: HTMLCanvasElement): void {
    if (!envelope) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (!c) return;
    const style = getComputedStyle(canvas);
    const mid = h / 2;
    const reach = mid - 4 * dpr;
    c.clearRect(0, 0, w, h);
    c.fillStyle = style.getPropertyValue('--marxy-color-text-secondary').trim() || '#999';
    const peaks = envelope.peaks;
    for (let x = 0; x < w; x++) {
      const from = Math.floor((x * peaks.length) / w);
      const to = Math.max(from + 1, Math.floor(((x + 1) * peaks.length) / w));
      let lo = 0;
      let hi = 0;
      for (let i = from; i < to && i < peaks.length; i++) {
        lo = Math.min(lo, peaks[i]![0]);
        hi = Math.max(hi, peaks[i]![1]);
      }
      c.fillRect(x, mid - hi * reach, 1, Math.max(1, (hi - lo) * reach));
    }
    c.fillStyle = style.getPropertyValue('--marxy-frame-hair-2').trim() || '#444';
    c.fillRect(0, Math.floor(mid), w, Math.max(1, Math.round(dpr)));
  }

  function wave(p: HTMLMediaElement): HTMLElement {
    const box = el('div', 'marxy-media-wave');
    const canvas = el('canvas');
    canvas.setAttribute('aria-label', 'The waveform: click to play from there');
    canvas.setAttribute('role', 'img');
    box.append(canvas, el('div', 'marxy-media-head'));
    box.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const at = seekAt(e.clientX - r.left, r.width, p.duration || facts?.duration || 0);
      p.currentTime = at;
      moveHead(at);
      void p.play().catch(() => {});
    });
    resize?.disconnect();
    resize = new ResizeObserver(() => paintWave(canvas));
    resize.observe(canvas);
    requestAnimationFrame(() => {
      paintWave(canvas);
      moveHead();
    });
    return box;
  }

  function playerPage(): HTMLElement {
    const page = el('div', 'marxy-mediapage');
    page.tabIndex = -1;
    const col = el('div', 'marxy-media');
    const account = accountElement(footWords(), facts ? mediaLine(facts) : undefined, 'marxy-media-line');
    if (account) col.append(account);
    const p = ensurePlayer();
    if (audioOnly && envelope) col.append(wave(p));
    col.append(p);
    page.append(col);
    void askWave();
    return page;
  }

  function factsPage(): HTMLElement {
    const page = el('div', 'marxy-mediapage');
    page.tabIndex = -1;
    const col = el('div', 'marxy-media');
    if (facts) col.append(el('p', 'marxy-media-line', mediaLine(facts)));
    const box = el('div', 'marxy-media-noplay');
    box.append(el('p', 'marxy-media-kicker', 'Facts only'), el('h2', 'marxy-media-title', cannotPlayTitle(facts, ext)));
    const said = facts ? cannotPlayWords(facts) : 'Its container is not one the app reads, and this system has no decoder for it.';
    box.append(el('p', 'marxy-media-said', failure ? `${said} The player said: ${failure}.` : said));
    const acts = el('div', 'marxy-media-acts');
    const open = el('button', 'marxy-btn', 'Open in default app');
    open.type = 'button';
    open.setAttribute('data-marxy-primary', '');
    open.addEventListener('click', () => void handOver(shell, path, 'open', host?.closest<HTMLElement>('section.marxy-pane') ?? undefined));
    const reveal = el('button', 'marxy-btn', 'Show in folder');
    reveal.type = 'button';
    reveal.addEventListener('click', () => void handOver(shell, path, 'reveal', host?.closest<HTMLElement>('section.marxy-pane') ?? undefined));
    const anyway = el('button', 'marxy-btn', 'Try to play it anyway');
    anyway.type = 'button';
    anyway.addEventListener('click', () => {
      failed = false;
      failure = '';
      player?.removeAttribute('src');
      player = null;
      draw();
      viewerChanged();
    });
    acts.append(open, reveal, anyway);
    box.append(acts);
    col.append(box);
    const prores = facts && /ProRes/.test(videoOf(facts)?.codecName ?? '');
    col.append(el('p', 'marxy-media-foot', `Nothing was decoded.${prores ? ' On macOS the system’s player draws ProRes, and this page would be a player there.' : ''} Source has the bytes.`));
    page.append(col);
    return page;
  }

  function cardPage(): HTMLElement {
    const page = el('div', 'marxy-fcpage');
    const side = el('div', 'marxy-fchex');
    const view = ensureHex();
    side.append(view.el);
    page.append(fileCardElement({ shell, file, back: { words: failed ? 'Back to the facts' : 'Back to the player', run: () => setCard(false) } }, () => host?.closest<HTMLElement>('section.marxy-pane') ?? undefined), side);
    requestAnimationFrame(() => view.draw());
    return page;
  }

  function setCard(on: boolean): void {
    asCard = on;
    draw();
    viewerChanged();
  }

  function draw(): void {
    if (!host) return;
    const top = scrollBack ?? host.querySelector<HTMLElement>('.marxy-mediapage')?.scrollTop ?? 0;
    scrollBack = null;
    if (mode === 'source') {
      player?.pause();
      const view = ensureHex();
      const page = el('div', 'marxy-hexpage');
      page.append(view.el);
      host.replaceChildren(page);
      requestAnimationFrame(() => view.draw());
      return;
    }
    if (asCard) {
      host.replaceChildren(cardPage());
      return;
    }
    const page = failed ? factsPage() : playerPage();
    host.replaceChildren(page);
    factEl('tracks');
    page.scrollTop = top;
  }

  const kindWord = audioOnly ? 'audio' : 'video';
  const reading = readingCard({
    file,
    facts: () => null,
    shownAs: () => (asCard && mode === 'rendered' ? 'a file card and the bytes' : `${containerName(facts?.container ?? '', ext)} ${kindWord}`),
    tiers: () => ({
      items: [
        { name: 'A player', words: 'when the webview has the codec' },
        { name: 'Facts only', words: 'read from the container when it has not' },
        { name: 'The bytes', words: 'when it is not a container the app reads' },
      ],
      at: asCard ? 2 : failed ? 1 : 0,
    }),
    caps: () => ['the container’s header read, never the whole file', 'a waveform only for PCM or a short file', 'never starts on its own'],
    other: () =>
      mode === 'rendered'
        ? asCard
          ? { words: failed ? 'Back to the facts' : 'Back to the player', run: () => setCard(false) }
          : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }
        : null,
  });

  const mediaCard: CardDef = {
    id: 'contents',
    title: () => 'Media',
    detail: () => 'from the container',
    relevant: () => true,
    render(body) {
      if (!facts) {
        body.append(el('p', 'marxy-card-note', 'Its container is not one the app reads: the player shows what the webview can.'));
        return;
      }
      for (const [k, v] of mediaRows(facts, file.size, !failed)) body.append(factRow(k, v));
    },
  };

  const tagsCard: CardDef = {
    id: 'frontmatter',
    title: () => 'Tags',
    detail: () => 'the file’s own',
    relevant: () => (facts?.tags.length ?? 0) > 0,
    render(body) {
      const tags = facts?.tags ?? [];
      if (tags.length === 0) {
        body.append(el('p', 'marxy-card-note', 'The file carries no tags.'));
        return;
      }
      for (const t of tags) {
        const v = el('span', '', `${t.value} `);
        v.append(el('span', 'marxy-fact-quiet', t.id));
        body.append(factRow(t.key, v));
      }
    },
  };

  const facts_ = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  return {
    path,
    kind: 'media',
    group: 'media',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'media');
      draw();
    },
    hide() {
      player?.pause();
      cancelAnimationFrame(frame);
      host = null;
    },
    cards: () => ({ reading, contents: mediaCard, frontmatter: tagsCard, facts: facts_ }),
    passing: (m) => (m === 'source' || asCard ? [byte] : []),
    headSay() {
      if (file.guessed) return { text: `${kindWord} · guessed`, tone: 'guess', title: 'Read from its first bytes: its name does not say what it is · Metadata says why' };
      if (showsFacts()) return { text: 'Facts only · cannot play here', tone: 'tier', title: 'This system has no decoder for it · Metadata says what else' };
      return null;
    },
    // The player's own controls keep their keys while it has focus; the page binds none of its own.
    key(e, m) {
      if (m === 'source' || asCard) return hex?.key(e) ?? false;
      return false;
    },
    parts: (m) => (m === 'source' || asCard ? ensureHex().parts() : mediaParts()),
    floor: { on: () => asCard, set: (on) => setCard(on) },
    panelKey: () => `${id}:${mode}:${asCard}:${failed}:${hex?.selected() ?? ''}`,
    place() {
      const page = mode === 'rendered' && !asCard ? host?.querySelector<HTMLElement>('.marxy-mediapage') : null;
      return { hex: hex?.place(), scroll: page ? { top: page.scrollTop, left: 0 } : undefined };
    },
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return mode === 'rendered' && asCard ? 'rendered' : 'source';
    },
    exports: () => [asItIs(shell, file, 'file')],
    destroy() {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      resize = null;
      if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
      }
      player = null;
      hex?.destroy();
      hex = null;
      host = null;
    },
  };
}
