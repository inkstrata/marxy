// Pure decision logic for `scripts/gate-no-network.mjs` (ADR-0009, MARXY-83). The gate still has to
// drive a real browser to *collect* what a document did — a request seen, the live DOM's tags and
// attributes, a URL a reader's engine resolved — but deciding whether what it collected is a
// violation never needs a page open, so that half lives here, where it can be tested in
// milliseconds instead of only inside a Playwright run. Six of this gate's checks were deleted by a
// revert with nothing failing (the story this closes); moving the judgment out of an inline browser
// closure and into a named, individually-tested function is what makes a future deletion visible as
// a test going red instead of as silence.

/** The attributes `gate-no-network.mjs` reads off a live element to look for a resurrected URL. A
 * parser that keeps text inert can still be made to fetch it if the sanitiser later resurrects one
 * of these as markup — shrinking this list silently shrinks what the gate can catch, which is why
 * `gate-assertions.test.ts` asserts its exact membership rather than only its length. */
export const PARITY_URL_ATTRIBUTES: readonly string[] = ['src', 'href', 'poster', 'data', 'srcset'];

/** Did any collected request touch the given host? (Control 1: the interception is watching.) */
export function sawHost(urls: readonly string[], host: string): boolean {
  return urls.some((url) => url.includes(host));
}

/** Is the list non-empty? Named per call site so a gate assertion reads as what it protects, not as
 * `.length > 0` repeated with no memory of why. */
export function hasEntries<T>(list: readonly T[]): boolean {
  return list.length > 0;
}

/** Does any recorded live-DOM violation mention this fragment? (Controls 3a/3b: the live-DOM check
 * can see an un-allow-listed element, and can see a block inside a formatting element.) */
export function mentionsTag(violations: readonly string[], fragment: string): boolean {
  return violations.some((violation) => violation.includes(fragment));
}

/**
 * Where a request resolved, relative to the document's own directory (`document-origin.ts`):
 * `contained` inside it (what the shell will serve through `asset:`), `escaped` elsewhere on the
 * same origin (e.g. a traversal), or `remote` (a different origin entirely). Control 4 asserts a
 * traversal classifies as `escaped`, not `contained`, which is what pins the directory itself.
 */
export function classifyRequestUrl(url: string, origin: string, directory: string): 'contained' | 'escaped' | 'remote' {
  if (url.startsWith(directory)) return 'contained';
  if (url.startsWith(`${origin}/`)) return 'escaped';
  return 'remote';
}

/** A `contained` request is only clean if it is a reference the document's own source actually
 * contains — the whole reference, not its last path segment, so `../x/passwd` cannot be excused by
 * a document that only ever wrote `passwd`. */
export function isReferenceInSource(url: string, directory: string, source: string): boolean {
  const reference = decodeURIComponent(url.slice(directory.length));
  return reference === '' || source.includes(reference);
}

/** A non-blank source that rendered to nothing would make every check after it vacuous. */
export function isRenderedBlank(html: string, source: string): boolean {
  return html.trim() === '' && source.trim() !== '';
}

/** One collected live element: its own tag, its own attribute names, and the tag of every ancestor
 * up to (not including) the host node the gate watches. */
export interface CollectedElement {
  readonly tag: string;
  readonly attributes: readonly string[];
  readonly ancestorTags?: readonly string[];
}

/**
 * The element half of the live-DOM check: an element outside the allow-list, or an attribute the
 * element's own rule does not permit, reached the DOM a reader's engine actually built.
 */
export function findAllowListViolations(
  elements: readonly CollectedElement[],
  allowedElements: readonly string[],
  allowedAttributes: Readonly<Record<string, readonly string[]>>,
): string[] {
  const found: string[] = [];
  for (const element of elements) {
    if (!allowedElements.includes(element.tag)) {
      found.push(`<${element.tag}>`);
      continue;
    }
    const permitted = allowedAttributes[element.tag] ?? [];
    for (const attribute of element.attributes) {
      if (!permitted.includes(attribute)) found.push(`${element.tag}[${attribute}]`);
    }
  }
  return found;
}

/**
 * The containment half of the live-DOM check: a block-level element sitting inside a formatting
 * element in the tree the engine actually built — what an unclosed `<a>` looks like once a parser
 * has had it, and the shape that turns a click anywhere in that block into a link to its author's
 * host.
 */
export function findContainmentViolations(
  elements: readonly CollectedElement[],
  blocks: readonly string[],
): string[] {
  const found: string[] = [];
  for (const element of elements) {
    if (!blocks.includes(element.tag)) continue;
    for (const ancestor of element.ancestorTags ?? []) {
      if (!blocks.includes(ancestor)) found.push(`<${element.tag}> inside <${ancestor}>`);
    }
  }
  return found;
}

/** An element name the output holds that the input's parser never built one from — the sanitiser
 * turned text a parser keeps inert into markup. */
export function diffParityNames(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...after].filter((name) => !before.has(name)).map((name) => `<${name}> built from text the parser keeps inert`);
}

/** A URL the output holds (on one of `PARITY_URL_ATTRIBUTES`) that the input's parser never built —
 * the sanitiser resurrected a fetch out of text a parser keeps inert. */
export function diffParityUrls(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...after].filter((url) => !before.has(url)).map((url) => `${url.slice(0, 80)} fetched from text the parser keeps inert`);
}
