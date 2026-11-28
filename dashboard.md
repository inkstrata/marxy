# Marxy dashboard
Updated Nov 27, 20:38 PT. Week of 2026-11-27.

## Next up
- 1 The geometry table's core as a pure byte model: one record per top-le... (M): not started
- 2 The scale record's store half: the store builds the record at open an... (M): not started
- 3 The node budget constant and the parse's node prediction wired into t... (S): not started
- 4 The rest of slice 4: `carriesMarkdown` linear per line, and lines cou... (S): not started
- 5 Find, select all and copy over the model's per-block text cache; afte... (M): not started
- 6 First slice: the three capability files on macOS WebKit (`frame-fonts... (S): not started
- 7 The remaining `setTimeout(0)` yield loops onto `yieldToMain`, those n... (M): not started

## Changelog
**2026-11-27**
- #838 feat(work): the standing automation: scheduled runs, merge gate, budget governor, device installs, dashboard
- #828 feat(core): scale record (core half)
- #829 feat(parse): large Markdown parsed in a worker and handed back in pieces
- #830 test(browser): 14 hosted-Windows browser files wait on conditions and hold recorded budgets
- #832 docs(skills): plan bug hunts by axis, measure each axis's yield, stop by rule
- #834 docs(work): prompt for designing the standing automation schedule
- #837 perf(reading): a line of many unclosed brackets is scanned once when looking for Markdown marks
- #836 perf(diff): word diff stops tokenising a line at the token cap
- #831 docs(work): Windows scale measurements for the big-file budgets
- #823 perf(shell): compact byte map for multi-byte decodes, bounded encoding readings, rested folder rescans
- #835 docs(research): windowed Markdown pages; windowing rows in build order
- #833 work: narrow the shared-pieces row to what is left
- #803 fix(office): a broken character no longer shifts slide and comment positions
- #826 test(mail): the many-parts CPU bound is half the old cost, not a target a hosted Windows runner misses
- #825 perf(source): leaving Source shows the Read page without laying it out again
- #822 refactor(desktop): one scheduler for sliced work
- #827 test(scope): a junction made for a test gets native separators, so cmd doesn't read inside/e as a switch
- #824 perf(typeset): code blocks that change height apart from one another are put back on the grid in one pass, not one per block
- #821 perf(reader): long data trees fold past 300 open branches, whole-selection Copy as reuses the parse, broken non-UTF-8 data files are windowed
- #802 refactor: one platform check, one UTF-8 byte count and one grouped count per side
- #819 fix(find): find and select-all copy answer for the whole of a long page still mounting
- #818 fix(office): a Word document of many thousand paragraphs opens on its first 20,000 and says the rest are left out
- #820 fix(transforms): a CRLF file's Transforms counts no longer stop the window; a text with no blank line is not parsed behind its page
- #815 test(desktop): check:tauri times the launch and opens files on subst and network paths
- #809 ci: build and test on Linux, required; macOS startup time in the smoke check
- #814 fix(save): a save on macOS keeps the file's Created date
- #813 fix(shell): opens emitted while no boot listens wait for the next boot; document signal destroy; throwing handler isolated
- #796 feat(scripts): guard big files: research corpus, check-scale, growth tests, scale matrix, agent rules
- #816 fix(core): containers walked once: archive folders, office find, book contents, mail delimiters, certificate check
- #790 test(browser): a shared kit that waits for conditions, and a browser smoke job on pull requests
- #817 docs(work): renumber the open-with row, its id clashed with another branch's
- #795 docs(work): hunt 03 on big files: 38 findings, 23 rows in Big files, and the report
- #812 fix(budgets): paste classify in one pass, JSON Lines records capped at 1 MB
- #811 fix(export): Print to PDF keeps its print rules until the print is over
- #810 docs(work): the Windows checkout's branches are lost; their rows are rebuilt on main
- #808 fix(render): big pages finish mounting in seconds: chunks cut by elements, one insertion each, no layout read
- #805 fix(shell): Mac programs on the login-shell PATH, Finder-locked saves refused, Shift_JIS and GBK guessed
- #800 fix(panels): Transforms and Links read the store's parse once; Transforms counts in short pieces
- #807 fix(theme): typesetting a long Markdown page no longer restyles every block beside each paragraph
- #806 fix(line): @ draws 200 headings from a scan; an unreadable big data file is windowed lines
- #798 fix(open): long Word documents, pastes and code formats no longer hit the call-stack limit
- #804 perf(typeset): a batch sets hanging punctuation without a layout read between its writes
- #799 fix(search): Find and Replace fields read once, not twice
- #801 fix(export): five save and export guards
- #797 fix(viewers): RTL wide tables, deep HTML pages, refused-script console noise
- #794 fix(search): a backtracking pattern no longer freezes the window in Search or the Line
- #793 refactor(shell): one scope module judges every path and handle
- #789 ci: run the aesthetics gate and the mutation check in the full tier
- #791 fix(view): re-break a page whose column changed width while Source showed
- #788 fix(render): a very long unbroken run no longer freezes mail and Word/RTF pages
- #787 docs(work): bug hunt 02: 9 findings, 3 rows; hunt 01 onto main
- #786 docs(work): bug hunt 01 lands on main: 25 findings, 16 tracker rows
- #792 docs: agents merge their own pull requests once CI is green
- #785 docs: code-quality review, its tracker rows, and design principles for agents
- #784 fix(export): saving a long page as a web page no longer freezes the window
- #780 macOS file associations: Markdown default, everything else Alternate, PDFs and images offered
- #783 Leaving Split keeps the reading place on WebKit
- #782 Settle the macOS WebKit questions: paste-source early, leave-split and source-fold-stale real
- #781 docs(work): bug hunt 01: 25 findings, 16 tracker rows
- #779 docs(work): a bug-catch cycle of three skills: catch, verify, triage
- #778 Ask about unsaved changes on Dock Quit, Log Out and Apple-event quits (macOS)
- #777 ci: run the changed tier on pull requests, full on main, and drop the flaky macOS WebKit unit step
- #776 build(release): version 0.2.0, notices in the bundle, and a release that publishes only after its checks
- #775 docs(work): release-readiness investigation and the plan to a first tag
**2026-11-26**
- #774 feat(work): build, keep and install Marxy.app on macOS with pnpm work installer
- #773 refactor: adopt the reader architecture onto main

## Waiting for you
- R14 Decide the release: v0.2.0, a pre-release, round 16 before the tag, wave 5 after it, the file-assoc...
- B13 Pasting HTML into Source of a file that is not Markdown converts it to Markdown, as docs/using-marx...

## Health
- main CI: in_progress, 0m ago
- windows: no data yet
- macos: no data yet
- linux: no data yet

## Budget
- last usage reading: none yet (runs are blind until one exists)
- automation this week: 0% of the weekly limit
- next agent runs: night 20 0 * * *, day 45 8 * * *, plan 15 8 * * 5 (PT)
