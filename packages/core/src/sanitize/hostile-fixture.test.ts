// The hostile fixture is the corpus the gates sweep (MARXY-73, ADR-0009). Families that lived only
// as probe strings inside the unit suite are appended here, and every check below is written so it
// fails if the sanitiser is taken out of the pipeline — a suite that passes against a sanitiser
// that does nothing is the dangerous artifact.

import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { renderToUnsanitisedHtml } from '../render/render-html.ts';
import { REMOTE_IMAGE_ATTR } from './policy.ts';
import { attributesOf, elementsOf, VECTORS } from './testing/vectors.ts';

/** MARXY-96: a deferred image may name a host on the inert attribute only; links may still href it. */
function assertNoLiveFetch(html: string, host: string): void {
  for (const attribute of attributesOf(html)) {
    if (attribute.name === REMOTE_IMAGE_ATTR || attribute.name === 'href') continue;
    if ([attribute.raw, attribute.decoded].some((value) => value.includes(host))) {
      throw new Error(`${host} survived on ${attribute.element}[${attribute.name}]`);
    }
  }
}

const hostilePath = new URL('../../../../fixtures/corpus/10-hostile.md', import.meta.url);
const goldenPath = new URL('../../goldens/10-hostile.ast.txt', import.meta.url);
const hostileBytes = readFileSync(hostilePath);
const hostile = hostileBytes.toString('utf8');

/** Length and digest of the fixture as it stood on main before this story appended anything. */
const ORIGINAL_PREFIX_BYTES = 263291;
const ORIGINAL_PREFIX_SHA256 = '79b42b997624e17844f07ab71f51832fcb2e53043c4300ce7777a48ad4311223';

/** The golden as it stood on main: 25 lines, document span `document [0,263291)`. */
const ORIGINAL_GOLDEN_LINE_COUNT = 25;
const ORIGINAL_GOLDEN_FIRST = 'document [0,263291)';
const ORIGINAL_GOLDEN_REST_SHA256 = 'bbb00cd714a09dc5301a65b3eeed8b2e8adb5379bddd7b7aa07654365ebacfd9';

interface Family {
  readonly id: string;
  readonly heading: string;
  /** Throws if the family's attack is still in the HTML. */
  readonly check: (html: string) => void;
  /** True when the family's attack is live markup, not escaped text. */
  readonly live: (html: string) => boolean;
}

function sectionOf(source: string, heading: string): string {
  const start = source.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `fixture is missing the ${heading} section`);
  const rest = source.slice(start + 1);
  const next = rest.slice(heading.length + 4).search(/\n## /);
  return next === -1 ? rest : rest.slice(0, heading.length + 4 + next);
}

function render(source: string, file: string): { safe: string; unsafe: string } {
  return {
    safe: renderSafeHtml(source, { file }).html,
    unsafe: renderToUnsanitisedHtml(parseMarkdown(source, { file })),
  };
}

const hasAttr = (html: string, name: string, value?: string): boolean =>
  attributesOf(html).some((attribute) => {
    if (attribute.name !== name) return false;
    if (value === undefined) return true;
    return attribute.decoded.includes(value) || attribute.raw.includes(value);
  });

const hasElement = (html: string, name: string): boolean => elementsOf(html).includes(name);

const FAMILIES: readonly Family[] = [
  {
    id: 'srcdoc',
    heading: 'srcdoc',
    check: (html) => {
      if (hasAttr(html, 'srcdoc')) throw new Error('srcdoc: srcdoc survived');
      if (hasElement(html, 'iframe')) throw new Error('srcdoc: iframe survived');
      assertNoLiveFetch(html, 'hostile-srcdoc.invalid');
    },
    live: (html) => hasAttr(html, 'srcdoc') && hasAttr(html, 'src', 'hostile-srcdoc.invalid'),
  },
  {
    id: 'formaction',
    heading: 'formaction',
    check: (html) => {
      if (hasAttr(html, 'formaction')) throw new Error('formaction: formaction survived');
      if (hasElement(html, 'form') || hasElement(html, 'button')) throw new Error('formaction: form control survived');
      assertNoLiveFetch(html, 'hostile-formaction.invalid');
    },
    live: (html) => hasAttr(html, 'formaction', 'hostile-formaction.invalid') && hasAttr(html, 'src', 'hostile-formaction.invalid'),
  },
  {
    id: 'srcset',
    heading: 'srcset',
    check: (html) => {
      if (hasAttr(html, 'srcset') || hasAttr(html, 'imagesrcset')) throw new Error('srcset: srcset survived');
      assertNoLiveFetch(html, 'hostile-srcset.invalid');
    },
    live: (html) => hasAttr(html, 'srcset', 'hostile-srcset.invalid'),
  },
  {
    id: 'poster',
    heading: 'poster',
    check: (html) => {
      if (hasAttr(html, 'poster')) throw new Error('poster: poster survived');
      if (hasElement(html, 'video')) throw new Error('poster: video survived');
      assertNoLiveFetch(html, 'hostile-poster.invalid');
    },
    live: (html) => hasAttr(html, 'poster', 'hostile-poster.invalid'),
  },
  {
    id: 'mathml',
    heading: 'MathML',
    check: (html) => {
      if (['math', 'maction', 'mtext'].some((name) => hasElement(html, name))) throw new Error('mathml: MathML survived');
      assertNoLiveFetch(html, 'hostile-mathml.invalid');
    },
    live: (html) => hasElement(html, 'math') && hasAttr(html, 'src', 'hostile-mathml.invalid'),
  },
  {
    id: 'base',
    heading: 'base',
    check: (html) => {
      if (hasElement(html, 'base')) throw new Error('base: base survived');
      assertNoLiveFetch(html, 'hostile-base.invalid');
    },
    live: (html) => hasElement(html, 'base') && hasAttr(html, 'href', 'hostile-base.invalid'),
  },
  {
    id: 'template',
    heading: 'template',
    check: (html) => {
      if (hasElement(html, 'template')) throw new Error('template: template survived');
      assertNoLiveFetch(html, 'hostile-template.invalid');
    },
    live: (html) => hasElement(html, 'template') && hasAttr(html, 'src', 'hostile-template.invalid'),
  },
  {
    id: 'namespaced',
    heading: 'namespaced element',
    check: (html) => {
      const namespaced = elementsOf(html).filter((name) => name.includes(':'));
      if (namespaced.length > 0) throw new Error(`namespaced: found ${namespaced.join(', ')}`);
      if (html.includes('svg:script')) throw new Error('namespaced: namespaced markup survived');
      assertNoLiveFetch(html, 'hostile-namespaced.invalid');
    },
    live: (html) => elementsOf(html).some((name) => name.includes(':')) && hasAttr(html, 'src', 'hostile-namespaced.invalid'),
  },
  {
    id: 'double-encoded',
    heading: 'double-encoded javascript scheme',
    check: (html) => {
      for (const attribute of attributesOf(html)) {
        if (attribute.name !== 'href') continue;
        if (/javascript/i.test(attribute.decoded) || /javascript/i.test(attribute.raw)) {
          throw new Error('double-encoded: javascript: survived a second decoding');
        }
      }
      assertNoLiveFetch(html, 'hostile-entity.invalid');
    },
    live: (html) =>
      attributesOf(html).some((attribute) => attribute.name === 'href' && attribute.decoded.startsWith('javascript:'))
      && hasAttr(html, 'src', 'hostile-entity.invalid'),
  },
  {
    id: 'backslash-authority',
    heading: 'backslash-authority image',
    check: (html) => {
      if (hasAttr(html, 'src', 'evil.example') || html.includes('/\\evil.example')) {
        throw new Error('backslash-authority: /\\host src survived');
      }
    },
    live: (html) => hasAttr(html, 'src', '/\\evil.example/pixel.png') || hasAttr(html, 'src', '/\\\\evil.example/pixel.png'),
  },
  {
    id: 'self-closing-anchor',
    heading: 'self-closing anchor',
    check: (html) => {
      VECTORS.find((vector) => vector.id === 'no-formatting-element-spanning-a-block')!.check(html);
      VECTORS.find((vector) => vector.id === 'output-tree-is-balanced')!.check(html);
    },
    live: (html) => {
      try {
        VECTORS.find((vector) => vector.id === 'no-formatting-element-spanning-a-block')!.check(html);
        return false;
      } catch {
        return html.includes('<a href="https://evil.example/" />');
      }
    },
  },
];

test('every pre-existing byte of the hostile fixture is still a prefix of the file', () => {
  assert.ok(hostileBytes.length > ORIGINAL_PREFIX_BYTES, 'the fixture must have grown');
  const prefix = hostileBytes.subarray(0, ORIGINAL_PREFIX_BYTES);
  assert.equal(createHash('sha256').update(prefix).digest('hex'), ORIGINAL_PREFIX_SHA256);
  assert.equal(prefix.toString('utf8'), hostile.slice(0, ORIGINAL_PREFIX_BYTES));
});

test('the regenerated golden only adds nodes; existing ranges stay put', () => {
  // The document span on line 1 has to move when the file grows. Every other original line must
  // still be a prefix of the regenerated file, which is how "the diff shows only additions" is
  // machine-checked rather than inspected.
  const lines = readFileSync(goldenPath, 'utf8').replace(/\n$/, '').split('\n');
  assert.ok(lines[0]!.startsWith('document [0,'), 'the golden still starts at the document');
  assert.notEqual(lines[0], ORIGINAL_GOLDEN_FIRST, 'the document span must move when the file grows');
  const rest = lines.slice(1, ORIGINAL_GOLDEN_LINE_COUNT);
  assert.equal(rest.length, ORIGINAL_GOLDEN_LINE_COUNT - 1);
  assert.equal(createHash('sha256').update(`${rest.join('\n')}\n`).digest('hex'), ORIGINAL_GOLDEN_REST_SHA256);
  assert.ok(lines.length > ORIGINAL_GOLDEN_LINE_COUNT, 'the golden must have grown by the new sections');
});

test('the fixture labels every family the story named', () => {
  for (const family of FAMILIES) {
    assert.ok(hostile.includes(`\n## ${family.heading}\n`), `missing labelled section: ${family.heading}`);
  }
});

for (const family of FAMILIES) {
  const source = sectionOf(hostile, family.heading);
  const { safe, unsafe } = render(source, `hostile/${family.id}.md`);

  test(`${family.id}: the sanitiser removes the vector from its fixture section`, () => {
    family.check(safe);
  });

  test(`${family.id}: the same check fails against a neutralised sanitiser`, () => {
    assert.throws(() => family.check(unsafe), /./, `${family.id} passed against unsanitised output`);
  });

  test(`${family.id}: the section is live markup the no-network gate can see`, () => {
    assert.ok(family.live(unsafe), `${family.id} is inert text in the unsanitised render`);
    assert.equal(family.live(safe), false, `${family.id} is still live after sanitising`);
  });
}

test('the two MARXY-12 review exploits are their own sections and the regression for them', () => {
  const backslash = sectionOf(hostile, 'backslash-authority image');
  assert.match(backslash, /src="\/\\evil\.example\/pixel\.png"/);
  const { safe: safeSlash, unsafe: unsafeSlash } = render(backslash, 'hostile/exploit-backslash.md');
  assert.ok(!attributesOf(safeSlash).some((attribute) => attribute.name === 'src' && attribute.decoded.includes('evil.example')));
  assert.match(unsafeSlash, /\/\\evil\.example\/pixel\.png/);

  const anchor = sectionOf(hostile, 'self-closing anchor');
  assert.match(anchor, /<a href="https:\/\/evil\.example\/" \/>/);
  const { safe: safeAnchor, unsafe: unsafeAnchor } = render(anchor, 'hostile/exploit-anchor.md');
  VECTORS.find((vector) => vector.id === 'no-formatting-element-spanning-a-block')!.check(safeAnchor);
  assert.throws(
    () => VECTORS.find((vector) => vector.id === 'no-formatting-element-spanning-a-block')!.check(unsafeAnchor),
    /left open: a|inside/,
    'the self-closing anchor must swallow a block when nothing sanitises it',
  );
});

test('the appended suffix, unsanitised, carries a fetchable host per family', () => {
  // The no-network gate's unsanitised control loads the whole fixture. These hosts are how a
  // request is attributed to a new section rather than to the bytes that were already there.
  const suffix = hostile.slice(ORIGINAL_PREFIX_BYTES);
  const { safe, unsafe } = render(suffix, 'hostile/suffix.md');
  const hosts = [
    'hostile-srcdoc.invalid',
    'hostile-formaction.invalid',
    'hostile-srcset.invalid',
    'hostile-poster.invalid',
    'hostile-mathml.invalid',
    'hostile-base.invalid',
    'hostile-template.invalid',
    'hostile-namespaced.invalid',
    'hostile-entity.invalid',
    'evil.example',
  ];
  for (const host of hosts) {
    assert.ok(unsafe.includes(host), `${host} never reached the unsanitised render`);
    assert.doesNotThrow(() => assertNoLiveFetch(safe, host), `${host} survived sanitising as a live fetch`);
  }
  // evil.example is allowed as a *link* (a reader has to click); it must not be a fetched src.
  assert.ok(!attributesOf(safe).some((attribute) => attribute.name === 'src' && attribute.decoded.includes('evil.example')));
});
