# Reading tasks and the evidence

*A reader of READMEs, agent transcripts, logs, diffs, source and config is rarely reading in the novel-reader's sense. It skims, verifies, locates, copies and compares. This chapter defines those five tasks, grades what published evidence says about each, maps them onto the artifact types Marxy opens, and ends with a matrix of which presentation affordances serve which task. The short version: the evidence about how people read code is real but narrow (small eye-tracking studies of short snippets), the evidence about reading agent output and logs is close to absent, and almost every presentation choice for these artifacts therefore rests on convention. Where that is so, the chapter says so and grades it [D].*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## 1. Five tasks

The tasks are defined by what the reader is trying to *get out of* the page, not by the artifact. The same diff is skimmed at breakfast and verified before a merge.

| Task | The reader is trying to… | Success looks like | Failure looks like |
| --- | --- | --- | --- |
| **Skim** | decide in seconds whether, and where, to read | the right section found, the rest skipped without guilt | reading everything, or missing the one paragraph that mattered |
| **Verify** | decide whether the content is *true, safe or done* | a wrong claim caught; a correct one accepted without a full re-derivation | over-trust (approving what was wrong) or under-trust (redoing the work) |
| **Locate** | find a known thing: a line, a symbol, an error, a value | arrive at it, and know where it sits in the whole | scanning linearly; losing position after a jump |
| **Copy exactly** | move bytes out of the page into a terminal, an editor, an agent | the pasted text is the authored text | a silent substitution: an en dash for `--`, a curly quote, a prompt character, an invisible mark |
| **Compare** | see what differs between two states, or two like things | the difference and only the difference | reading two full texts side by side; misaligned rows |

Three of these (skim, verify, locate) are cognitive and can in principle be studied with readers. Two (copy exactly, compare) are largely about *fidelity* and *alignment*, where the right answer is often an engineering fact rather than a finding. That split matters below: the evidence sections are about the cognitive tasks; the copy section is mostly a list of things that go wrong.

### Tasks across artifact types

Each cell names the dominant task first. The first two columns are the priority content types in the [product brief](../../brief.md); the rest are what those documents keep containing.

| Artifact | Primary task | Also | What the reader is hunting for |
| --- | --- | --- | --- |
| README | skim | copy exactly, locate | install command, one usage example, which section applies to me |
| Plan / todo list (AI or human) | skim | verify, locate | what is done, what is next, what changed since last time |
| Agent transcript and tool output | verify | skim, locate | the step where it went wrong; what it actually ran; what it claimed vs what happened |
| Logs and terminal output | locate | skim, copy exactly | the first error, the timestamp, the request id |
| Diff | compare | verify | what changed, and whether it is safe |
| Source code | locate | verify, copy exactly | a definition, a caller, why this branch exists |
| JSON / YAML / config | locate | verify, copy exactly | one key's value; whether the shape is what was intended |

> **Trap.** Treating the artifact as the unit of design ("a code block", "a diff") instead of the task. A code block in a README is copied; the same block in a transcript is verified; in a source file it is located within. The presentation that serves one can be wrong for another, and Marxy usually cannot know which task the reader is on. Prefer affordances that are summoned by the task (find, section copy, outline) over per-artifact chrome.

## 2. How code is read (and what that does and does not license)

Almost all published eye-tracking work on reading code concerns *short snippets read on a screen, in an experiment*, with tens of participants, and usually students. That is the evidence base for every claim in this section, and it bounds what can be said.

**Code is not read like prose.** Crosby and Stelovsky (1990) had programmers at two experience levels read a short Pascal algorithm and found that everyone needed many fixations across most areas and spent longer on the relevant regions than readers of simple prose in earlier studies, supporting the hypothesis that viewing strategies for algorithms differ from those for prose **[C]**.[^crosby] Busjahn and colleagues (2015) formalised the idea with gaze-based linearity measures: novices read code less linearly than natural-language text, and experts read code less linearly than novices **[C]**.[^busjahn] Peitek, Siegmund and Apel (2020) replicated the comparison with 12 novice and 19 intermediate programmers, re-running Busjahn and colleagues and a study by Peacock and colleagues, and complicated it: the linearity *of the code itself* had an even stronger effect on reading order than experience **[C]**, and they conclude that studies must choose snippets carefully to control it.[^peitek20] Together these support one modest conclusion: readers of code jump, and how much depends on the code. They say nothing about which presentation helps them jump.

**A first sweep, then focus.** Uwano and colleagues (2006) had five reviewers look at six programs of 12 to 23 lines; 72.8 per cent of lines were looked at in the first 30 per cent of review time, and reviewers whose first scan was short took longer to find the defect **[C]**.[^uwano] Sharif, Falcone and Maletic (2012) partially replicated this and report that scan time correlates with defect-detection time and with visual effort on the defect lines **[C]**; the pair together is small-sample and short-program evidence.[^sharif12] The reading of a whole page before a close read is what a reader of a long artifact does too, which is the argument for an outline and for headings that survive a fast first pass. It is an argument by analogy.

**Where the eyes go inside a method is not settled.** Rodeghero and colleagues (2014) studied ten Java programmers summarising methods and used their gaze pattern to build a summariser; the result usually repeated from it, and attributed to it by Abid and colleagues (I did not read Rodeghero's own account of it), is that programmers attend to method signatures.[^rodeghero] Abid and colleagues (2019) ran a follow-up on the task, not a like-for-like replication, with 18 developers on 63 methods in a real IDE where they could scroll and switch files, and report the opposite emphasis: more time on the method body than the signature, frequent revisits of control-flow terms, and substantial gaze on call terms. The signature claim is therefore contested by one larger study under different conditions, not settled against **[X]**.[^abid] The difference is attributed to the original showing short methods in isolation as images. The general lesson is that lab presentations change the reading, so any finding taken from a study that displayed code as a cropped image should be discounted for a reader that scrolls.

**What developers spend time on.** Xia and colleagues (2018) instrumented the computers of 78 professionals on seven projects (3,148 working hours) and report that developers spent roughly 58 per cent of their time on program-comprehension activities **[C]** (field study; comprehension is inferred from activity classification, not observed).[^xia] It justifies attention to reading; it is not evidence about any design.

**Foraging.** Ko and colleagues (2006) gave developers an unfamiliar program for 70 minutes and found they interleaved searching, following dependencies and collecting; searches were based on limited and misleading cues, often failing **[C]**.[^ko06] Lawrance and colleagues (2013) treat navigation while debugging as following *information scent* and study ten professionals **[C]**.[^lawrance] The useful implication for a reader is that a reader locating something leans on cheap cues (names, headings, structure), and that a cue which misleads costs a failed search. Neither study tested a display.

**Surveys.** A 2018 ACM Computing Surveys review by Obaidellah, Al Haek and Cheng covers the eye-tracking-in-programming literature; I confirmed its existence and scope from a search listing only and take no numbers from it.[^obaidellah] The reader who wants the methods and their pitfalls should start there.

> **Marxy today.** Nothing in Marxy depends on these studies; they are context. Where the chapters that follow lean on one, the dependence is stated and graded. **No study reviewed found an effect of typography, line length, wrapping or width on code reading.** The layout of code in Marxy is therefore governed by the sibling handbook's [Code](../reader-typography/06-code.md) chapter and by [Code as read](04-code-typography.md), and remains largely convention.

### Syntax highlighting: one paragraph

The sibling's [Code](../reader-typography/06-code.md) chapter tabulates four studies (Sarkar 2015, Hakala and colleagues 2006, Beelders and du Plessis 2016, Hannebauer and colleagues 2018) and concludes that highlighting is liked, may speed reading of short code slightly, and does not measurably improve understanding **[C]**. One later study appears to be missing from that table: Brown, Kölling and Weill-Tessier (ICER 2023) compared plain Java, Java with BlueJ scope highlighting (background styling) and the frame-based Stride with 62 novices, and report differences in gaze behaviour but none in correctness or speed **[C]** (abstract only).[^icer23] It agrees with the sibling's conclusion. Marxy's restrained palette (strings, numbers, comments, function and tag names) is thus defensible as a cost-limited choice, not as a proven aid.

## 3. Skim

**Readers satisfice.** Duggan and Payne (2011) tracked eyes during timed skimming and report that readers direct attention to the more important content and get through a text by reading until the rate of information gain falls below a threshold, then moving on **[C]**. That paper is a new analysis of the eye data from their 2009 experiments, so the two are one dataset, not two studies. The 2009 experiments report that, against reading half the text, skimming improved memory for important ideas but not for detail or inference; skimming had no advantage over reading the first or second half of every paragraph; and in a website-like layout the skimming advantage depended on how easily readers could navigate **[C]** (expository prose, under time pressure, laboratory tasks; downgraded from [B] because the task and material are far from a README).[^dp11][^dp09] It is the best evidence that a reader's skim is a *decision procedure over structure*: headings, first lines and the visible "gain" of a paragraph.

**Signals.** Lorch's 1989 review of signalling devices (titles, headings, previews, overviews, summaries, typographical cues) concludes that virtually all types of signal improve memory for the information they cue, while memory for unsignalled information is often unaffected **[C]** (a 1989 review, abstract only, of prose memory studies); the review itself notes little work on attention and basic reading processes.[^lorch] For a reader app the reading is: headings and emphasis help you remember what they mark, and cost nothing to what they don't. That is a modest argument for a strong heading hierarchy and outline, and an argument *against* asking headings to carry every reader's need equally.

**The F-pattern.** Nielsen's 2006 eye-tracking report (232 users, thousands of web pages) described an F-shaped scan of web pages **[D]**. It is practitioner research: not peer reviewed, about web pages not documents, and the author himself calls the shape a rough general one with E and inverted-L variants.[^nng] It supports "front-load lines and keep left edges informative" as a habit; it does not support a claim about READMEs or code, and it should not be cited as though it did.[^nng]

> **Default.** Make skimming a property of structure, not chrome: a clear heading hierarchy that survives at a glance (the type scale in [Design language](../../design-language.md)), first-line-informative list items, and a summoned outline (`Mod+Shift+O`) for the fast first sweep. Do not add a per-section toolbar. **[D]** (rests on Lorch and Duggan and Payne, both **[C]** prose studies; nothing tests these on READMEs or transcripts).
>
> **Operation.** `copy-section` (shipped; `string → clipboard`, section) is the skimmer's exit: it takes what was found. A v1.1 candidate `extract-tasks` (`string → clipboard`, document) answers "what is left to do" without reading a plan. **[D]**
>
> **Marxy today.** The outline exists; every heading carries `data-marxy-s/e` provenance (goldens, e.g. `packages/core/goldens/18-agent-transcript.html.txt`). Task-list items render as disabled checkboxes (`03-ai-plan.html.txt`), so a plan's state is visible on a skim; toggling is the shipped `toggle-task` operation.

## 4. Verify

Verification is the task least studied in a form that resembles Marxy's reader, and the studies that exist concern *authoring* with an assistant, not reading its finished output.

- **Barke, James and Polikarpova** (2022; OOPSLA 2023) observed 20 programmers using Copilot and report two modes, *acceleration* (the programmer knows what to do and uses the tool to go faster) and *exploration* (unsure how to proceed and exploring options) **[C]** (grounded-theory; abstract only).[^barke] Verification differs between them: acceleration is a quick accept/reject, exploration is a search.
- **Vaithilingam, Zhang and Glassman** (CHI EA 2022) ran a within-subjects study with 24 participants: Copilot did not necessarily improve completion time or success rate, but most participants preferred it **[C]** (abstract only).[^vaith] Preference is not evidence of correct verification.
- **Mozannar and colleagues** (CHI 2024) had 21 programmers label their sessions and built a taxonomy of activities (CUPS) that exposes where time goes, including checking suggestions **[C]** (abstract only; I have not verified the per-activity figures that circulate, so none are used here).[^mozannar]
- **Liang, Yang and Myers** (ICSE 2024) surveyed 410 developers: the main barrier to use is output that does not meet functional or non-functional requirements, and difficulty steering the tool **[C]** (survey; self-report; abstract only).[^liang]
- **Epperson and colleagues** (CHI 2025) interviewed five developers building multi-agent systems and identified "difficulty reviewing long agent conversations to localize errors" as a core problem, then built AGDebugger and tested it with 14 participants **[C]** (abstract only; the interface built is about editing and resetting messages, not typography).[^agdebugger] It is the closest published statement of Marxy's transcript problem, and it is a *statement of the problem*, not a test of a reading design.
- **Agentic pull requests.** Duma and colleagues (EASE 2026) analysed the AIDev dataset and report that most AI-generated PRs receive no review and that where they do, review more often takes the form of automation-mediated interaction; they warn that review metrics may not reliably indicate human oversight **[C]** (mining study; abstract only, which gives no percentage and does not define "review" or say "human": the figure and definition are in the paper body, which I did not read).[^duma] It suggests, subject to that warning, that PRs often go unreviewed. A reader that makes verifying cheap is fighting that default.
- **Bacchelli and Bird** (ICSE 2013), at Microsoft: review is less about finding defects than expected and more about knowledge transfer, awareness and alternative solutions **[C]**.[^bb13] [Diffs and provenance](05-diffs-provenance.md) goes deeper on review; the relevance here is that "verify" is often really "understand".

**What the evidence does not say.** No study found tests how presentation (collapsing tool output, showing the command separately from its result, marking claim versus evidence) changes whether a reader catches a wrong step in an agent transcript. The recommendations in [Agent artifacts](02-agent-artifacts.md) are therefore convention **[D]**. The claim most at risk of over-reading in this area is that "developers over-trust AI output": none of the abstracts read for this chapter measures over-trust in reading a finished artifact.

> **Default.** A reader of a transcript must be able to tell three things apart at a glance: what was *said*, what was *run*, and what was *returned*. Show all three in the flow without hiding any; never collapse content by default; a hidden step is an unverified step. **[D]** (converged; supported by AGDebugger's problem statement **[C]**, not by any test of a design).
>
> **Operation.** `copy-code-clean` (shipped) copies the command, not the fence. Candidates: `extract-code-blocks` (`string → clipboard`, document) to lift every command a transcript ran into one paste; `copy-as-plain-text` resolved through provenance, not DOM text (see section 8). **[D]**
>
> **Marxy today.** Fenced tool output and prose interleave as ordinary blocks (`fixtures/corpus/18-agent-transcript.md`); nothing distinguishes a command from its result other than the fence's info string, and `<details>` renders *open* because the sanitiser treats it as transparent (ADR-0009), so a transcript's own collapsing is lost. Whether that is a defect is a taste question; it is recorded, not resolved here.

## 5. Locate

Locating is the task with the most persuasive folk evidence and the least direct.

**File and line references.** Schröter, Bettenburg and Premraj (MSR 2010) studied stack-trace use in Eclipse bug reports and report evidence that developers use stack traces to support debugging **[C]** (abstract only; I did not verify any further detail, such as where in a trace fixes cluster).[^schroter] It supports one thing: a reference that names a file and a line is a working retrieval cue in practice. It does not test whether a *gutter of line numbers* helps.

**Line numbers.** I searched for a study of whether visible line numbers change how quickly readers find or return to a place in code, or in text, and found none. Line numbers are convention **[D]**; their practical value is that they are the shared coordinate between a reader and a compiler, a stack trace, a review comment and a colleague ("see line 40"). Marxy's Source mode has a line-numbers option that is currently off: `apps/desktop/src/app.ts` (line 117) passes `lineNumbers: false`, overriding the editor wrapper's default of on (`apps/desktop/src/source/editor-cm6.ts`). Rendered mode has none.

**Following the scent.** Ko and Lawrance (above) suggest that locating in a large body of text depends on the quality of cheap cues. For a rendered document that argues for a working find (`Mod+F`), a working outline and stable anchors; for source, for a symbol outline. None is tested against a control.

**Logs.** Yuan, Park and Zhou (ICSE 2012) characterise how developers *write* log statements in four open-source systems; He and colleagues (ACM Computing Surveys 2021) survey *automated* log analysis (parsing, compression, anomaly detection) **[D for our purposes]**.[^yuan][^he] Neither studies a person reading a log. Barik and colleagues found that developers do read compiler error messages, spending 13 to 25 per cent of task time on them, and that difficulty reading a message predicts task performance **[C]** (56 undergraduate and graduate students in Eclipse; abstract as quoted on the ACM page).[^barik] It is the only study I found in which reading terminal-style diagnostic text is measured, and it concerns compiler messages in an IDE. There is no literature on how humans read logs that I could find; the honest statement is that it is thin to absent. (A citation to a Barik paper at MSR 2016 was given to me as a lead; I could not verify it and it is not used.)

> **Default.** Offer the coordinate without paying for it at rest: in Source mode, line numbers **on** by default (they are the shared coordinate); in Rendered mode, none in the gutter, and instead a summoned "go to line" that resolves through provenance to a rendered position. **[D]**
>
> **Operation.** `copy-line-reference` (`string → clipboard`, block): `path:line` for the selection start, computed from the buffer's line index (`lineOf`, `packages/core/src/buffer/buffer.ts`); useful for the reader pasting a reference into an agent or a review. **[D]**
>
> **Marxy today.** `Mod+Shift+E` opens the external editor at the current block's line (`docs/design/09-app-shell.md`), so the coordinate exists internally; it is not shown or copyable.

## 6. Copy exactly

**What is measured.** Baltes and Diehl (EMSE 2019) studied how Stack Overflow code snippets are used, and how rarely attributed, in public GitHub projects **[B for what it studies]**; Yang and colleagues (MSR 2017) asked whether snippets copied from Stack Overflow appear in real projects and whether the copy is literal or adapted **[C]**.[^baltes][^yang] Both establish that *copying code from a page is a common practice*, which is the fact that matters for a reader. Neither studies copy *errors*.

**What is not measured.** I searched for a study of failures introduced by copying rendered text: smart quotes, en dashes replacing `--`, non-breaking spaces, zero-width characters, prompts (`$ `) pasted into terminals. I found only practitioner posts and issue-tracker reports, which are not evidence of frequency. The mechanism is a fact, not a finding: a curly quote is a different code point from a straight quote, and a shell or parser treats it as ordinary text. This chapter treats the failure as real and unquantified **[D]**.

**Prompts and output.** Whether to strip a leading `$ ` on copy is a convention with no study; tools disagree (some strip, some keep). The safest rule is that a code fence is copied as authored; `copy-code-clean` today keeps any prompt but does append a final newline (see below), which is an addition.

> **Marxy today.** Rendered-mode `Mod+C` (`runCopyShortcut`, `apps/desktop/src/selection/apply.ts`) first runs the first applicable `copy-` operation on a click-selected node, so a selected code block copies through `copy-code-clean` and a selected section through `copy-section`, both from the buffer. Only a *drag* text selection falls through to the text captured from `window.getSelection().toString()` (`selection/view.ts`), i.e. the *smartened DOM text*. Smart typography is a render pass on markdown text nodes (`packages/core/src/render/typography.ts`), so `--frozen-lockfile` in prose renders and copies as `–frozen-lockfile` with an en dash; inline code and fenced code are untouched. The finding, with its probe, is in [Trust and safety](07-trust-safety.md), section 6. The shipped `copy-code-clean` copies the block's parsed value with a final newline appended if missing (`packages/core/src/operations/copy-code-clean.ts`), so a `$ ` prompt inside a fence is copied as written. The buffer is never touched (commitment 4 concerns the file), but the reader asked for the text and received different characters.

> **Default.** Copy is **byte-exact from the buffer**: a selection resolves through provenance to a source range and the clipboard receives those bytes, never the DOM's rendered text. Smart typography remains a display pass only. **[D]** (a design invariant following from commitment 4, not a measurement).
>
> **Operation.** `copy-as-source-text` — `string → clipboard`, span | block | section; replaces the DOM-text default so that Mod+C is provenance-resolved. `copy-command` — `string → clipboard`, block, offered on a fence whose language is `sh`, `bash` or `shell`: the same text with a single leading `$ ` or `> ` prompt stripped per line **only when every non-blank line has one**. It is a *choice the reader makes*, never automatic. **[D]**

## 7. Compare

**The evidence lives in another chapter.** [Diffs and provenance](05-diffs-provenance.md) reviews the literature on diff presentation. Two points matter for the task map. First, the review literature (Bacchelli and Bird above) says people review for understanding as much as for defects, so a diff view is often an *explanation* view. Second, nothing found tests inline against side-by-side against unified presentation of a diff **as a reading task**. The convention **[D]** across tools is that a change is marked by more than colour (a `+`/`-` marker), because red-green alone excludes some readers.

**Compare is not only diff.** Two config files, two tables, two versions of a README, two agent runs: all are comparisons the reader performs *by eye*, with no aid. Marxy is not a diff tool and should not become one; what it can offer is exact text on both sides (section 6) and stable alignment (a monospace, hung continuation, a baseline grid: [Code as read](04-code-typography.md)).

> **Marxy today.** `markup.inserted` and `markup.deleted` (the diff scopes) map to **no** token class (`packages/core/src/highlight/scopes.ts`), so a fenced ```diff block currently shows `+` and `-` lines with no colour distinction. That leaves the marker as the only cue, which is the accessible one, but also an untested one.
>
> **Default.** Keep the `+`/`-` marker as the primary cue; add colour as a secondary cue only with a shape or weight difference. **[D]**
>
> **Operation.** `copy-diff-after` (`string → clipboard`, block): the new side of a unified diff with markers removed. **[D]**

## 8. Which affordances serve which task

Rows are presentation affordances; columns are the five tasks. A cell says how well the affordance serves the task and how sure the evidence makes us. **S** = serves; **h** = helps a little; **–** = does nothing; **x** = can harm. The letter after is the grade. An empty grade means an engineering fact.

| Affordance | Skim | Verify | Locate | Copy exactly | Compare |
| --- | --- | --- | --- | --- | --- |
| Heading hierarchy and outline | S [C, prose] | h [D] | S [D] | – | – |
| Restrained syntax colour | h [C] | h [C] | h [C] | – | h [D] |
| Full syntax colour (many classes) | h [C] | – [C] | – [C] | – | – |
| Line numbers (source) | – | h [D] | S [D] | x if selectable [D] | h [D] |
| Command vs output kept distinct | h [D] | S [D] | S [D] | S [D] | – |
| Collapsed tool output by default | h [D] | x [D] | x [D] | – | – |
| Find (`Mod+F`) | h [D] | S [D] | S [D] | – | – |
| Byte-exact copy from source | – | – | – | S [engineering] | S [D] |
| Smart typography in prose | – | – | – | x [engineering] | – |
| Explicit `+`/`-` markers | – | h [D] | h [D] | – | S [D] |
| Zero chrome at rest | h [D] | – | – | – | – |
| Provenance-resolved operations | – | S [D] | S [D] | S [engineering] | h [D] |

Two readings of the matrix matter. First, *nothing* in the table rests on a study of Marxy's artifact types, and few cells rest on more than one small study. Second, the two cells that carry an engineering certainty (byte-exact copy, smart typography harming copy) are the two where Marxy today does not meet its own commitment for drag selections.

## 9. Claims most at risk of over-reading

1. **"Developers read code non-linearly, so lay it out non-linearly."** Busjahn and Peitek show a modest, code-dependent effect in short snippets, not a design implication.
2. **"Programmers look at method signatures first."** Rodeghero's finding, as restated by Abid, is contested by Abid's larger, more realistic follow-up, which differs in method **[X]**.
3. **"58 per cent of time is spent understanding code."** A field-study classification, not a measure of reading, and not about documents.
4. **"The F-pattern."** Practitioner research about web pages, self-described as rough.
5. **"Headings help skimming."** The evidence is memory for cued content in prose (Lorch), not speed of location.
6. **"Developers over-trust AI output."** None of the studies read here measure over-trust while reading a finished artifact; several are preference or self-report.
7. **"There is research on how to display logs."** There is research on writing and analysing them; reading them is nearly unstudied.
8. **"Copy buttons on every code block."** Convention (converged across tools) that is exactly the chrome Marxy forbids at rest; no study tests it.

## 10. What is not known

- Whether any presentation choice changes whether a reader *catches an error* in a transcript.
- Whether line numbers help retrieval.
- How often copy substitution errors occur in practice.
- Whether readers of very long artifacts use outlines, and whether they help.
- Everything about non-English or right-to-left code and logs.

These are recorded as gaps in `data/01.json`; several are candidates for a small study Marxy could never run without telemetry, which is a reason to prefer designs that fail safe over ones that need measuring.

[^crosby]: Martha E. Crosby and Jan Stelovsky, "How do we read algorithms? A case study", *IEEE Computer* 23(1):25–35, 1990 (abstract only, via a search-result summary). [ieeexplore.ieee.org/iel1/2/1814/00048797.pdf](https://ieeexplore.ieee.org/iel1/2/1814/00048797.pdf). Accessed 2026-09-25.
[^busjahn]: Teresa Busjahn, Roman Bednarik, Andrew Begel, Martha Crosby, James H. Paterson, Carsten Schulte, Bonita Sharif and Sascha Tamm, "Eye movements in code reading: relaxing the linear order", *ICPC 2015*, 2015 (abstract and introduction read; results not read in full). [cs.uef.fi/pages/bednarik/ICPC2015_authors_version.pdf](https://cs.uef.fi/pages/bednarik/ICPC2015_authors_version.pdf). Accessed 2026-09-25.
[^peitek20]: Norman Peitek, Janet Siegmund and Sven Apel, "What drives the reading order of programmers? An eye tracking study", *ICPC 2020*, 2020 (abstract only, confirmed on the ICPC 2020 programme page; the PDF could not be text-extracted). [se.cs.uni-saarland.de/publications/docs/PSA20.pdf](https://www.se.cs.uni-saarland.de/publications/docs/PSA20.pdf). Accessed 2026-09-25.
[^uwano]: Hidetake Uwano, Masahide Nakamura, Akito Monden and Ken-ichi Matsumoto, "Analyzing individual performance of source code review using reviewers' eye movement", *ETRA 2006*, pp. 133–140, 2006 (read in full). [cs.kent.edu/~jmaletic/cs69995-PC/papers/Uwano06.pdf](https://www.cs.kent.edu/~jmaletic/cs69995-PC/papers/Uwano06.pdf). Accessed 2026-09-25.
[^sharif12]: Bonita Sharif, Michael Falcone and Jonathan I. Maletic, "An eye-tracking study on the role of scan time in finding source code defects", *ETRA 2012*, pp. 381–384, 2012 (abstract only, via a search-result summary). [dl.acm.org/doi/10.1145/2168556.2168642](https://dl.acm.org/doi/10.1145/2168556.2168642). Accessed 2026-09-25.
[^rodeghero]: Paige Rodeghero, Collin McMillan, Paul W. McBurney, Nigel Bosch and Sidney D'Mello, "Improving automated source code summarization via an eye-tracking study of programmers", *ICSE 2014*, pp. 390–401, 2014 (abstract only, via a search-result summary; the signature-focus claim is as restated by Abid et al.). [semanticscholar.org/paper/Improving-automated-source-code-summarization-via-Rodeghero-McMillan/67649d6e32fcf7573da91e685cfda173775708d5](https://www.semanticscholar.org/paper/Improving-automated-source-code-summarization-via-Rodeghero-McMillan/67649d6e32fcf7573da91e685cfda173775708d5). Accessed 2026-09-25.
[^abid]: Nahla J. Abid, Bonita Sharif, Natalia Dragan, Hend Alrasheed and Jonathan I. Maletic, "Developer reading behavior while summarizing Java methods: size and context matters", *ICSE 2019*, 2019 (abstract read in the PDF). [arxiv.org/abs/1903.03358](https://arxiv.org/abs/1903.03358). Accessed 2026-09-25.
[^xia]: Xin Xia, Lingfeng Bao, David Lo, Zhenchang Xing, Ahmed E. Hassan and Shanping Li, "Measuring program comprehension: a large-scale field study with professionals", *IEEE TSE* 44(10):951–976, 2018 (abstract only, read on the publisher's repository page; 58 per cent, 78 developers and 3,148 hours all appear there). [research.monash.edu/en/publications/measuring-program-comprehension-a-large-scale-field-study-with-pr/](https://research.monash.edu/en/publications/measuring-program-comprehension-a-large-scale-field-study-with-pr/). Accessed 2026-09-25.
[^ko06]: Andrew J. Ko, Brad A. Myers, Michael J. Coblenz and Htet Htet Aung, "An exploratory study of how developers seek, relate, and collect relevant information during software maintenance tasks", *IEEE TSE* 32(12):971–987, 2006 (abstract only). [faculty.washington.edu/ajko/papers/Ko2006SeekRelateCollect.pdf](https://faculty.washington.edu/ajko/papers/Ko2006SeekRelateCollect.pdf). Accessed 2026-09-25.
[^lawrance]: Joshua Lawrance, Christopher Bogart, Margaret Burnett, Rachel Bellamy, Kyle Rector and Scott D. Fleming, "How programmers debug, revisited: an information foraging theory perspective", *IEEE TSE* 39(2):197–215, 2013 (abstract only). [digitalcommons.memphis.edu/facpubs/2870/](https://digitalcommons.memphis.edu/facpubs/2870/). Accessed 2026-09-25.
[^obaidellah]: Unaizah Obaidellah, Mohammed Al Haek and Peter C.-H. Cheng, "A survey on the usage of eye-tracking in computer programming", *ACM Computing Surveys* 51(1), 2018 (existence and scope only, from a search listing; not read). [dl.acm.org/doi/10.1145/3145904](https://dl.acm.org/doi/10.1145/3145904). Accessed 2026-09-25.
[^icer23]: Neil Brown, Michael Kölling and Pierre Weill-Tessier, "An eye tracking study assessing the impact of background styling in code editors on novice programmers' code understanding", *ACM ICER 2023* (abstract only, read on the King's College London research portal; the ACM page returned 403; the count of 62 participants is from a search summary of the paper). [kclpure.kcl.ac.uk/portal/en/publications/an-eye-tracking-study-assessing-the-impact-of-background-styling-/](https://kclpure.kcl.ac.uk/portal/en/publications/an-eye-tracking-study-assessing-the-impact-of-background-styling-/) and [dl.acm.org/doi/10.1145/3568813.3600133](https://dl.acm.org/doi/10.1145/3568813.3600133). Accessed 2026-09-25.
[^dp11]: Geoffrey B. Duggan and Stephen J. Payne, "Skim reading by satisficing: evidence from eye tracking", *CHI 2011*, 2011 (abstract only, via a search-result summary). [dl.acm.org/doi/10.1145/1978942.1979114](https://dl.acm.org/doi/10.1145/1978942.1979114). Accessed 2026-09-25.
[^dp09]: Geoffrey B. Duggan and Stephen J. Payne, "Text skimming: the process and effectiveness of foraging through text under time pressure", *Journal of Experimental Psychology: Applied* 15(3):228–242, 2009 (abstract only, via a search-result summary). [researchportal.bath.ac.uk/en/publications/text-skimming-the-process-and-effectiveness-of-foraging-through-t/](https://researchportal.bath.ac.uk/en/publications/text-skimming-the-process-and-effectiveness-of-foraging-through-t/). Accessed 2026-09-25.
[^lorch]: Robert F. Lorch Jr., "Text-signaling devices and their effects on reading and memory processes", *Educational Psychology Review* 1(3):209–234, 1989 (abstract only). [link.springer.com/article/10.1007/BF01320135](https://link.springer.com/article/10.1007/BF01320135). Accessed 2026-09-25.
[^nng]: Jakob Nielsen, "F-shaped pattern for reading web content", Nielsen Norman Group, 2006 (docs page; practitioner research). [nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/). Accessed 2026-09-25.
[^barke]: Shraddha Barke, Michael B. James and Nadia Polikarpova, "Grounded Copilot: how programmers interact with code-generating models", *OOPSLA 2023* (arXiv 2206.15000; abstract only). [arxiv.org/abs/2206.15000](https://arxiv.org/abs/2206.15000). Accessed 2026-09-25.
[^vaith]: Priyan Vaithilingam, Tianyi Zhang and Elena L. Glassman, "Expectation vs. experience: evaluating the usability of code generation tools powered by large language models", *CHI EA 2022*, 2022 (abstract only, via a search-result summary). [dl.acm.org/doi/10.1145/3491101.3519665](https://dl.acm.org/doi/10.1145/3491101.3519665). Accessed 2026-09-25.
[^mozannar]: Hussein Mozannar, Gagan Bansal, Adam Fourney and Eric Horvitz, "Reading between the lines: modeling user behavior and costs in AI-assisted programming", *CHI 2024* (arXiv 2210.14306; abstract only). [arxiv.org/abs/2210.14306](https://arxiv.org/abs/2210.14306). Accessed 2026-09-25.
[^liang]: Jenny T. Liang, Chenyang Yang and Brad A. Myers, "A large-scale survey on the usability of AI programming assistants: successes and challenges", *ICSE 2024* (arXiv 2303.17125; abstract only). [arxiv.org/abs/2303.17125](https://arxiv.org/abs/2303.17125). Accessed 2026-09-25.
[^agdebugger]: Will Epperson, Gagan Bansal, Victor Dibia, Adam Fourney, Jack Gerrits, Erkang Zhu and Saleema Amershi, "Interactive debugging and steering of multi-agent AI systems", *CHI 2025* (arXiv 2503.02068; abstract only). [arxiv.org/abs/2503.02068](https://arxiv.org/abs/2503.02068). Accessed 2026-09-25.
[^duma]: Kacper Duma, Patryk Wróblewski, Jagoda Bobińska, Julia Winiarska and Piotr Przymus, "These aren't the reviews you're looking for: how humans review AI-generated pull requests", *EASE 2026* (arXiv 2605.02273; abstract only). [arxiv.org/abs/2605.02273](https://arxiv.org/abs/2605.02273). Accessed 2026-09-25.
[^bb13]: Alberto Bacchelli and Christian Bird, "Expectations, outcomes, and challenges of modern code review", *ICSE 2013*, pp. 712–721, 2013 (abstract only, via a search-result summary). [research.tudelft.nl/en/publications/expectations-outcomes-and-challenges-of-modern-code-review/](https://research.tudelft.nl/en/publications/expectations-outcomes-and-challenges-of-modern-code-review/). Accessed 2026-09-25.
[^schroter]: Adrian Schröter, Nicolas Bettenburg and Rahul Premraj, "Do stack traces help developers fix bugs?", *MSR 2010*, pp. 118–121, 2010 (abstract only, via a search-result summary). [ieeexplore.ieee.org/document/5463280/](https://ieeexplore.ieee.org/document/5463280/). Accessed 2026-09-25.
[^yuan]: Ding Yuan, Soyeon Park and Yuanyuan Zhou, "Characterizing logging practices in open-source software", *ICSE 2012*, pp. 102–112, 2012 (abstract only, via a search-result summary). [petertsehsun.github.io/soen691/current/papers/log_icse12.pdf](http://petertsehsun.github.io/soen691/current/papers/log_icse12.pdf). Accessed 2026-09-25.
[^he]: Shilin He, Pinjia He, Zhuangbin Chen, Tianyi Yang, Yuxin Su and Michael R. Lyu, "A survey on automated log analysis for reliability engineering", *ACM Computing Surveys* 54(6), article 130, 2021 (abstract only, via a search-result summary). [dl.acm.org/doi/fullHtml/10.1145/3460345](https://dl.acm.org/doi/fullHtml/10.1145/3460345). Accessed 2026-09-25.
[^barik]: Titus Barik, Justin Smith, Kevin Lubick, Elisabeth Holmes, Jing Feng, Emerson Murphy-Hill and Chris Parnin, "Do developers read compiler error messages?", *ICSE 2017*, 2017 (abstract only, via a search result quoting the ACM page; the 13 to 25 per cent, 56 participants and performance finding also agree with a secondary summary). [dl.acm.org/doi/10.1109/ICSE.2017.59](https://dl.acm.org/doi/10.1109/ICSE.2017.59); secondary: [neverworkintheory.org](https://neverworkintheory.org/2021/09/20/do-developers-read-compiler-error-messages.html). Accessed 2026-09-25.
[^baltes]: Sebastian Baltes and Stephan Diehl, "Usage and attribution of Stack Overflow code snippets in GitHub projects", *Empirical Software Engineering* 24, 2019 (abstract only). [arxiv.org/abs/1802.02938](https://arxiv.org/abs/1802.02938). Accessed 2026-09-25.
[^yang]: Di Yang, Pedro Martins, Vaibhav Saini and Cristina Lopes, "Stack Overflow in GitHub: any snippets there?", *MSR 2017*, pp. 280–290, 2017 (abstract only, via a search-result summary). [dl.acm.org/doi/abs/10.1109/MSR.2017.13](https://dl.acm.org/doi/abs/10.1109/MSR.2017.13). Accessed 2026-09-25.
