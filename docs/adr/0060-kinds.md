# ADR-0060 — Kinds: fourteen ways a file is read, detected from its bytes, its path and the reader's rules

- **Status:** proposed
- **Date:** 2026-10-10
- **Amends:** ADR-0005 ("Markdown opens Rendered; anything else opens Source" becomes "a file's kind
  decides which mode it opens in"). Builds on ADR-0059 (a kind is a theme scope; `data-marxy-kind` is
  reserved), ADR-0049 (the reader owns their tools) and ADR-0052 (commitments 3 and 5).
- **Evidence:** [`docs/plan/direction-2026-10/06-reconciliation.md`](../plan/direction-2026-10/06-reconciliation.md)
  rows 7 and 8 (the set and the byline, ruled 2026-10-10);
  [`03-kinds-and-the-look.md`](../plan/direction-2026-10/03-kinds-and-the-look.md) §Kinds, §Detection,
  §Profiles; [`mock-v2/03-content-modes.md`](../plan/direction-2026-10/mock-v2/03-content-modes.md)
  §Detection, §The types, §Overrides; [`docs/research/reader-artifacts/10-spec.md`](../research/reader-artifacts/10-spec.md)
  (the derived JSONL view, logs, diffs, §Overrides by artifact type).

## Context

Marxy reads one way. A file is either Markdown, typeset as prose, or anything else, shown verbatim in
Source (ADR-0005; `defaultModeForPath` in `apps/desktop/src/source/default-mode.ts`, which renders
`.md`, `.markdown`, `.mdx` and `.txt`). A plan, a README, a session log and a build log are read
differently, and treating them the same serves one genre and damages the rest (mock 03). The direction
gives every file a *kind* with a *profile*: how it is set, which values a theme gives it, what Read
does with it and which mode it opens in. ADR-0059 made a kind a theme scope and left the set to this
record; K-03 (detection), K-04 (reader rules and *show as*) and K-05 (the attribute and the first
profiles) build on it. The set and the byline were ruled on 2026-10-10 (06, rows 7 and 8); this record
writes them down and decides what those rulings left open.

## Decision

1. **A kind is how a text is read, never where it came from.** A file has exactly one kind at a time,
   one of the fourteen below. The kind selects a profile (token values in a kind scope, ADR-0059 item
   7), a Read treatment and a default mode. It says nothing about who or what wrote the file: none of
   the kinds is "AI", a plan written by hand is a `report`, and a transcript is a transcript whether it
   came from a chat tool or a meeting.

2. **The set is closed.** `KINDS` in `packages/core/src/contracts/kinds.ts` holds the fourteen names in
   the order of the table below, `Kind` is their union and `DEFAULT_KIND` is `article`.
   `kinds.test.ts` holds the table and the constant equal. Verse, slides and drama are later and not
   in the set; adding a kind is a change of meaning and needs an ADR (ADR-0045). A name outside the set
   (in a reader rule, a *show as* record, or a file written by a later Marxy) is ignored with a notice
   naming it, never guessed at.

### The kinds

| Kind | How it is read | Opens in, once its story lands | Reflows | Story |
| --- | --- | --- | --- | --- |
| `article` | The default: continuous prose set as a page of a well-made book; a byline and dek from front matter | Rendered | yes | K-05, K-20 |
| `report` | A working document (plan, handoff, spec, audit): sans, a wider measure, ragged, paths never broken | Rendered | yes | K-05, K-14 |
| `book` | Long form, paged: one measure per page, small-caps openings, scene breaks | Rendered | yes | K-21 |
| `readme` | A repository's front page: forge conventions, badges as one muted line, install commands to copy | Rendered | yes | K-05, K-14 |
| `docs` | A reference page: the signature block emphasised, sections of parameters, returns and examples | Rendered | yes | K-22, K-14 |
| `code` | A source file, verbatim: never reflowed, ligatures off, line numbers outside the copied text | Source | no | K-13 |
| `transcript` | Turns of a conversation: the speaker outdented in small capitals, a tool call one line at rest | Rendered for Markdown; Source for JSONL | yes (Markdown) | K-11, K-12 |
| `data` | Structured data (JSON, JSONL, YAML, TOML, CSV, TSV), verbatim, with a depth and a table lens summoned | Source | no | K-10 |
| `notes` | Daily and working notes: dated, linked, their tasks kept as written | Rendered | yes | K-22 |
| `changelog` | A release history: versions as the index, one release's notes copied whole | Rendered | yes | K-22 |
| `log` | A build or app log: level words in weight 700, timestamps quiet, `␛` visible, a trace kept with its line | Rendered | no | K-08 |
| `terminal` | A shell session: prompt, command and output grouped; `␛` visible and never interpreted | Rendered | no | K-17 |
| `diff` | A unified diff or patch as authored: markers kept in text and clipboard, line tints a second channel | Rendered | no | K-09 |
| `html` | An HTML file, verbatim; a sanitised Rendered view on the existing HTML trust path is later | Source | no | none yet |

*Reflows* answers ADR-0059 item 7's handoff: a kind that reflows is set to a measure, and the theme
validator clamps its `--marxy-measure-chars` to 45–80 characters; a kind that does not reflow keeps
its lines as authored. For a kind that does not reflow, the reader's typesetting adjustments (the
typography panel, K-15) change only size and face (03 §Profiles, Galley's coupling rule); what a
theme's kind scope may set is ADR-0059 item 7's list, which this column does not narrow. A JSONL
transcript's bytes do not reflow; its derived view (ADR-0061, K-12) does.

### Detection

3. **Seven tiers, highest first.** The first tier that names a kind decides it; inside a tier the
   strongest signal wins, and a tie goes to the kind earlier in the table, so a golden is never a
   coin toss. Every signal that fired, in any tier, is kept with the kind as a reason
   (the signal, the kind it pointed to, and where it was seen: the rule's glob, the file name, a line),
   so the kind chip's menu and the inspector can say why. K-03 builds this in core, as a pure function
   of the path, a prefix of the bytes and the reader's rules.

   **The text family** is what Marxy parses as Markdown: the extensions it renders today (`.md`,
   `.markdown`, `.mdx`, `.txt`, `RENDERED_EXT` in `default-mode.ts`), plus an extension-less file
   named `README`, `CONTRIBUTING`, `CHANGELOG`, `CHANGES` or `HISTORY`. Tier 2 applies only inside the
   text family, and tier 3 only outside it, so a README with a format extension keeps its format's
   kind: `README.rst` and `README.org` are `code`, and `README.html` is `html`, on the HTML trust path.

   | Tier | Signal | Points to |
   | --- | --- | --- |
   | 1. Reader | *Show as* chosen for this file (item 9) | Whatever it says |
   | 1. Reader | A `[[kind]]` rule in `config.toml` whose glob matches the path; first match in file order wins (K-04) | Whatever its `is` says |
   | 2. Name (text family; case-insensitive) | `README*`, `CONTRIBUTING*` | `readme` |
   | 2. Name (text family; case-insensitive) | `CHANGELOG*`, `CHANGES*`, `HISTORY*` | `changelog` |
   | 3. Format | `.diff`, `.patch` | `diff` |
   | 3. Format | `.html`, `.htm` | `html` |
   | 3. Format | `.log`, `.out` | `log` |
   | 3. Format | `.term`, `.session` | `terminal` |
   | 3. Format | `.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.csv`, `.tsv` | `data` |
   | 3. Format | A source-language extension, a build-file name (`Makefile`, `Dockerfile`), a dotfile, or a `#!` shebang | `code` |
   | 3. Format | Any other extension | `code`, with no language |
   | 3. Format | No extension, outside the text family (`LICENSE`, `AUTHORS`) | `code`, with no language, unless a tier-4 signal names `log` or `terminal` |
   | 3. Format | The text family | go to tier 2, then tier 4 |
   | 4. Shape | JSONL whose lines are objects with a role or message type | `transcript` |
   | 4. Shape | Speaker headings that name a role (`## You` / `## Assistant`, `User`, `Agent`, `Tool`); a heading that names a product or a model is not a speaker signal | `transcript` |
   | 4. Shape | Most lines open with a timestamp and a level word; indented frames after an error | `log` |
   | 4. Shape | Prompt lines (`$ `, `user@host dir %`) each followed by output | `terminal` |
   | 4. Shape | A "Chapter" heading with long paragraphs, or chapter-numbered file names | `book` |
   | 4. Shape | Several admonitions or sections named Parameters, Returns, Errors, Example | `docs` |
   | 4. Shape | Several working headings: Summary, Context, Risks, Next steps, Open questions, Verified, Recommendation | `report` |
   | 5. Byline | Front matter with `author` and either `published` or `source` | `article` |
   | 6. Weak shape | Task lists without working headings | `report` |
   | 6. Weak shape | A dated file name, or a folder named `notes` or `journal` | `notes` |
   | 7. Default | Nothing above, in the text family | `article` (`DEFAULT_KIND`) |

   Tiers 4 to 7 apply to the text family, with two exceptions stated here once: tier 4's first row
   may refine a `.jsonl` file from `data` to `transcript`, and a tier-4 signal may name `log` or `terminal` (kinds
   that open in Source) for an extension-less file outside the text family; any other shape it shows is
   a reason only, so such a file stays `code` and its opening mode does not change. Otherwise a file named in tier 2 or given a kind by
   its format in tier 3 keeps that kind, and its shape signals are kept as reasons only.

   *Several* is not one: a single Summary heading or a single Returns section does not make a report
   or a docs page. K-03 sets the threshold for both rows (more than one heading or section of the
   list) and records it with its goldens.

4. **The byline outranks weak shape and yields to strong shape.** A byline names a text's form: an
   article has an author and a date or a source it was published at, as a printed piece has a byline.
   That is shape, not authorship, which is why 06 row 8 lets it count. Detection reads only whether
   the keys are present, never their values: `author: Ada` and `author: an agent's name` point the same
   way. A text with speaker headings and a byline is still a `transcript`.

5. **Never a signal.** Detection reads no front-matter key except `author`, `published` and `source`,
   and of those only their presence. `model`, `session`, `generated_by`, and any key naming a tool, a
   model, an agent or who wrote the file are never read; neither is any value. Built-in detection
   matches no path that names a tool or vendor (`.claude/`, `.cursor/`, `.codex/` and the like): a
   reader who wants those folders read a certain way writes a `[[kind]]` rule, which is theirs. A
   speaker heading that names a product or a model is not a speaker signal (tier 4). An `author` key
   whose value is empty or null counts as absent. As rules a test can hold (K-03's goldens):
   - *Front matter:* for every corpus file that has front matter, adding, removing or changing any key
     other than those three, or changing the value of any key, leaves the detected kind unchanged. The
     mutation is made on the parsed key and value map and written back, not on raw bytes, so a test
     cannot break the front matter's syntax by accident.
   - *Path:* moving any corpus file under a `.claude/`, `.cursor/` or `.codex/` folder leaves its
     detected kind unchanged.

6. **First text never waits for detection** (commitment 5). Tiers 1 to 3 need the path, and a shebang the first line. Tiers 4
   to 6 read a bounded prefix of the file, never the whole file. K-03 sets the bound and records it;
   it is measured from the end of the front matter, so a long front matter never pushes a shape signal
   out of it, and the first screen of a JSONL file is inside it. A kind is decided once when a
   file opens and kept while it is open, through live reloads, until the reader chooses *show as* or
   opens the file again: a view that changes its kind under the reader is worse than a weaker guess.

### Kind and mode

7. **A kind has a default mode, and the reader's choices override it.** Which mode a file opens in is,
   highest first: `⌘E` in this pane (it still toggles, per pane, ADR-0057); the matching rule's `read`
   (`read = true` opens Rendered, `read = false` opens Source); the kind's default mode from the table.
   *Show as* changes the kind, and with it the default mode. Neither mode loses a kind: Source shows
   any kind's bytes exactly, and Rendered shows a kind with no Read treatment the way it shows it
   today.

8. **A kind with no profile yet reads as today.** Until a kind's story lands, its default mode is
   today's rule (Rendered for `.md`, `.markdown`, `.mdx` and `.txt`; Source otherwise; from K-05,
   Rendered for the whole text family), and in Rendered
   it is set by the default theme as prose is now. Its name is still detected, kept with its reasons
   and, once K-05 lands, written to `data-marxy-kind`, so a theme may style it early. The story that
   gives a kind its profile and Read treatment also switches its default mode to the table's, in the
   same pull request, with a test. So, today:
   - *Already open in Rendered, and stay there:* `article`, `report`, `book`, `readme`, `docs`, `notes`,
     `changelog` and a Markdown `transcript`, whenever the file is in the text family, which is
     what detects them.
   - *Open in Source now and move to Rendered with their story:* `log` (K-08), `diff` (K-09) and
     `terminal` (K-17). A `.txt` that detects as a log or terminal session opens Rendered as prose
     today, as it does now.
   - *Open in Source and stay there:* `code`, `data`, `html` and a JSONL `transcript`. Their Read
     treatments (K-13's listing, K-10's lenses, K-12's derived view) are reached by `⌘E` or, for a
     JSONL transcript, by a rule with `read = true` (10-spec: Source stays the default for `.jsonl`).
   K-03 changes no file's opening mode. K-05 makes one intended change: an extension-less `README`,
   `CONTRIBUTING`, `CHANGELOG`, `CHANGES` or `HISTORY`, which opens in Source today, opens Rendered
   once K-05 lands (a README in its profile, a changelog set as prose until K-22). Every other file
   opens as it does now: K-05's three profiles (`article`, `readme`, `report`) are kinds that already
   open in Rendered, and every other extension-less file is `code`.

### Where the reader's choices live

9. **A per-file choice is Marxy's data; a folder rule is the reader's file.** *Show as* (this file
   only) is a choice Marxy observes and keeps, like a reading position: it lives in a plain file of
   its own, `kinds.json`, in Marxy's data directory beside `positions.json`, keyed by path, with the
   same version guard, size cap and quarantine of a corrupt file (K-04). Unlike positions, it is
   never evicted: at its size cap a new *show as* is refused with a notice naming the cap, and no
   earlier choice is dropped silently. It holds a kind and nothing else; the reader who wants one file
   always in Read writes a rule whose glob is that file.
   *Always open this folder as* writes a `[[kind]]` table to the reader's `config.toml`, appended
   without touching another byte, the way "Add this folder" appends to `collection.toml` (C-03), and
   the reader edits or deletes it in any editor. A per-file choice beats a folder rule, because it is
   the more specific; a rule beats detection, always. Neither writes to the document (commitment 3).

```toml
[[kind]]
glob = "~/.claude/projects/**/*.jsonl"
is = "transcript"
read = true          # open in Read, not Source
```

## Consequences

- K-03 implements detection in core from items 3 to 6, returning a kind and its reasons, with goldens
  over the corpus that include item 5's mutation rule. K-04 parses `[[kind]]` (`glob`, `is`, `read`)
  and keeps `kinds.json`. K-05 writes `data-marxy-kind` (ADR-0059 item 7) and ships the first three
  profiles. K-06 records each index entry's kind. Each reading story switches its kind's default mode.
- `defaultModeForPath` stays until a reading story replaces it; this record changes no code that runs.
- ADR-0005's line "Markdown opens Rendered; anything else opens Source" holds only for kinds without a
  profile; ADR-0005 carries an *Amended by* line.
- `data-marxy-kind`'s values are exactly `KINDS`; a theme scope naming another value matches nothing.
- An unknown extension, and an extension-less file outside the text family, is read verbatim as
  `code`, as it opens in Source today; `article` is the default of the text family, not of every file.
  *For the author:* this is option A; option B would make them `article` (a `.conf` file typeset as
  Markdown, its opening mode changed). The PR lists both.
- 03 §Profiles gives `readme` a measure of 84 characters, beyond the 45–80 the validator clamps a
  reflowing kind to. K-05 (which sets the profile) and H-03 (which writes the clamp) settle it: either
  the README profile is 80, or the clamp's exception is written down where the clamp is.

## Rejected

- **`prose` as the default name** (03): 06 row 7 ruled `article`, the mock's name, which ADR-0059's face
  role already uses.
- **Authorship as a signal** (Galley detects reports by `generated_by` and `model`): a kind is about how
  a text is read, and lifting authorship out of front matter is how tagging starts.
- **Additive scoring across every tier**: a reader rule must win always, and a file named `README` must
  not become a transcript because it quotes a conversation; tiers make both certain, and scoring stays
  inside tier 4 where the mock's "strongest wins" is about shape.
- **`article` for every unrecognised file**: a configuration file in an unknown format would be parsed
  as Markdown and typeset, which shows the reader something the file does not say.
- **Switching every kind's mode when detection lands**: a log opened Rendered before K-08 would read as
  justified prose, worse than the Source it opens in now.
- **Re-detecting on every live reload**: a growing file could flip between kinds while it is read.
- **Storing *show as* in `positions.json`**: positions are evicted by recency and rewritten on every
  scroll; a choice the reader made should not share their fate, and the position contract would change.
- **A per-file mode choice**: one place for "open this in Read" (a rule, whose glob may be one file)
  keeps the reader's intent in the reader's file.

## How we would know this was wrong

- K-03's goldens need a kind outside the fourteen to read a corpus file well, or two kinds that read
  the same.
- A reader's rule and detection disagree often on files nobody wrote a rule for, so the chip's *show
  as* is reached for routinely: the tiers or the signals are wrong.
- A file opens in a different mode after K-03 or K-05 lands than before it, other than the
  extension-less READMEs and changelogs item 8 names.
- Detection needs more than a bounded prefix to be right on the corpus.
