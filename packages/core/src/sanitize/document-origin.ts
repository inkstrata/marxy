// Where a document is assumed to be loaded from, which is the assumption the URL decision rests on.
// Recorded here rather than in a harness comment because two things depend on it and must not drift:
// `urls.ts`, which decides whether a value addresses somewhere else, and `scripts/gate-no-network.mjs`,
// which serves the corpus from `GATE_DOCUMENT_DIRECTORY` so a relative reference is a same-origin
// request rather than a scheme each engine invents for a base-less page.
//
// The assumption, for MARXY-45 to reconcile with the real shell:
//
// A value is judged under the *strictest* reading available, a URL with a special scheme (`https:`).
// Special schemes are the ones where the parser treats `\` as `/` and `/\host` introduces an
// authority; under a non-special scheme (`asset:`, `tauri:`) the same bytes are a path. The shell
// will load documents from `asset:`/`tauri:` on macOS and Linux and from `http://tauri.localhost`
// on Windows, so it is special on one platform and not on the others. Judging everything as special
// means this sanitiser refuses a value that would be harmless under `asset:` and never permits one
// that would be dangerous under `http:` — it is strict on two platforms and exact on the third,
// which is the safe direction. MARXY-45 owns making the shell's real scheme and CSP agree with this.

/** The origin `scripts/gate-no-network.mjs` serves documents from. */
export const GATE_DOCUMENT_ORIGIN = 'https://document.marxy.invalid';

/**
 * The directory the gate serves a document *in*; a request outside it has left the document.
 *
 * It must be a real directory rather than the origin root, or the check that a document cannot
 * reach outside it passes for everything: at the root, `../../../../etc/passwd` resolves to
 * `/etc/passwd`, which is inside the root. `render/boundary.test.ts` asserts the path, and the
 * gate's fourth control watches a traversal actually leave.
 *
 * There are two rules here and MARXY-45 has to pick one, because they are not the same rule. The
 * sanitiser keeps `../sibling/diagram.png` and `/local.png` — both are ordinary in a monorepo
 * README and neither tells anyone anything — while this gate fails any request that leaves the
 * document's directory. Nothing conflicts today only because no corpus document uses either form.
 * Whichever the shell enforces when it scopes `asset:`, the other should be changed to match, and
 * the sanitiser is the wrong place to decide it: it has no idea where the document lives.
 */
export const GATE_DOCUMENT_DIRECTORY = `${GATE_DOCUMENT_ORIGIN}/corpus/`;

/**
 * Three bases, which is how `urls.ts` asks the URL parser what a value addresses instead of asking
 * a regular expression. The first two differ only in host, the third only in scheme:
 *
 * - resolves the same against 1 and 2 → it brought its own authority, so it is absolute;
 * - resolves with a different scheme against 3 → it borrowed the document's scheme, so it is
 *   scheme-relative (`//host/x`), which means what it addresses depends on where the document
 *   happens to live, and that is not something this sanitiser may guess at.
 */
export const RESOLUTION_BASES: readonly [string, string, string] = [
  'https://first.marxy-resolution.invalid/directory/',
  'https://second.marxy-resolution.invalid/directory/',
  'http://first.marxy-resolution.invalid/directory/',
];
