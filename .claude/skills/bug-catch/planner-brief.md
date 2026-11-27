# Planner brief (template)

The axis planner proposes a hunt's axes; the orchestrator decides them. Send it as one agent,
`model: "opus"`, effort medium, read-only, before any catcher. Fill the `<...>`, keep the filled copy in
`briefs/planner.md`, and send the whole text below the line as the prompt. For round 2 and later, add the
**Last round** paragraph.

---

You plan the axes of a bug hunt in Marxy, a Tauri 2 desktop reader for local files. An axis is one way of
slicing the app or the question so that one catcher looks somewhere the others do not. Each axis becomes one
Sonnet catcher with about 80 tool calls, and every finding it makes costs a verifier's time, so a good axis
finds bugs no other axis would, and few false ones. You read the tree; the only file you write is `axes.md`.

**Where.** The worktree `<absolute worktree path>`. Read `AGENTS.md`, then
`.claude/skills/bug-catch/format.md` ("Axes" says the exact format of `axes.md`).

**The hunt's goal.** <the owner's words, the reports, or "the bugs a reader meets first">.

**Derive the axes from what exists; do not brainstorm generic ones.** Read these, in this order:
1. **Past bugs.** Every earlier hunt in `work/runs/*-hunt-*/`: `findings.md`, `verification.md`, `triage.md`,
   and its README's yield table and "For the next hunt". Group the confirmed findings by cause (a whole-file
   parse per panel, an `await` on a paint, a spread into call arguments, two copies of one helper). Each
   cause that could live elsewhere is a `pattern` axis: "find other places with this cause". Bugs cluster;
   this is the richest source.
2. **Invariants.** Every "never", "always" and "must" in `AGENTS.md`, `docs/principles.md`,
   `docs/architecture.md`, `docs/big-files.md` and `docs/using-marxy.md`. Each one a test could break is an
   `invariant` axis: "assume this rule is broken; find the path".
3. **Promises.** `docs/using-marxy.md` and `docs/file-kinds.md` against the code: a `spec` axis asks for
   every promise the code does not keep in one area.
4. **Shapes and environments.** What the app is exposed to across domains: size, one long line, empty or
   tiny files, encodings and BOMs, rapid repeated keys, two opens at once, sleep and resume, WebKit against
   Chromium, Windows-only paths. Each is a `shape` or `environment` axis.
5. **Structure.** The domain table in `.claude/skills/bug-catch/SKILL.md`, and `git log --since=<date of
   the last hunt> --stat origin/main` for what changed since. A `domain` axis is the fallback for an area
   that changed a lot and that no other axis covers.

**Rank and cut.** Propose at most <12> axes for this round. Rank by expected bugs that only this axis
would find, times severity, divided by cost. Two axes whose catchers would read the same files for the same
reason are one axis. Leave out what is already known: `work/todo.md` and <known lists in briefs/>.
Below the axes, list in a few lines the candidates you cut and why.

**Each axis** is a block in `work/runs/<date>-hunt-<nn>/axes.md`, in the format `format.md` gives: a
prefix of two to four capital letters that no axis already in `axes.md` uses and that is not `OWN`, a name, its round, type, source (the bug ids, doc lines or log
entries it comes from), a lens of one to three sentences written as an order to a catcher ("Assume ... ;
find ..."), the files it starts in, and the model. The lens is the point of the axis: say what to look
for, not "find bugs in X".

**Model.** `sonnet` for every axis, unless the axis is a `pattern` whose cause a search can find (a
literal call or shape `rg` matches) and the cause's earlier findings were all confirmed: then `haiku` may
be proposed, with the pattern to search for.

<**Last round.** The yield table of round <n-1> is below. Extend what found bugs alone: a narrower scope,
the same cause in a sibling area, the invariant from another side. Drop axes that found nothing alone, and
do not propose an axis whose lens repeats a dropped one in other words. List under "Converged" the areas
two or more axes covered and found clean: they go to a stronger model or to the real window, not to another
cheap round.
<yield table>>

**Final report** (under 150 words): the prefixes and names in rank order, one line on what sources gave
the most axes, and anything you could not read.
