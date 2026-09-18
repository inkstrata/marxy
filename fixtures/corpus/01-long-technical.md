# Stack evaluation

**Status:** **OPEN — not decided** · **Last updated:** 2026-09-17

Three weighted passes, one reversal, one user override, and a scope change
that moved the numbers a third time. All of it is recorded because a
decision log that keeps only the winning argument cannot be audited later.

**The question is explicitly open.** Pass 3 puts Tauri ahead by 15 points,
which now agrees with the stated lean rather than contradicting it — but
that margin comes from weights that are judgements, and the three passes
disagree with each other. The framework near the end of this document is
more useful than any of the totals.

---

## Method

Metrics weighted to sum to 100, candidates scored 1–5 per metric,
weighted total normalised out of 100 (a perfect score being 5 across the
board).

The important property of this method, discovered rather than designed:
**the weights decide the outcome, not the candidates.** The weights encode
judgements about priorities, so the exercise is really a way of making
those judgements explicit and arguable. If the brief changes, the scores
must be recomputed rather than assumed.

---



## Pass 1 — original brief

Brief: reading-only, no editing, platforms undecided, theming not
mentioned, license open.


| Metric                    | Weight | Tauri | Electron | Swift |
| ------------------------- | ------ | ----- | -------- | ----- |
| Typographic ceiling       | 25     | 4     | 3        | 5     |
| Rich content ecosystem    | 20     | 4     | 5        | 2     |
| Design iteration velocity | 20     | 3     | 5        | 3     |
| Startup + perceived speed | 15     | 4     | 2        | 5     |
| Cross-platform parity     | 10     | 2     | 5        | 1     |
| Footprint / distribution  | 10     | 5     | 1        | 5     |


**Result: Tauri 74, Electron 73, Swift 72.**

Under a macOS-first variant (parity weight moved to typographic ceiling):
**Swift 80, Tauri 78, Electron 69.**

**Conclusion at the time:** a one-point spread means the framework is not
the deciding factor and the choice should be made on team fit. The
platform question, however, *was* the stack question wearing a different
hat — macOS-first dropped Electron decisively.

---



## Pass 2 — revised brief

Brief gained: Typora-style live-render editing, macOS-first with **Linux
mandatory**, **user CSS first-class**, free and open source.

Two metrics are new. Cross-platform parity rose from 10 to 15 because
Linux moved from optional to promised.


| Metric                                           | Weight | Tauri | Electron | Swift |
| ------------------------------------------------ | ------ | ----- | -------- | ----- |
| Typographic quality across all shipped platforms | 20     | 2     | 4        | 5     |
| User CSS theming as a shipped feature *(new)*    | 15     | 5     | 5        | 1     |
| Live-render editing feasibility *(new)*          | 15     | 3     | 5        | 2     |
| Three-platform parity, Linux included            | 15     | 2     | 5        | 1     |
| Startup and perceived speed                      | 13     | 4     | 2        | 5     |
| Rich content ecosystem                           | 12     | 4     | 5        | 2     |
| Footprint and solo-maintainer cost               | 10     | 4     | 2        | 3     |


**Result: Electron 82, Tauri 66, Swift 56.**

### Why it reversed

Three specific additions, each independently significant:

1. **Linux became mandatory.** Under Tauri that means WebKitGTK, which has
  an open defect rasterizing text ~100 weight units heavier than specified
   (`tauri-apps/tauri#14286`), and whose usual remedy is a macOS-only CSS
   property. For an application whose thesis is typographic quality, on a
   platform now promised, this is close to disqualifying. It is why the
   first metric's Tauri score dropped from 4 to 2 — the metric changed from
   measuring the *ceiling* to measuring the *floor across shipped
   platforms*.
2. **Live-render editing entered scope.** `contenteditable`, `Selection`,
  `Range` and IME composition are the most engine-divergent surfaces on
   the web platform, and Compose mode sits on all four. One engine
   everywhere is worth a great deal here.
3. **User CSS became a feature.** Engine inconsistency stopped being only
  the maintainer's problem and became the theme authors' problem, on an
   engine whose version ships with the user's distribution.

Remove any one and the gap narrows sharply. Remove Linux and editing both,
and Tauri wins again.

Swift's collapse is simpler: first-class user CSS requires a real CSS
engine, and Linux support is impossible for a macOS-native toolkit. Ruled
out rather than merely outscored.

---



## Pass 3 — pared brief

Brief v3 changed the inputs materially in both directions, which is why
this pass exists rather than an annotation on Pass 2.

**Removed:** Typora-style live-render editing. This deletes an entire
metric — the one on which Electron scored 5 and Tauri 3 — along with the
`contenteditable`, `Selection`, `Range` and IME divergence that justified
it. Editing is now plain text in CodeMirror plus source transformations
(`05-view-modes.md`, `18-document-operations.md`), which is uncontroversial
on every engine.

**Added:** a fast indexed document opener with instant switching, file
watching over indexed roots, and code observation as a first-class use
case (`19-navigation-and-index.md`). These are Rust's strongest suit —
`nucleo`, `tantivy`, `notify`, `ignore`, `tree-sitter` — and they turn
startup and footprint from qualities into stated product claims.

**Softened:** the Linux typography gap, judged solvable rather than
disqualifying. This is a user judgement, and it happens to be the single
most consequential number in the whole exercise.

| Metric | Weight | Tauri | Electron |
| --- | --- | --- | --- |
| Startup and perceived speed *(now a product claim)* | 20 | 4 | 2 |
| Typographic quality across shipped platforms | 18 | 3 | 4 |
| Indexing, search and file watching | 15 | 5 | 3 |
| User CSS theming as a shipped feature | 12 | 5 | 5 |
| Footprint and lean-OSS fit | 12 | 5 | 2 |
| Rich content ecosystem | 10 | 4 | 5 |
| Three-platform parity, Linux included | 8 | 3 | 5 |
| Plain-text editing feasibility | 5 | 4 | 5 |

**Result: Tauri 81, Electron 66.**

### Why it reversed back

Not because anything was learned about the frameworks. Three inputs
changed:

1. **Live-render editing left scope**, deleting Electron's strongest
   remaining metric. Plain-text CodeMirror works everywhere; a decorated
   `contenteditable` surface does not.
2. **Speed and footprint became promises**, not preferences. "A very fast
   document opener" as a headline claim justifies a much higher weight
   than the 15 it carried in Pass 1 — and this is the axis where the gap
   is largest and best evidenced.
3. **Indexing and watching entered scope**, and this is the first
   requirement where Rust is *genuinely* the better tool rather than
   merely a defensible one.

The Linux weight drop from 15 to 8 also matters, and it should be flagged
as the softest input in the model: it rests on a judgement that the
WebKitGTK font-weight defect is solvable, which is untested.

**The honest summary of all three passes:** the framework never changed,
the brief did, and each time the brief changed the answer changed with it.
That is a property of the method working, but it is also a warning that a
fourth brief revision would move the answer again.

---

## Where the question stands

The stated lean is *"swift is out, leaning toward tauri,"* and the user has
since confirmed the question remains open. Pass 3 now supports the lean
rather than contradicting it, which is a meaningfully different situation
from Pass 2 — the direction and the analysis agree for the first time.

The reasons for Tauri that are real regardless of weighting:

- Roughly 19 MB against 190 MB for a comparable markdown application
- Idle memory of roughly 42–109 MB against 128–186 MB
- Rust's indexing, matching and watching crates — the one place where the
  better tool is not merely defensible but obvious
- A footprint that fits a lean open-source ethos far better than shipping
a browser
- A declarative capability and CSP model that aligns with the security
posture in `09-theming-contract.md`
- A Rust core that naturally produces the separable parse-and-render
library the publishing-platform ambition wants

**Startup is deliberately absent from that list.** Most sources put Tauri
far ahead, but they compare different applications; the one source that
built the *same* application found Electron faster. It is a reason to
measure, not a reason to choose.

The weights are judgements, not facts. Weighting footprint at 10 rather
than 25 was a choice, and someone building a lean open-source tool for
people who care about such things could reasonably weight it far higher.

### What must be true for this to be right

Recorded so it stays checkable. These are hypotheses to test in the first
two weeks, not assumptions.


| #   | Hypothesis                                                                                                   | How to test                                                                           | Load-bearing? |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------- |
| 1   | The WebKitGTK weight offset is fully compensable with bundled variable fonts plus a per-platform offset      | The three-way experiment in `06-typography-engine-findings.md`, on real distributions | **Yes**       |
| 2   | Owning line breaking neutralises the remaining rag and hyphenation divergence                                | Same experiment                                                                       | **Yes**       |
| 3   | Theme authors can work against a published CSS baseline without unbounded support burden                     | Cannot be tested early; watch it                                                      | No            |
| 4   | CodeMirror 6 in **plain-text** mode behaves identically enough across all three engines | Open a large file in CM6 on WebKitGTK; check selection, IME, scroll perf | No — much weaker risk than the Compose version of this hypothesis |
| 5   | Three-engine screenshot-diff CI is affordable to build and maintain solo                                     | Build it in week one and see                                                          | No            |
| 6   | The index, watcher and fuzzy matcher are genuinely better in Rust than the Node equivalents *at marxy's scale* | Index a real monorepo both ways; measure query latency and watcher fidelity | **Yes** — this is now a primary reason for choosing Tauri |
| 7   | Startup on the target machine actually favours Tauri, despite the one same-app benchmark finding the opposite | Build the same minimal shell in both; measure cold and warm start | **Yes** — it is now a headline product claim |


**The load-bearing set changed with brief v3.** Hypothesis 4 dropped from
load-bearing to minor, because plain-text CodeMirror is far less
engine-sensitive than a decorated `contenteditable` surface. In its place,
6 and 7 became load-bearing, because the pared brief promotes indexing and
startup speed from qualities to claims.

**Revisit the direction if two or more of 1, 2, 6 and 7 fail.** Note the
shape of that rule: 1 and 2 are about typography, 6 and 7 about speed. If
Tauri fails on typography it fails at the thesis; if it fails on speed it
fails at the headline feature. Either pair failing is sufficient.

### What makes revisiting cheap

The frontend is portable between Tauri and Electron — same framework, same
CSS, same libraries. Only the privileged-operation boundary differs.
Keeping file access, watching, and dialogs behind a **thin, well-defined
interface** — a handful of functions, not scattered `invoke()` calls — makes
a later switch a matter of reimplementing that interface. Worth doing
regardless of intent.

---

## How to actually settle this

The question has now survived three weighted analyses without closing,
which is evidence that **more analysis will not close it.** The weights
decide the outcome, the weights are judgements, and the brief keeps
changing. A fourth pass would produce a fourth number.

What would close it is a small amount of code. Two or three days, and it
answers the load-bearing hypotheses directly rather than by proxy.

### The spike

Build the same throwaway shell twice, in Tauri and in Electron:

1. Open a markdown file passed as an argument, render it, no styling.
2. Set one paragraph with `justif` and screenshot it on macOS and on a real
   Linux distribution's WebKitGTK.
3. Open a large file in CodeMirror 6 in plain-text mode; scroll it.
4. Index a few thousand files, then fuzzy-search them with a keystroke
   latency measurement.
5. Measure cold start and warm start on the actual target machine.

Steps 2 and 5 are the whole exercise. Step 2 answers hypotheses 1 and 2 —
whether the WebKitGTK weight defect is compensable, which is the only real
argument against Tauri now that editing has left scope. Step 5 answers
hypothesis 7, and it matters because the one same-application benchmark in
existence found Electron *faster*.

### The decision rule, stated in advance

Committing to a rule before seeing results is the point; it is what stops
the outcome being rationalised either way.

| Outcome of the spike | Choose |
| --- | --- |
| WebKitGTK text is compensable **and** Tauri's startup advantage is real on the target machine | **Tauri.** Both objections dissolve and Pass 3's margin stands |
| WebKitGTK text is compensable but startup is a wash | **Tauri**, on footprint and the Rust index — but drop "very fast opener" as a marketing claim, or solve it with a resident process instead |
| WebKitGTK text is not compensable | **Electron.** The typography thesis outranks everything else in the brief, and a reader that sets text badly on a promised platform is not the product |
| Startup and indexing both disappoint under Tauri | **Electron**, and reconsider whether the pared brief's speed claims are achievable at all |

Note that only one row is genuinely bad for Tauri, and it is the row that
depends on a defect in someone else's software. That is worth knowing
before starting: **the risk is concentrated in one testable place.**

### What to do regardless of the answer

Because the frontend is portable between the two, most of the work is not
blocked on this decision:

- The typesetting path, the theme contract, and the operations catalogue
  are pure frontend. None of them care.
- The privileged-operation interface should be thin either way.
- The parse-and-render pipeline should be a library with no dependency on
  the shell, which the publishing ambition wants anyway.

**So the stack question does not block starting.** It blocks distribution
and it blocks the speed claims, but the reading experience — the part that
is actually hard and actually differentiating — can be built before the
answer arrives. That is the most useful thing in this document.

---



## Measured data behind the scores

**All figures from published 2026 benchmarks that disagree substantially.
Ratios are the stable signal; absolutes are not. Re-measure on target
hardware.**

### Bundle size


| App class                             | Tauri 2     | Electron   | Source                |
| ------------------------------------- | ----------- | ---------- | --------------------- |
| Hello world                           | 14.2 MB     | 187 MB     | johal.in              |
| **Markdown editor with highlighting** | **18.7 MB** | **192 MB** | johal.in              |
| SQL GUI                               | 29.5 MB     | 215 MB     | johal.in              |
| Hello world                           | 2.5–3.2 MB  | 85 MB      | tech-insider, youngju |
| Medium (editor, chat)                 | 8–15 MB     | 120–160 MB | youngju               |
| Heavy (IDE-class)                     | 25–40 MB    | 180–250 MB | youngju               |
| Screen recorder (independent build)   | 57 MB       | 323 MB     | Better Stack          |


The markdown-editor row is the directly relevant one. Note the spread
between sources on identical app classes — an order of magnitude for Tauri.

### Memory


| Condition                | Tauri 2 | Electron   | Source                 |
| ------------------------ | ------- | ---------- | ---------------------- |
| Idle, single window      | 42 MB   | 168–186 MB | tech-insider, johal.in |
| Idle (independent build) | 109 MB  | 128 MB     | Better Stack           |
| Six windows              | 172 MB  | 409 MB     | tech-insider, gethopp  |


The Better Stack figures — a much narrower gap — come from the only source
that built the same non-trivial application in every framework. Weight
accordingly.

### Startup


| Condition            | Tauri 2     | Electron   | Source                |
| -------------------- | ----------- | ---------- | --------------------- |
| Cold, minimal        | 0.15–0.38 s | 0.8–1.5 s  | youngju, tech-insider |
| Cold, medium         | 0.4–0.9 s   | 1.5–3.0 s  | youngju               |
| Controlled, same app | **311 ms**  | **273 ms** | Better Stack          |


**The last row is important and contradicts the rest.** In the only
same-application comparison, Electron started *faster*, because Tauri still
waits for the system webview to initialise. The author called it a
surprise. Do not treat Tauri's startup advantage as guaranteed.

### Build times


|             | Tauri 2   | Electron  | Source                 |
| ----------- | --------- | --------- | ---------------------- |
| Initial     | 12–48 s   | 8–22 s    | johal.in, tech-insider |
| Incremental | 2.0–3.5 s | 2.1–3.0 s | same                   |


Incremental is close enough not to matter. Initial favours Electron. This
taxes design iteration specifically, which matters more than usual for an
aesthetics-led project — mitigated if the typography layer is pure
frontend, which it should be.

### Other


| Metric                | Tauri 2                 | Electron             |
| --------------------- | ----------------------- | -------------------- |
| IPC round trip        | 0.12 ms                 | 0.45 ms              |
| CPU idle              | <0.5%                   | 1–5%                 |
| Rendering consistency | Different engine per OS | Identical everywhere |
| Mobile                | iOS + Android           | None                 |


Mobile is out of scope, but worth noting Tauri would make it possible
later where Electron never could.

---



## Candidates not evaluated


| Candidate         | Why not                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GTK / Qt**      | No typographic ceiling above the webview options, and more expensive than both. Would also require implementing CSS theming                                                   |
| **Flutter**       | Its own text stack fights you on exactly the features that matter, and custom line breaking would mean working against the framework                                          |
| **Deno Desktop**  | Interesting — 242 ms startup and 98 MB idle in the Better Stack test, the best of the four — but immature, and the ecosystem risk is unacceptable for a project meant to last |
| **Electrobun**    | Worst on every measured axis (418 MB, 773 ms, 208 MB) and described as difficult to work with                                                                                 |
| **Servo / Verso** | Genuinely aligned with the typography ambition long-term. Nowhere near ready                                                                                                  |


Deno Desktop is the one worth re-checking in a year.