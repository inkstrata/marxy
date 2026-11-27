# Hunt 02's findings (known; not on main yet)

Copied from `origin/agent/hunt-02` at 1f29f9b1 on 2026-11-27, titles only. That hunt (another session) covers panel, drawer and relayout freezes on big files. Do not report these again; new evidence for one is a finding that says "Adds to hunt-02 <id>".

- NAV-01 · Moving through the left and right menus freezes the window, often (not only) with a big file open
- CMD-01 · Opening the Transforms panel on a Markdown file of 0.5 MB or more freezes the window for 10 s and more
- NAV-02 · Opening the rail on a big Markdown file freezes the window for seconds (the Links work parses the whole file again, on the main thread)
- CMD-02 · Metadata panel: showing it on a 1 MB Markdown file stalls 2.5 s, and with a 5 MB one open, opening another file stalls the window about 10 s
- CMD-03 · A 1 to 5 MB Markdown file keeps the page busy for over 15 s after it opens, so every later panel key lands in a slow page
- CMD-04 · Supersedes NAV-01 for the Line, Studio, Settings, verb menu, right-click and tab menus, and the Spine: no freeze found, but dragging the Spine is slow on a big file
- RDR-01 · Supersedes NAV-01 (drawer part): opening, folding or hiding the left section freezes a big page for 0.3 to 0.5 s each press, and the cycle has three presses
- RDR-02 · Dragging the window or the divider to a new page width stalls a big page for up to 0.9 s, three to five times in a row
- NAV-03 · Folding or opening the drawer and moving through panels costs 300-550 ms a press on a 1-5 MB Markdown file; the rail itself leaves nothing behind
