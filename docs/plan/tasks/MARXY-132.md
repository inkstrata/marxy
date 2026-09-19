---
key: MARXY-132
design: [10-gates-and-testing]
depends: [MARXY-95]
verify: [node scripts/check-registry.mjs, node --test scripts/check-registry.test.mjs, pnpm test]
---
# MARXY-132 — See every way markup reaches the DOM, not only `innerHTML =`

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) §Writing a test an implementor cannot get wrong, `docs/design/README.md` (Hardened rules) · **Depends on:** MARXY-95 · **Source:** `orchestration/results/MARXY-95.notes.md` note 2.

**Outcome.** The `innerHtmlAllowedIn` allow-list is a sanitiser boundary — the places where a string may
become DOM. One regex enforces it, `/\.innerHTML\s*=/`, and MARXY-95's first attempt walked around it in
one line with `Reflect.set(el, 'innerHTML', html)` while CI stayed green. MARXY-95 fixes that site; this
closes the class, and gives `check-registry.mjs` the test it has never had.

## Files and signatures
- `scripts/check-registry.mjs` — replace the single `innerHTML` regex with a table of routes from a
  string to parsed markup: `.innerHTML =`, `['innerHTML'] =`, `Reflect.set(x, 'innerHTML', …)`,
  `.outerHTML =`, `.insertAdjacentHTML(`, `.setHTMLUnsafe(`, `document.write(`,
  `.createContextualFragment(`. Each problem message names the form and the allow-list it consulted.
  Export the matcher (`export function htmlRoutes(text)`) so the test drives it directly as well as
  through the CLI.
- `scripts/check-registry.test.mjs` — one case per route outside the allow-list, one case for all
  routes inside an allowed path, one comment-only case (not flagged), one string-concatenation case
  (flagged). Fixtures are written to a temp directory, never to the repo tree.
- `package.json` — the root `test` script's `scripts/check-one-parse.test.mjs` becomes
  `scripts/*.test.mjs`, so this test and every later `scripts/` test run without another edit.
- `docs/hygiene.md` — what the check enforces, and the rule the escalation produced.

## Do this, in order
1. Write the test first, against the check as it is: seven of the eight routes pass today. Paste that
   run in the PR — it is the "shown failing" evidence for the whole story.
2. Widen the check. Keep `stripComments` in front of it, keep the printed file count, keep every other
   registry rule untouched.
3. Run it over `main` and over MARXY-95's branch; paste both.
4. `pnpm test`, `pnpm precheck`, `pnpm done MARXY-132`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `check-registry.test.mjs` | 11 cases; each of the eight routes flagged outside the allow-list |
| the same eight inside `apps/desktop/src/render/` | none flagged |
| `node scripts/check-registry.mjs` on `main` | green, same file count as before |
| `pnpm test` | green, and it now runs every `scripts/*.test.mjs` |

## Acceptance → check
The seven criteria on the CSV row.

## Do not
Add or change a name in `scripts/registry.json`, or widen `innerHtmlAllowedIn` — a flagged real render
site is MARXY-95's row to fix, not this one. Add a `pnpm` script or a workflow file. Touch any other
rule in the check (marks, events, attributes, classes, custom properties). Flag a `.md` or fixture file.
