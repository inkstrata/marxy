# Capture, not tracking

**In short.** AI tools already write everything they do to the reader's disk: session logs, plans,
reports, worktrees. Marxy does not need to talk to agents, know which one is running, or keep a
record of sessions. It needs to read the folders those files land in, the way it reads any folder,
and to handle a file that changes while it is open. Optionally, a *capture rule* copies those files,
byte for byte, into a folder the reader owns before the tool that wrote them prunes them. Nothing in
this page knows the word "agent" at run time.

## What Marxy does not do

- No session objects, session list, session ids, model names, costs or token counts.
- No "live", "running" or "finished" state, no dots, badges, banners, notifications or Dock bounces.
- No integration with any agent's API, hooks, sockets or protocol. An agent is a process that writes
  files, like a compiler or a logger.
- No grouping by agent, model or session, and no searching by them.

Galley builds all of these. They are the over-fit the author named: tracking AI sessions tightly is
not what Marxy is for.

## Reading where things land

Agent tools write to predictable places. Claude Code keeps a JSONL log per session under
`~/.claude/projects/<project>/`, plans under `~/.claude/plans/`, and worktrees under
`.claude/worktrees/`; other tools have their own folders. Marxy already has most of what reading them
takes:

| Need | Already built or planned | Added by this direction |
| --- | --- | --- |
| Say which folders count | `collection.toml` roots (ADR-0053, C-03, C-10) | — |
| Find a file in them | The palette, recency, content search (C-17) | Palette previews (Phase N) |
| See what is new | *Changed since you read* in the empty palette (C-12) | The same view in the sidebar, and a quiet changed mark in the tree |
| One file, several worktrees | Worktree folding (C-15) | — |
| Read a JSONL session as a conversation | — | The `transcript` kind and its derived Read view (Phase K) |
| Read a plan as a working document | — | The `report` kind (Phase K) |
| Know what a session folder holds without opening each file | — | In the tree, the library and the palette, a transcript is titled by its first prompt, so `3f1c…e2.jsonl` reads as what it was about |
| Keep reading while the file grows | — | Append-aware live files (below) |

The "smart" part is all in reading: a kind detected from the bytes, a dek drawn from the file's own
first line or first prompt, copies folded, and freshness shown as text. It is the same machinery
that serves a folder of logs, of build reports or of meeting notes. A reader's `config.toml` rule
can make `~/.claude/projects/**/*.jsonl` open in Read; Marxy ships no such rule by default.

## Live files without agents

A file that changes while it is open is Marxy's defining interaction (`docs/brief.md`), and it is
not specific to agents: a build log grows, a report is regenerated, a data file is rewritten by a
script. Marxy tells two shapes of change apart from the bytes alone:

| Shape | How it is recognised | What Read does |
| --- | --- | --- |
| **Appended** | The file grew and its old bytes are an unchanged prefix of the new (compared by hash of the old length) | Parses only the tail. If the reader was within a screen of the end, the page follows the tail, as a terminal does; otherwise nothing moves, and following resumes when the reader scrolls back to the end |
| **Regenerated** | Anything else | Keeps the reading position (ADR-0018), marks the blocks that changed since the reader last read them with the summoned margin rule (E-17), and puts the diff in the inspector's Versions tab |

There is no "live" state and nothing to mark: a file is simply the bytes on disk now, and Marxy
reacts to how they changed. For logs and JSONL transcripts, appended is the common case, and a
tail-only parse keeps first text instant however long the file grows (commitment 5). B-24
("re-render only what a reload changed") is the regenerated half of the same work.

**Unsaved edits when the file changes on disk.** One rule, whoever wrote the file: Marxy says the
file changed on disk and offers *keep mine as a copy* (written beside, never over) or *take theirs*.
It never merges silently. Galley's agent write-lock and three-way merge are left out: they need to
know an agent is writing, and they hide a merge.

## Capture rules

Reading in place has one weakness: the folders are not the reader's. Tools prune old sessions,
move projects, and rewrite plans, so a session that mattered can be gone a month later. A capture
rule copies files out to a folder the reader controls.

```toml
# collection.toml
[[capture]]
from = "~/.claude/projects/**/*.jsonl"
to = "~/Notes/sessions"

[[capture]]
from = "~/.claude/plans/*.md"
to = "~/Notes/plans"
```

**Behaviour.**

- While Marxy runs, and once at launch to catch up, a file matching `from` that is new or has grown
  is copied to `to`, keeping its path relative to the first fixed folder in `from`.
- Copies are **byte-exact**. Marxy never converts, renames, annotates or adds metadata.
- **Appended** files are extended in place in `to` only if the copy is still an exact prefix of the
  source. If the copy has diverged (the reader edited it), the new version is written beside it as
  `name (2).ext`, never over it.
- **Regenerated** files replace the copy only if the copy still equals the last bytes Marxy
  captured, so a reader's edit in `to` is never lost. History of regenerated files is out of scope:
  a reader who wants it puts `to` under git.
- Nothing is ever deleted in `to`, and nothing is ever written in `from`. The point is that the copy
  outlives the source.
- The `to` folder joins the collection automatically, so captured files are in the palette and
  appear in the sidebar.
- Nothing leaves the machine. The privacy line (commitment 2) names the whole action: "Marxy copies
  files matching your capture rules from `from` to `to` on this disk, while it is running."

**Why it needed an ADR** ([ADR-0063](../../adr/0063-capture-rules.md), accepted). Commitment 3 says Marxy changes only the bytes the reader asked to change
and keeps its own state apart from the reader's documents. A capture rule writes reader documents
with no action per write. The argument for it: the rule is the reader's explicit, standing request,
written in their own file. The writes are append-only copies, never edits of an existing document,
and every failure leaves the source untouched. That argument is the author's to accept
([README](README.md#what-the-author-must-decide)). Without it, everything else on this page still
stands: reading in place needs no new permission.

## The transcript view

A JSONL session log is mostly not conversation (the research counted 503 of 941 lines in one session
file). The derived Read view follows `reader-artifacts/10-spec.md` and proposal P10:

- Each turn is a row with an outdented label (*you*, *agent*, *tool*) in small capitals at the
  transcript profile's measure. The speaker is never carried by colour.
- A tool call is one line at rest: the tool's name and the size of its output. It unfolds on Enter,
  bounded to a first and last few lines with the omitted count as text. The bound is a judgement,
  set by a taste review.
- Thinking blocks are behind a click.
- Every row keeps provenance to its JSONL line, so *jump to source* lands on the line, and copying a
  turn copies its text.
- Session metadata in the log (ids, model, cost, timestamps per event) is not shown. The file is
  still exactly what Source shows, one key away.

The derived view needs an AST decision (a node per line, with provenance to the line's bytes, and
a derived text that is not a substring of the buffer): ADR-0061, written in Phase K.
