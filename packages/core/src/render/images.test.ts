// MARXY-26: resolve a local image against the image root and report blocked hosts (core, no shell).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_POLICY } from '../sanitize/policy.ts';
import { sanitizeUrl } from '../sanitize/urls.ts';
import {
  blockedHosts,
  blockedImageNoticeText,
  blockedImagesFrom,
  collapsePath,
  hostOfRefusedSrc,
  imageSizeFromBytes,
  presentLocalImage,
  reserveImageBox,
  resolveImageSrc,
  type ImageResolution,
  type ImageSize,
} from './images.ts';
import { renderSafeHtml } from './pipeline.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const renderDir = new URL('./', import.meta.url);

function hostFromSanitizeUrl(raw: string): string | undefined {
  const decision = sanitizeUrl(raw, 'subresource', DEFAULT_POLICY);
  if (!decision.absolute || decision.resolved === undefined) return undefined;
  try {
    const host = new URL(decision.resolved).hostname.toLowerCase();
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
}

function assertRefusal(result: ImageResolution): void {
  assert.notEqual(result.kind, 'local', 'must refuse rather than return a path');
  assert.equal('path' in result, false, 'a refusal carries a reason (kind), not a string path');
}

const boom = (): string => {
  throw new Error('assetUrl must not run for a refused or remote source');
};

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

test('criterion 1: 10-hostile.md reports two example.invalid images and one host; data: contributes none', () => {
  const source = readFileSync(new URL('10-hostile.md', corpus), 'utf8');
  const { removed, blockedImages } = renderSafeHtml(source, { file: '10-hostile.md' });
  assert.deepEqual(blockedImagesFrom(removed), blockedImages);

  const example = blockedImages.filter((image) => image.host === 'example.invalid');
  assert.equal(example.length, 2, 'two example.invalid images in document order');
  assert.deepEqual(
    example.map((image) => image.url),
    ['https://example.invalid/remote.png', 'https://example.invalid/pixel.gif?doc=hostile'],
  );
  for (const image of example) {
    assert.equal(image.host, hostFromSanitizeUrl(image.url), 'host comes from the sanitiser sanitizeUrl');
    assert.equal(image.host, hostOfRefusedSrc(image.url));
  }
  assert.deepEqual(blockedHosts(example), ['example.invalid']);
  assert.equal(new Set(blockedHosts(blockedImages)).size, blockedHosts(blockedImages).length);

  const dataSrc = removed.filter(
    (item) => item.what === 'attribute' && item.on === 'img' && item.name === 'src' && item.value?.startsWith('data:'),
  );
  assert.ok(dataSrc.length >= 1, 'the fixture still has a data: image whose src is stripped');
  assert.deepEqual(blockedImagesFrom(dataSrc), []);
  assert.ok(blockedImages.every((image) => !image.url.startsWith('data:')));
});

test('criterion 2: /assets/logo.png from docs/README.md resolves against the image root', () => {
  assert.deepEqual(resolveImageSrc('/assets/logo.png', { documentDir: '/repo/docs', imageRoot: '/repo' }), {
    kind: 'local',
    path: '/repo/assets/logo.png',
  });
});

test('criterion 2: image.png and ../x.png resolve against the document directory, not the root', () => {
  const relative = resolveImageSrc('image.png', { documentDir: '/repo/fixtures/corpus', imageRoot: '/repo' });
  assert.deepEqual(relative, { kind: 'local', path: '/repo/fixtures/corpus/image.png' });
  assert.notDeepEqual(relative, { kind: 'local', path: '/repo/image.png' });
  assert.deepEqual(resolveImageSrc('../x.png', { documentDir: '/repo/docs', imageRoot: '/repo' }), {
    kind: 'local',
    path: '/repo/x.png',
  });
});

test('criterion 2: ../../etc/x.png is refused with a reason, not a path', () => {
  assertRefusal(resolveImageSrc('../../etc/x.png', { documentDir: '/repo/docs', imageRoot: '/repo' }));
  assert.equal(collapsePath('/repo/docs/../../etc/x.png'), '/etc/x.png');
});

test('criterion 2: a Windows drive letter is refused with a reason, not a path', () => {
  assertRefusal(resolveImageSrc('C:/Windows/x.png', { documentDir: '/repo/docs', imageRoot: '/repo' }));
  assertRefusal(resolveImageSrc('D:\\secret.png', { documentDir: 'C:/repo/docs', imageRoot: 'C:/repo' }));
  assert.equal(collapsePath('C:/foo/../..'), null);
});

test('criterion 2: .. at the image root is refused; collapsePath returns null', () => {
  assert.equal(collapsePath('/..'), null);
  assert.equal(collapsePath('C:/..'), null);
  assertRefusal(resolveImageSrc('..', { documentDir: '/repo', imageRoot: '/repo' }));
  assertRefusal(resolveImageSrc('../x.png', { documentDir: '/repo', imageRoot: '/repo' }));
});

test('criterion 3: 1200x400 at 640px reserves measure width and nearest-integer height', () => {
  // Wider than the measure: width becomes the measure; height is Math.round((h * measure) / w).
  // 400 * 640 / 1200 = 213.3… → 213 (nearest integer; ties round toward +∞).
  assert.deepEqual(reserveImageBox({ width: 1200, height: 400 }, 640), {
    width: 640,
    height: Math.round((400 * 640) / 1200),
  });
  assert.equal(reserveImageBox({ width: 1200, height: 400 }, 640).height, 213);
});

test('criterion 3: a source that already fits the measure is returned unchanged', () => {
  const fits: ImageSize = { width: 320, height: 200 };
  assert.equal(reserveImageBox(fits, 640), fits);
});

test('criterion 3: a non-positive width, height or measure returns the input untouched', () => {
  const zeroW: ImageSize = { width: 0, height: 400 };
  const zeroH: ImageSize = { width: 1200, height: 0 };
  const neg: ImageSize = { width: 1200, height: -1 };
  const ok: ImageSize = { width: 1200, height: 400 };
  assert.equal(reserveImageBox(zeroW, 640), zeroW);
  assert.equal(reserveImageBox(zeroH, 640), zeroH);
  assert.equal(reserveImageBox(neg, 640), neg);
  assert.equal(reserveImageBox(ok, 0), ok);
  assert.equal(reserveImageBox(ok, -10), ok);
});

test('criterion 4: a throwing assetUrl is not called for ../../etc/x.png or https:', () => {
  assert.deepEqual(
    presentLocalImage('../../etc/x.png', {
      documentDir: '/repo/docs',
      imageRoot: '/repo',
      measurePx: 640,
      size: { width: 10, height: 10 },
      assetUrl: boom,
    }),
    { kind: 'outside' },
  );
  const remote = presentLocalImage('https://example.invalid/p.png', {
    documentDir: '/repo',
    imageRoot: '/repo',
    measurePx: 640,
    size: { width: 10, height: 10 },
    assetUrl: boom,
  });
  assert.equal(remote.kind, 'remote');
  if (remote.kind === 'remote') {
    assert.equal(remote.host, 'example.invalid');
  }
});

test('criterion 4: a recorder sees reserve precede the single assetUrl call for a local source', () => {
  const order: string[] = [];
  const size: ImageSize = {
    get width() {
      if (!order.includes('reserve')) order.push('reserve');
      return 1200;
    },
    get height() {
      return 400;
    },
  };
  const presented = presentLocalImage('diagram.png', {
    documentDir: '/repo/docs',
    imageRoot: '/repo',
    measurePx: 640,
    size,
    assetUrl: (path) => {
      order.push(`assetUrl:${path}`);
      return `asset:${path}`;
    },
  });
  assert.deepEqual(order, ['reserve', 'assetUrl:/repo/docs/diagram.png']);
  assert.deepEqual(presented, { kind: 'ready', src: 'asset:/repo/docs/diagram.png', width: 640, height: 213 });
});

test('criterion 5: blockedImageNoticeText names each host once with a count; empty list is empty', () => {
  assert.equal(blockedImageNoticeText([]), '');
  const twoOnOne = [
    { host: 'example.invalid', url: 'https://example.invalid/remote.png' },
    { host: 'example.invalid', url: 'https://example.invalid/pixel.gif?doc=hostile' },
  ];
  const notice = blockedImageNoticeText(twoOnOne);
  assert.equal(notice, '2 remote images from example.invalid were not loaded');
  assert.equal([...notice.matchAll(/example\.invalid/g)].length, 1);
  assert.match(notice, /2 /);
});

test('criterion 5: rendered 10-hostile.md HTML contains no blocked-image host and no notice text', () => {
  const source = readFileSync(new URL('10-hostile.md', corpus), 'utf8');
  const { html, blockedImages } = renderSafeHtml(source, { file: '10-hostile.md' });
  const notice = blockedImageNoticeText(blockedImages);
  assert.ok(notice.length > 0, 'the fixture produces notice text as data');
  assert.equal(html.includes(notice), false, 'core must not put the notice text into HTML');
  const example = blockedImages.filter((image) => image.host === 'example.invalid');
  assert.equal(example.length, 2);
  for (const host of blockedHosts(blockedImages)) {
    if (host === 'evil.example') continue;
    for (const match of html.matchAll(/\bsrc="([^"]*)"/g)) {
      assert.equal(match[1]!.includes(host), false, `${host} appeared on a live img src`);
    }
  }
});

test('criterion 6: this story\'s tests do not read apps/ or assert over another package\'s source', () => {
  const self = readFileSync(new URL('images.test.ts', renderDir), 'utf8');
  assert.doesNotMatch(self, /readFileSync\([\s\S]{0,400}?apps\//);
  assert.doesNotMatch(self, /assert\.match\(\s*(?:src|tauri|memory)\s*,/);
});

test('criterion 7: imageSizeFromBytes reads a PNG header', () => {
  assert.deepEqual(imageSizeFromBytes(PNG_1X1), { width: 1, height: 1 });
});

test('criterion 7: imageSizeFromBytes reads a GIF header', () => {
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 16, 0, 8, 0]);
  assert.deepEqual(imageSizeFromBytes(gif), { width: 16, height: 8 });
});

test('criterion 7: imageSizeFromBytes reads a JPEG SOF header', () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x01, 0x01, 0x00, 0x00,
  ]);
  assert.deepEqual(imageSizeFromBytes(jpeg), { width: 200, height: 100 });
});

test('criterion 7: imageSizeFromBytes reads a WebP VP8 header', () => {
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  webp.set([0x56, 0x50, 0x38, 0x20], 12);
  webp[26] = 31;
  webp[27] = 0;
  webp[28] = 15;
  webp[29] = 0;
  assert.deepEqual(imageSizeFromBytes(webp), { width: 32, height: 16 });
});

test('criterion 7: imageSizeFromBytes returns null for a truncated header and a non-image', () => {
  const truncatedPng = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.equal(imageSizeFromBytes(truncatedPng), null);
  assert.equal(imageSizeFromBytes(Uint8Array.from([0, 1, 2, 3, 4])), null);
});
