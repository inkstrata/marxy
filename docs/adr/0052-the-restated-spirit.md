# ADR-0052 — The spirit: a reader for source of any kind, its values, and the commitments they harden into

- **Status:** accepted (author, 2026-10-07)
- **Date:** 2026-10-07
- **Amends:** ADR-0001 (Source is a real editor), ADR-0004 and ADR-0049 (the configured-command
  operation is scheduled; a plugin API is decided by ADR if one is wanted), ADR-0007 (the line
  breaker is one part of the typography), ADR-0009 (how privacy is worded). Restates the spirit in
  `AGENTS.md` and `docs/brief.md`.
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §1, and the author's answers
  to a structured review of the spirit on 2026-10-07.

## Context

The spirit was written at handoff, before Source became a real editor (ADR-0048, Phase E), before
remote content became a reader setting (ADR-0044), and before agent output became most of what
Marxy opens. The documents that state it had drifted from the decisions taken since. This ADR
states the spirit once, as it is now, so every document can quote it.

## Decision

### What Marxy is

Marxy is a reader for source of any kind: Markdown, HTML, code, logs, data, and what people and AI
agents write as text. It opens anything at once, gives you an index you can flip through, sets text
like a well-made book, shows you exactly what a file contains, and lets you operate on what you
read. Reading leads. Rendered is where you read and carries the quick operations; Source is a real
editor, sized to the work of reading: fixing, trimming and annotating what is in front of you. Chrome
at rest is zero; everything is summoned and dismissed (ADR-0050). The reader owns their tools: a
command they configure can act as an operation (ADR-0049).

### The values

Seven values, held together and unranked.

| Value | What it means |
| --- | --- |
| **Free** | MIT, no paid tier, no accounts; anyone may take it, change it and give it away. |
| **Private** | Nothing about the reader or their files leaves the machine unless the reader acts. |
| **Faithful** | The file is the reader's. Marxy changes exactly what the reader asked, and shows the file exactly as it is in Source. |
| **Fast** | Any file opens at once, and a file that changes under you keeps your place. |
| **Beautiful** | Text is set like a well-made book, following the research (ADR-0033). |
| **Honest** | The reader can always see what a file really contains, however it was made and whoever made it. |
| **Accessible** | The reader's own settings (text size, contrast, motion, assistive technology) shape the page, and the page has real structure for the tools that read it. |

When two values pull apart in a design, the resolution favours the reader in front of the page,
and the trade is written down where it is made (the story, the pull request or an ADR).

### How values harden

Every value is held in review from the first line of a feature. As development reaches the part
of Marxy a value governs, the value hardens: first into a test or a gate, then, where a floor can
be stated exactly, into a commitment. A commitment is a hardened value. It is never traded, and a
pull request that breaks one is returned.

### The commitments

1. **Free.** MIT, no paid tier, no accounts. Every dependency is redistributable under it
   (ADR-0006).
2. **Private by default.** No telemetry, ever, in any form. Nothing leaves the machine without
   a reader action (ADR-0044). Every promise Marxy makes about privacy names what a reader action
   sends and to whom.
3. **Faithful to the bytes.** Marxy changes only the bytes the reader asked to change: no
   reformatting, no normalising, no diff noise. Source shows the file exactly. Marxy keeps its own
   state (reading positions, collections, layouts, consent) in plain, readable files in the
   platform's config and data directories, apart from the reader's documents.
4. **Nothing hidden silently.** Rendered may reshape what it shows (fold frontmatter into a header,
   set comments aside, restyle), and marks every place it does, with Source one action away. A
   link's real target, bidi controls and zero-width characters are visible in Rendered. A deeper
   inspection view is summoned when wanted.
5. **First text never waits for the whole file.** Any file that fits in memory opens, and the
   reader sees text before the whole of it is laid out. Millisecond budgets are recorded
   (ADR-0032); this commitment is about waiting, not about a number.

## Consequences

- `AGENTS.md`, `docs/brief.md` and `docs/scope.md` state this spirit in the same pull request.
  ADR-0001, 0004, 0007, 0009 and 0049 are marked amended in the index; their bodies stay as written.
- **Hardening in progress.** Commitments 1 to 3 hold today and are tested (`pnpm gate:fidelity`,
  `pnpm gate:no-network`, `pnpm gate:licences`). Commitments 4 and 5 are being built: a 1 MB document
  takes seconds to first text (`docs/research/audit-2026-10/05-performance-audit.md` §9), and the
  marks of commitment 4 are not drawn yet. Each gains its test with the story that builds it:
  - the honesty marks, tested over `fixtures/corpus/29-hidden-characters.md`;
  - first text before full layout, tested on the long-reference fixture
    (`fixtures/corpus/32-long-reference.md`);
  - the configured-command operation of ADR-0049.
- **Accessible hardens next.** Rendered keeps document semantics (headings, lists, tables, code
  as code) and follows the operating system's text size, contrast and reduced-motion settings; a
  story adds an automated structure and contrast check once the per-article view of Phase B lands.
- **Honest hardens beyond commitment 4** through the summoned inspection view, when a story
  builds it.

## Alternatives considered

- **Rank the values.** A fixed order settles arguments quickly and settles them the same way every
  time, including the times it is wrong. Resolving toward the reader, and writing the trade down,
  keeps the values equal and the reasoning visible.
- **Rendered shows every byte.** Frontmatter and comments read badly as prose; Source is where the
  exact file lives, and commitment 4 keeps Rendered honest about the difference.
- **Gate the speed budgets.** ADR-0032 stands; commitment 5 is about waiting.

## How we would know this was wrong

1. A reader is misled by something Rendered reshaped without a mark: commitment 4 failed in
   practice, and what Rendered may reshape shrinks.
2. A value is cited in review for months and never hardens: it is a slogan, and either gets a test
   or leaves the list.
3. Source grows a project tree, a terminal or language-server features without an ADR: the editor
   has outgrown the reading it serves.
