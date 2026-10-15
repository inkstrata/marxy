# ADR-0075 — A settings page in v1: a view of `config.toml`, which stays the only store

- **Status:** accepted (author ruling, 2026-10-13, W-12 question 1: "default accepted")
- **Date:** 2026-10-13
- **Amends:** ADR-0019 (the v1 cut lists "a settings UI (a config file suffices)" as not in v1) and `docs/scope.md` (its
  "Settings UI, v1.1" row). `docs/design/11-config-and-storage.md` ("There is no settings UI in v1") follows. ADR-0019 is
  read, not reversed: a config file still suffices, and the page is an addition for the reader who would rather not edit one.
- **Evidence:** the W-12 card in `docs/plan/direction-2026-10/20-cards-wave-11.md`; `docs/plan/direction-2026-10/02-fold-up-workspace.md`
  §Settings; `mock-v2/08-settings.md`; `docs/plan/direction-2026-10/06-reconciliation.md` (no telemetry switch, no
  `settings.json`); `docs/design/11-config-and-storage.md`.

## Context

ADR-0019 cut a settings UI from v1 because "a config file suffices", and `docs/scope.md` put it at v1.1. Since then the
config file has grown to eighteen keys, most of them a reader's own taste: the text size, the measure, the contrast and
transparency of the chrome (W-22), what Source draws (V-08), whether Marxy keeps versions (V-06). A reader can find none
of them without the design notes, cannot see which they have changed, and cannot see what Marxy keeps on their disk or
what can leave it, which commitment 2 says every privacy promise must name. The direction (05, W-12) plans a page for it.
The threat ADR-0019 guarded against was a second store drifting from the first and a feature that costs a weekend of
ceremony. A page that is only a view of the file has neither.

## Decision

1. **A settings page is in v1.** `Mod+,`, *Settings…* in the Marxy menu and the palette open **Settings** as a page in the
   workspace, as the library is: it takes the place of the panes, which come back as they were, and it unfolds the window
   first if it is folded (W-12 question 2, recommended default; folding hides the page with the rest).
2. **`config.toml` is the only store.** The page reads it and writes it; it keeps nothing of its own: no `settings.json`,
   no second file, no setting that has no key in `config.toml`, and **no telemetry switch** (there is no telemetry to
   switch; ADR-0044, `06-reconciliation.md`). A reader who prefers the file loses nothing: every key still works by hand,
   a hand edit shows on the page at once, and an unknown key is kept.
3. **A change writes one line.** Each change is written at once through the one function every key already uses
   (`setTopLevelKey` by way of `writeReaderKey`): the key's line is replaced or appended, and every other byte, comment,
   line ending and ordering is kept. The page writes only the key the reader changed. A reset removes the key's line
   (`removeTopLevelKey`) and nothing else, so the setting follows its default again.
4. **A file changed on disk is never overwritten silently.** A write is made from the bytes the page last showed; if
   `config.toml` is not those bytes any more, the write is refused, the page shows the file as it is now, and says so.
5. **The page is computed from the code, not written in prose.** Its rows come from a schema (`packages/theme/src/settings-schema.ts`)
   in which every key `config.ts` parses has exactly one row, and a test fails for a key without one. The Privacy page lists
   each file Marxy keeps, with its size and path, read-only; and each action that can send something off the Mac, with what it sends
   and to whom, from a table that a test holds equal to the shell's network-capable calls. "Nothing else leaves this Mac" is
   said only because that test passes. Anything that deletes (*Clear all versions*) asks first and says it is permanent.
6. **Not built here.** The per-kind typography panel (K-15), the theme editor (K-16) and per-kind measures (W-16) are other
   stories. Clears for files other than versions (positions, history) are new writes with their own questions (W-12
   question 3).

## Consequences

- ADR-0019's status line points here; the scope table's row reads "in v1, as a view of `config.toml`".
- A key added to `config.ts` without a schema row fails `settings-schema.test.ts`, and a shell call added without a row in
  the privacy table fails `privacy.test.ts`. Both are the point.
- `config.toml` is now written by a page as well as by commands; the stale-write guard of ADR-0004 applies to it as to a
  document.
- Rejected: a separate Settings window (the mock's choice): Marxy is one window, the workspace has a place for a page,
  and a second window would need its own state, focus and close handling for no gain a page lacks.
