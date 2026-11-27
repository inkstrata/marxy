---
corpus: large-files
id: 09
slug: buffers-memory
prefix: BUF
title: Text buffers, offset maps, undo, diff and save, and what they cost in memory
researched: 2026-11-27
confidence: medium
volatility: slow
status: active
keywords: [piece table, rope, gap buffer, CodeMirror Text, offset map, UTF-16, positionEncoding, V8 string, sliced string, cons string, undo, Myers diff, histogram diff, atomic write, fsync, SHA-256, memory budget]
---

# 09 · Text buffers, offset maps, undo, diff and save, and what they cost in memory

> Which buffer, offset-map, undo, diff and save designs scale to 1-50 MB, and what each costs in memory. The
> answer for this app: keep the bytes as one immutable `Uint8Array` (a flat buffer is the right document at 5-50 MB
> because no edit is bulk), index it with sparse structures (line starts, UTF-16 checkpoints every ~1 KB) built
> lazily, never hold the decoded string and a per-unit table together, and treat the copies made downstream of the
> parse (tree, HTML, DOM, warm cache) as the real memory problem. Ropes and piece tables matter for edit speed and
> cheap snapshots, not for this app's measured memory cost.

## TL;DR
- The document itself is cheap: 5 MB of bytes is 5 MB. The measured cost is derived data: in the repo's own audit a 5 MB parse retained 102.7 MB of heap with a peak RSS growth of about 1.4 GB, and 1 MB of Markdown drove WebContent to 766 MB (BUF-12).
- A per-unit offset table at 4 bytes per UTF-16 unit costs 4x the file as a string (20 MB for 5 MB of ASCII; 4x again on top of a two-byte string). Sparse checkpoints plus a scan of at most a few hundred units cost under 1% (BUF-03).
- Piece tables and ropes both store roughly the document size plus small metadata (Ropey: about 10% overhead; VS Code: the old line-object array was about 20x the file), and a rope's clone is "extremely cheap", which suits snapshot undo. For byte splices on a 5-50 MB flat buffer, copy-on-edit is O(n) per edit and acceptable only if edits are coalesced and large edits are rare (BUF-01, BUF-02, BUF-06).
- JS engine traps: V8 max string length is 2^29 - 24 (about 1 GiB two-byte), JavaScriptCore is INT32_MAX; a substring can be a "sliced string" that keeps its whole parent alive; concatenation makes cons trees that are flattened (copied) on first regex or `indexOf` (BUF-04).
- Diff: cap input and time like VS Code (`maxFileSize` 50 MB, `maxComputationTime` 5000 ms, a 1700-line threshold to pick the algorithm), hash lines first, fall back to a coarse result (BUF-08, BUF-09).
- Saves: already the right shape (temp file, compare length and SHA-256, rename). Add an fsync before the rename and hash in Rust, not in JS (BUF-10, BUF-11).

## Recommendation for this setup

1. **Keep the bytes as the document, as a single `Uint8Array` per store, and do not add a rope or piece table now.**
   At 5-50 MB the cost is not the splice (a `copyWithin` of 50 MB is tens of ms and happens on a discrete edit);
   it is the derived copies. Revisit only if a measured edit path (Source typing, find-replace-all, transforms)
   exceeds a frame at 50 MB. If it does, use a piece list over immutable chunks (the byte-addressed analogue of
   VS Code's piece tree), not a gap buffer: a gap buffer is a mutable single buffer, so a snapshot is a full copy.
2. **Make the string and the offset map lazy and bounded.** Decode text per range (a block or a screen of lines)
   from the bytes, and keep one whole-file string only while a whole-file consumer is running. Replace any full
   per-unit UTF-16-to-byte table with checkpoints every 1024 bytes (about 4-8 bytes per KB, i.e. 0.4-0.8%),
   scanning at most one chunk to resolve an offset; build the line-start index as a `Uint32Array` (4 bytes per
   line; 5 MB at 40 bytes per line is 125k lines, 0.5 MB). Both should be built in a worker or in time slices.
3. **Budget memory per open document and say it.** Use the estimate in BUF-12: a 5 MB Markdown page should cost
   under about 150-200 MB of JS-side memory, not 766 MB. Drop first: the whole-file HTML string (render per block,
   stream into the DOM), the whole DOM beyond the near-screen window, and the whole-file tree's duplicate of text
   (keep byte ranges, not substrings). Make lazy: the offset map, the sanitised-page cache for files over a
   threshold (keep only for files under about 1 MB), and highlight/typeset state.
4. **Undo as inverse splices with coalescing and a byte cap.** Store for each step the range, the replaced bytes
   (a `subarray` copy of only the replaced span) and the inserted length; never a snapshot of the document. Cap by
   total retained bytes (for example 32 MB per document) as well as by step count, dropping oldest steps first.
   For large replacements (replace-all, a transform over the whole selection) store a single step holding the
   old span, and refuse to keep history when that exceeds the cap (tell the reader).
5. **Diff with a hard envelope.** Hash each line to an integer (FNV or xxHash of the bytes), diff the integer
   arrays with Myers under a time limit (about 1-5 s) and a size cap, switch to histogram when there are many
   repeated lines, and when the cap trips return a coarse "whole file differs" or per-block result with a notice,
   as VS Code does. Run it in a worker; accept cancellation.
6. **Save: keep the current compare-then-rename design, add fsync, hash natively.** Write the temp file in the
   target's folder, `sync_all` the file, rename, then sync the directory where the platform allows. Compute the
   SHA-256 of the baseline in Rust (the shell already has the bytes it read) and send the front end only the digest;
   send the new bytes across IPC once, as a raw body.
7. **Do not**: build a per-character offset table; call `split('\n')` on a whole-file string to index lines (it
   allocates one string per line, about 125k objects at 5 MB; scan the bytes for 0x0A instead); keep substrings of
   the file string in long-lived structures (slice parent retention); hold a parse tree whose nodes carry copies of text.

**Rules for new features**
- A feature that needs an offset conversion uses the shared checkpoint map; no code allocates an array with one entry per character, byte or UTF-16 unit of a document.
- No whole-document `split`, `match`, `replace` or spread on a document string in a code path that runs per open, per edit or per keystroke; line work scans bytes or uses the line index.
- Long-lived structures (stores, caches, tree nodes) hold byte ranges or `Uint8Array.slice` copies, never `String.slice`/`substring` results of the document string.
- Every cache of a derived whole-document artefact (HTML, tree, text) has an owner, a size cap in bytes, and is dropped when the store is released or the file is over the threshold.
- Undo entries store only the replaced span and have a total byte cap; a test applies 10,000 edits to a 5 MB file and checks retained history under the cap.
- Any diff runs on line hashes with a time limit and a size cap, and returns a flagged coarse result rather than hanging.
- A save sends bytes over IPC once, never reads the file back to compare, and writes temp, fsync, rename.
- A new whole-document structure states its bytes per source byte in its doc comment, and a test asserts it for a 5 MB fixture.

## Findings

### BUF-01 · VS Code moved from a line array to a piece tree because of memory  `[confirmed]`
The 2018 write-up says a 35 MB file with 13.7 million lines "failed" to open because each line object "used around 40-60 bytes", so the line array "used around 600MB memory to store the document", which it calls "roughly 20 times the initial file size" [1]. A piece table's "initial memory usage ... is close to the size of the document and the memory needed for modifications is proportional to the number of edits and text added" [1]. The price is slow line lookup, solved by a balanced tree that caches the left subtree's length and line-break count so searching "from the root of the tree can be efficient" [1]. Lesson: per-line or per-character objects are what kills memory, not the text.
Note the post's benchmark table lists file sizes (1.46 MB 26k lines to a 54 MB 3M-line heap snapshot) but the memory figures are in images, which the saved text does not carry; I did not read them.

### BUF-02 · Ropes: small overhead, cheap clones, several metrics per node  `[confirmed]`
Ropey says "Freshly loading a file from disk only incurs about 10% memory overhead", so "a 100 MB text file will occupy about 110 MB", and "Cloning ropes is extremely cheap" because clones share data [2]. xi-editor's rope is an `Arc`-shared B-tree with 4-8 children per node (`MIN_CHILDREN` 4, `MAX_CHILDREN` 8), so a snapshot is an `Arc` clone [3]. Zed's rope chunks are at most 128 bytes (`MAX_BASE` is `Bitmap::BITS`, a `u128`) and each chunk carries bitmaps for chars, newlines, tabs and UTF-16 surrogate positions, with summaries giving offset-to-UTF-16 and point conversions in O(log n) [4]. Ropey counts "Unicode scalar values" as its atomic unit and treats line breaks as an optional feature set [5]. CodeMirror 6's `Text` is a persistent tree of leaves of at most `Tree.Branch` = 32 lines (`BranchShift = 5`) with per-node length and line count, so every document state is immutable and shared [6]. For an immutable document with cheap snapshots, these are the fit; the cost is complexity and that bytes-with-UTF-8-boundaries rules must be re-implemented in TypeScript.

### BUF-03 · Offset maps: per-unit tables are 4x; sparse checkpoints are under 1%  `[likely]`
Inference from the structures above plus LSP: a `Uint32Array` with one entry per UTF-16 unit costs 4 bytes per unit (20 MB for a 5M-unit file, on top of the text itself), while Zed stores the conversion information in per-chunk summaries and bitmaps [4], and VS Code's piece tree stores `lineStarts` per buffer chunk and a subtree summary [1]. LSP 3.17 added `positionEncoding` because UTF-16 offsets are costly to convert: its text says "since the conversion from one encoding into another requires the content of the file / line the conversion is best done where the file is read" [7]. That is a sign that converting is a scan of the line, not a table lookup, and is cheap when lines are short; it is not cheap when a line is 100 KB, so a checkpoint every N bytes bounds the scan. I did not find a published benchmark of checkpoint spacing; 1 KB is my estimate and should be measured.

### BUF-04 · V8 and JSC string internals that bite at multi-MB  `[confirmed]`
V8's maximum string length is 2^29 - 24 characters (about 1 GiB of two-byte) per MDN [8]; the VS Code post hit a 256 MB limit in an older V8 [1]. JavaScriptCore's `JSString::MaxLength` is `std::numeric_limits<int32_t>::max()` [9]. The WKWebView on macOS therefore does not run out of length before memory. V8's documentation says "concatenation creates lightweight tree nodes (ConsString), substring extraction creates views (SlicedString)", and that flattening "allocates a new SeqOneByteString or SeqTwoByteString of cons->length() and copies all leaf characters" [10]; the source says a sliced string saves time and memory but lists "truncating sliced string to enable otherwise unneeded parent to be GC'ed" as a missing feature, with `kMinLength` 13 [11]. So a 20-character substring of a 5 MB string keeps all 5 MB alive. Two-byte strings are the Latin-1-or-not choice per string: the V8 doc describes a one-byte (Latin-1) and a two-byte representation [10]; that one non-Latin-1 character forces the whole flat string to two-byte (doubling it) is my inference from that split, not a quotation. This is V8; JSC has its own rope and substring behaviour (the header documents `maxLengthForOnStackResolve` and rope resolution) [9] but I did not verify its sliced-string retention.

### BUF-05 · No WebKit/WKWebView figures for split('\n') and TextDecoder cost on multi-MB text  `[absence]`
I looked for a primary measurement of `String.prototype.split` on a multi-MB string and of `TextDecoder` throughput in WebKit and V8 and found none for WebKit/WKWebView. A generic TextDecoder benchmark does exist (lemire.github.io/jstextdecoderbench, found by the verifier, not read and not WebKit-specific), so the absence is limited to WebKit figures and to `split`. What can be said from the structure: `split` makes one string per line (sliced where over 13 chars, per BUF-04 [11]), so 125k lines at 5 MB is 125k heap objects plus parent retention; scanning a `Uint8Array` for 0x0A with `indexOf` or a manual loop produces one `Uint32Array`. Measure both on WebKit before relying on the numbers.
**Searched:** web search "V8 cons string flatten one-byte two-byte"; V8 `docs/objects/strings.md` and `string.h`; no WebKit benchmark pages found for `TextDecoder` or `split`; the verifier's search found only the Lemire TextDecoder benchmark (lemire.github.io/jstextdecoderbench).

### BUF-06 · Gap buffers and flat buffers: the right choice only below the edit-cost threshold  `[likely]`
A gap buffer has O(1) typing at the cursor and a full-size copy for a snapshot; that clashes with the app's requirement for immutable documents and cheap snapshots (CodeMirror's design is immutable states with change sets [6][12]). A flat `Uint8Array` with copy-on-splice costs O(n) per edit (5 MB: a few ms; 50 MB: tens of ms), which is fine for discrete, coalesced edits but not for per-keystroke edits in Source at 50 MB; the app already leaves Source's keystrokes to CodeMirror and folds back "as one minimal splice" [13], which is the correct split. No source measured splice cost at 50 MB; this is inference.

### BUF-07 · Undo: change sets and inverse changes, with a depth limit  `[confirmed]`
CodeMirror's history extension stores `ChangeSet` inverses (`invertedDesc`, `composeDesc`, `mapDesc` exist on `ChangeDesc`) [12], and its config has `minDepth: 100` and `newGroupDelay: 500` ms for grouping typing into one undo event [14]. This is the inverse-splice design: memory is proportional to the text changed, not to the document. Caps are by event count (100 minimum), not bytes, so a replace-all on a 50 MB document could be retained whole; this app should cap by bytes as well. Persistent trees (BUF-02) make full snapshots cheap too (an `Arc` clone), but they only help if the document is itself a tree.

### BUF-08 · VS Code's diff limits and algorithm switch  `[confirmed]`
`diffEditorDefaultOptions` has `maxComputationTime: 5000` and `maxFileSize: 50` (documented in MB) [15]. The default lines diff computer uses a dynamic programming diff when `sequence1.length + sequence2.length < 1700` and Myers otherwise, passes a `DateTimeout` built from `maxComputationTime`, and returns a `LinesDiff` carrying `hitTimeout` [16]. The pattern is: time limit, size cap, a flag on the result, and a cheaper coarse answer after the cap.

### BUF-09 · Myers is O(ND); histogram caps its chains  `[confirmed]` (JGit part) / `[unverified]` (Git 2.49 sentence)
Myers' algorithm is O(ND) in the input length N and edit distance D, so two very different files go quadratic (secondary reading; the paper itself was not fetched). JGit's `HistogramDiff` description is an extended form of patience diff that falls back to Myers when a region has too many repeated elements; its comment states the chain size is capped so the search is linear rather than quadratic [17]. Hashing each line to an integer before diffing keeps the inner loop at integer compares. A 2025 analysis of Git 2.49 reports Myers on average fastest and histogram and patience slower, all with small differences `[unverified]` (from a search summary that was not saved; verifier: it should not sit under a confirmed tag). I did not find GitHub's own diff limit numbers: the repository-limits page saved is general and the pull-request page only says "Diffs may not display if a pull request exceeds repository diff limits" [18].
**Searched:** docs.github.com repository-limits page (no diff-size figures in the saved text); docs.github.com "about comparing branches in pull requests" (no numbers); web search for GitHub diff limits.

### BUF-10 · Atomic save: fsync matters, and the repo's design already compares before rename  `[confirmed]`
The LWN discussion of ext4 data loss says that "with ext3 we should avoid fsync because it can cause seconds of delay for the whole system ... but with ext4 we should fsync because otherwise data are not saved" [19]. The ext4 rename-over-file patch forces block allocation, but the portable rule is write temp, fsync, rename. This app's save already sends the length and SHA-256 of the baseline, has Rust compare, stage, re-check and rename [13]. Verify that the staging step calls `sync_all` on the temp file before rename; I did not read the Rust.

### BUF-11 · SHA-256 speed: use the native path  `[likely]`
The Rust `sha2` crate has backends for hardware SHA: `x86-sha` "uses the x86 SHA-NI extension" and `aarch64-sha2` "uses the AArch64 sha2 extension" [20]; Apple silicon, Intel and AMD parts have them, so a 5 MB hash is a few ms in Rust. Browser WebCrypto digest is async and copies the buffer into the crypto layer (WebKit documents its implementation but not throughput) [21]. I found no published MB/s for `crypto.subtle.digest` on WebKit or Chromium, so a figure would be a guess; measure. Recommendation stands on structure: hash where the bytes already are (Rust), and avoid sending 5-50 MB to JS only to hash it.
**Searched:** web search "WebCrypto digest SHA-256 throughput MB/s"; MDN digest page via search result (no numbers); docs.rs sha2 (backends only).

### BUF-12 · Memory multipliers for a 5 MB Markdown file  `[likely]`
Measured by the repo's own audit (older, partly stale, October 2026; the audit's raw JSON gives html_len 11,838,077, 50 KB less than its table): a 5 MB parse had 306,505 AST nodes, 11,888,387 HTML bytes, "Retained heap after GC" 102.7 MB, and peak RSS growth during one parse 1,400 MB (about 270 bytes of garbage per source byte, micromark's event stream); a 1 MB launch peaked at 766 MB WebContent RSS [22]. My estimate per copy for 5 MB of mostly ASCII text, with JS-side numbers inferred rather than measured:

| Copy | Estimate | Verdict |
|---|---|---|
| Rust read buffer + IPC body | 5 + 5 MB transient | drop the Rust copy after send |
| `Uint8Array` document (kept) | 5 MB | keep |
| Decoded string | 5 MB one-byte, 10 MB if any non-Latin-1 | per-range, or one whole-file string only transiently |
| Full per-unit offset map | 20 MB (4 B per unit) | replace by checkpoints, about 0.04 MB at 1 KB spacing |
| Line index | 0.5 MB at 125k lines | keep |
| Tree (306k nodes) | most of the 102.7 MB retained (about 300 B per node if all of it) | parse in slices, drop nodes that are off screen, no text copies |
| HTML string | 11.9 MB one-byte (24 MB if two-byte) | stream per block, never whole |
| DOM for the whole page | hundreds of MB (766 MB WebContent at 1 MB in the audit) | window it (see vector 04) |
| Undo | KB to MB | cap bytes |
| Warm cache (3 stores, none over 16 MB, plus rendered page) | up to 3 x everything above | keep the bytes and tree only, drop rendered page and DOM when over 1 MB |
So the 5 MB bytes and line index are about 6 MB; the avoidable derived copies are two orders of magnitude larger.

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| Flat `Uint8Array`, copy-on-splice | Matches "bytes are the document"; trivial snapshots by reference if never mutated in place | O(n) per edit (ms at 5 MB, tens of ms at 50 MB) | Per-keystroke edits at 50 MB | Keep; coalesce edits |
| Piece list over immutable chunks | Cheap splices and snapshots; bytes natural | Moderate code, index per chunk | Chunk boundaries inside UTF-8 sequences | Adopt only if edit cost is measured as a problem |
| Rope / B-tree (Ropey-like, Zed-like) | Best asymptotics, multi-metric | Heavy TS port, about 10% overhead | Complexity, bug surface | Not now |
| Gap buffer | Great for cursor typing | Snapshot = full copy | Conflicts with immutability | No |
| Per-unit UTF-16 offset table | Simple | 4x text size | Dominates memory | No |
| Checkpoints (1 KB) + line index | Cheap, lazy | Scan of <=1 KB per lookup | Long lines need the chunk cap | Yes |
| Snapshot undo | Simple | O(doc) per step | Memory | No |
| Inverse-splice undo with byte cap | Matches the edit model | O(changed) | Needs coalescing rules | Yes |

## Open questions
- Measured JS-side bytes for the tree, HTML and DOM at 5 MB in WebKit (the audit gives retained heap, not per-copy figures); settle with a heap snapshot in Safari/WebKit's Web Inspector.
- `TextDecoder`, `split`, and `crypto.subtle.digest` throughput on WKWebView: no published figures found.
- Whether the shell's `write_atomic_unless_changed` fsyncs the staging file (read the Rust).
- GitHub's actual per-file diff limits (not found in the pages saved).

## Cross-links
- Vector 01 (code editors): BUF-01, BUF-02 against VS Code's and Zed's large-file thresholds.
- Vector 04 (dom-rendering): BUF-12 DOM row; window the DOM before anything else.
- Vector 03 (parsing): BUF-12 tree and micromark event garbage (270 bytes per source byte).
- Vector 06 (main-thread): BUF-10, BUF-11 on IPC and hashing; structured-clone cost of strings.
- Vector 10 (guardrails): the "Rules for new features" above are testable as memory-per-source-byte assertions.

## Sources
1. Text Buffer Reimplementation, Peng Lyu, VS Code blog — https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation (accessed 2026-11-27) — piece table, 13.7M-line array, 256 MB string limit
2. Ropey README, Nathan Vegdahl — https://raw.githubusercontent.com/cessen/ropey/master/README.md (accessed 2026-11-27) — "about 10% memory overhead", cheap clones
3. xi-editor rope tree.rs — https://github.com/xi-editor/xi-editor/blob/master/rust/rope/src/tree.rs (accessed 2026-11-27) — `Arc` B-tree, 4-8 children
4. Zed rope.rs and chunk.rs — https://raw.githubusercontent.com/zed-industries/zed/main/crates/rope/src/rope.rs and https://raw.githubusercontent.com/zed-industries/zed/main/crates/rope/src/chunk.rs (accessed 2026-11-27) — 128-byte chunks, UTF-16 bitmaps and conversions
5. Ropey docs — https://docs.rs/ropey/latest/ropey/ (accessed 2026-11-27) — unit is Unicode scalar values; line break features
6. CodeMirror state text.ts — https://raw.githubusercontent.com/codemirror/state/main/src/text.ts (accessed 2026-11-27) — `Tree.Branch`, persistent leaves
7. Language Server Protocol 3.17 specification — https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ (accessed 2026-11-27) — position encoding negotiation
8. MDN String length — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length (accessed 2026-11-27) — V8 maximum length
9. WebKit JSString.h — https://raw.githubusercontent.com/WebKit/WebKit/main/Source/JavaScriptCore/runtime/JSString.h (accessed 2026-11-27) — `MaxLength` int32 max
10. Strings in V8, V8 docs — https://chromium.googlesource.com/v8/v8.git/+/main/docs/objects/strings.md (accessed 2026-11-27) — cons, sliced, flatten
11. V8 string.h — https://raw.githubusercontent.com/v8/v8/main/src/objects/string.h (accessed 2026-11-27) — SlicedString comment, `kMinLength` 13
12. CodeMirror state change.ts — https://raw.githubusercontent.com/codemirror/state/main/src/change.ts (accessed 2026-11-27) — `invertedDesc`, `composeDesc`
13. Repository docs/architecture.md, "Documents, edits and saves" (local file, read 2026-11-27)
14. CodeMirror commands history.ts — https://raw.githubusercontent.com/codemirror/commands/main/src/history.ts (accessed 2026-11-27) — `minDepth` 100, `newGroupDelay` 500
15. VS Code diffEditor.ts defaults — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/diffEditor.ts (accessed 2026-11-27) — `maxComputationTime: 5000`, `maxFileSize: 50`
16. VS Code defaultLinesDiffComputer.ts — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts (accessed 2026-11-27) — 1700 threshold, `DateTimeout`, `hitTimeout`
17. JGit HistogramDiff — https://archive.eclipse.org/jgit/site/5.11.0.202103091610-r/org.eclipse.jgit.coverage/jacoco-aggregate/org.eclipse.jgit/org.eclipse.jgit.diff/HistogramDiff.java.html (accessed 2026-11-27) — chain cap, Myers fallback
18. GitHub Docs, about comparing branches in pull requests — https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests (accessed 2026-11-27) — diffs may not display over limits; no numbers
19. LWN, ext4 and data loss — https://lwn.net/Articles/322823/ (accessed 2026-11-27) — fsync advice
20. sha2 crate — https://docs.rs/crate/sha2/latest (accessed 2026-11-27) — hardware backends
21. WebKit, Update on Web Cryptography — https://webkit.org/blog/7790/update-on-web-cryptography (accessed 2026-11-27) — no throughput numbers
22. Repo docs/research/audit-2026-10/05-performance-audit.md (local, read 2026-11-27) — 5 MB parse table, 766 MB WebContent at 1 MB
