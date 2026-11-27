# Design principles

The rules every change follows, a one-line fix as much as a new subsystem. `check-boundaries` and the other
checks in `pnpm check` enforce some of them; the rest rely on whoever writes and reviews the change.

They come from a review of the whole code base in November 2026. The core was sound: the byte buffer, the parser,
the sanitiser, the registries. The problems were at the seams: the same idea implemented several times, every
folder importing every other, a few functions thousands of lines long, and tests that pass on only one machine.
Each of those started as a narrow change that was reasonable on its own. Where the code still breaks a principle,
the principle says so: do not copy the exception.

## Before a narrow change

1. **Find the owner.** Most problems belong to a concern that already has one place in the code (the table below).
   Make the fix there, not where the symptom shows.
2. **Look for copies.** Search for the function, selector or check you are about to touch (`rg`). If it exists twice,
   a fix to one copy is half a fix: fix every copy, or route your caller through the owner.
3. **Add nothing global.** Do not add a `document` or `window` key listener, a module-level singleton, a new
   `appHandle()` call in a leaf module, a new "is a modal open" selector, or a new copy of a helper.
4. **Keep the narrow fix narrow.** If the right fix is structural (merging copies, splitting a function, moving a
   module), make the smallest correct fix and add a row to `work/todo.md` for the structural work. Do not grow the
   workaround, and do not restructure as a side effect of a fix.
5. **Check work in flight.** Before you move or split a file, check whether an open pull request or a live branch
   changes it (`pnpm work`, `gh pr list`, the `Branch` cells in `work/todo.md`). If one does, wait or coordinate.

## One owner per concern

Every decision that cuts across the app has one implementation. Before writing a helper, a check or a mechanism,
look for its owner. If there is none, make one, and do not add a second.

| Concern | Owner | Exceptions in the code today; do not add more |
| --- | --- | --- |
| Which paths and handles the shell may touch | `src-tauri/src/scope.rs` and `scope/`: `scope::check` with a `Need`, the served rule for what a document loads (`scope::served`), one handle check | none |
| Every privileged operation | the `Shell` interface, implemented in `shell/tauri.ts` and `shell/memory.ts` | none |
| Which chord runs what | the command registry (`commands/registry.ts`: a command's `key` and `keys`); palette and keyboard share one list | about ten `document` and `window` keydown dispatchers, ordered by capture phase and `stopPropagation` |
| Whether a modal owns the keyboard | `pageModalOpen` (`pane/keys.ts`) | other places test their own selectors; `inEditable` is defined twice |
| A work limit on untrusted input | `budget()` (`packages/core/src/util/budget.ts`) | some readers carry their own (`XmlBudget` in `office/xml.ts`) |
| Text helpers in core | `packages/core/src/util/text.ts` (line starts, offsets, trimming) | several readers split lines and count UTF-8 bytes themselves |
| Counted words the reader sees | `plural` in `frame/dom.ts` (numbers grouped: 1,234 files) | about 25 other definitions, most printing the bare number (1234 files) |
| Errors from Rust commands | `ShellError` (`src-tauri/src/error.rs`) | `commands/os.rs` defines a second one; many commands return `Result<_, String>` |
| Limits and failures of a binary reader | `Limits` and `Fault`, as in `archive/`, `tables/`, `outlook/` and `legacy_office/` | none |

## Dependencies point one way

- Packages never import the app, and `packages/core` uses no DOM and no Node (enforced).
- Import core from the package, `@marxy/core`. If the name you need is not exported, export it from
  `packages/core/src/index.ts` instead of importing from `@marxy/core/src/...`. Most of the app still uses the
  deep paths; do not add more.
- A module gets what it needs as arguments: an interface holding only the calls it makes. Viewers, renderers,
  document code, Source and the view do not call the global `appHandle()`; the composition root and command handlers
  pass them what they need.
- A folder that many others use (the helpers in `frame/dom.ts`, `pane/`) does not import the folders that use it.
  Folders that import each other cannot be moved, tested or understood alone.

## The keyboard decides once

- A new chord is a `key` or `keys` entry on a command in the registry, not a new listener.
- Something that takes the keyboard (a sheet, a menu, a popup) marks itself so that the existing owner checks
  find it. A `<div>` modal uses `role="dialog"` and `aria-modal="true"` for `pageModalOpen`.
- Do not fix a key bug by adding `stopPropagation`, switching to the capture phase, or reordering listeners. Find the
  dispatcher that should own the key, and give it the key.

## Functions short enough to read

- `createRenderedView`, typeset's `attach()`, the archive viewer and the table lens are closures over hundreds of
  `let`s and nested functions. New behaviour goes in its own module with explicit inputs, called from the factory,
  not as one more nested function and one more `let`.
- A listener, observer, timer or subscription is removed in the same change that adds it, on the owner's
  `destroy`.
- Keeping the page still: the rendered view already has several ways to hold the scroll position. Use one of them
  and say which. Never add another. The same goes for "where the reader is": use an existing place type.

## Untrusted bytes get a budget

The rule is in [Architecture](architecture.md#work-on-untrusted-files). On a narrow change: every loop over a
file's bytes, lines, nodes, entries or nesting has a limit from `budget()`, and a quadratic step is a bug even when
small files are fast. Common quadratic steps: a join over every path prefix, `shift()` in a breadth-first walk, a
rescan per nesting level. Prove the limit with a hostile input, as in `packages/core/src/util/hostile-input.test.ts`.

## Two implementations only with a test that holds them equal

The Tauri and in-memory shells, and the Rust and TypeScript archive readers (the TypeScript one reads archives
nested inside archives), exist twice for a reason. They share fixtures, and a test fails when they disagree. A fix
to one goes into the other in the same change. Anything else exists once.

## Platform code at the edges

In Rust, `cfg(windows)`, `cfg(unix)` and `cfg(target_os = …)` go in small platform functions. They do not go
inline in logic: `atomic_write.rs` and `main.rs` show how that reads. In TypeScript, reuse an existing platform
check rather than writing another `isMac`.

## Tests wait for conditions, not time

- A new browser test has no fixed sleep. It waits for something the reader would see or the app announces: an
  element, a `marxy:` event, the typesetter going idle. If nothing observable exists, add a hook registered in
  `scripts/registry.json`.
- Boot the app once per file, and share setup through `apps/desktop/test/support/` instead of pasting it.
- Record timings; fail on one only when the budget is what the test is for and holds on a hosted CI runner with room
  to spare.
- A test that passes only on one desktop is not finished.

## Every check runs somewhere

A gate, probe or check runs in a `pnpm verify` tier or in CI. Otherwise its header and [Testing](testing.md) say it
is run by hand, and why. A check that never runs stops being true.

## Structure changes stand alone

A move, split or merge changes no behaviour and lands in its own pull request, after the in-flight branches that
touch the same files. Review compares behaviour before and after, so mixing structure and behaviour in one pull
request hides both.

## Shapes to copy

When something new needs a design, model it on what already works:

- **The byte buffer and `splice`:** one way to change a document, with byte provenance kept.
- **The command registry:** one list, one shape per entry, read by the palette and the keyboard.
- **The kind registry:** a new file type is one entry ([File types](file-kinds.md)).
- **`scope::check` with a `Need`:** the question asked in one place, with what is needed stated.
- **`Limits` and `Fault`:** limits as data, failures as values.
- **`Shell` with two implementations:** privilege behind one interface, testable without a window.
