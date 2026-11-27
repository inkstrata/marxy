# Hunt 02: triage

| Id | Title | Catcher's severity | Verdict | Outcome |
| --- | --- | --- | --- | --- |
| NAV-01 | Moving through the rail and its panels freezes the window, often with a big file open (owner) | S1 | superseded by NAV-02, CMD-01, CMD-02, RDR-01 | explained by B17 and B18 |
| NAV-02 | Opening the rail on a big Markdown file freezes the window (Links parses the file again) | S1 | CONFIRMED, S1 | B18 |
| NAV-03 | Folding or opening the drawer costs 300–550 ms a press at 1–5 MB | S3 | DUPLICATE of RDR-01 | merged into B19 |
| CMD-01 | Opening the Transforms panel on Markdown of 0.5 MB or more freezes the window for 10 s and more | S1 | CONFIRMED, S1 (from about 0.25 MB) | B17 |
| CMD-02 | Metadata on a big Markdown file stalls, and opening another file then stalls about 10 s | S1 | CONFIRMED, S1, narrower: first Alt+2 at 4.5–5 MB; the cause is the Links re-parse, not the filed steps | merged into B18 |
| CMD-03 | A 1–5 MB Markdown file keeps the page busy for over 15 s after it opens | S2 | CONFIRMED, S3: content, not size | adds to R13 |
| CMD-04 | No freeze in the Line, Studio, Settings, menus or Spine; Spine drag slow | S3 | NOT-REPRODUCED: the drag cost was the probe's own mouse round trip | dropped |
| RDR-01 | Opening, folding or hiding the left section stalls a big page 0.3–0.5 s a press | S2 | CONFIRMED, S3 (150–240 ms on prose) | B19 |
| RDR-02 | A new page width stalls a big page up to 0.9 s, three to five times | S2 | CONFIRMED, S3 (about 0.4 s at 1–3 MB) | merged into B19 |

**What the owner met.** The likeliest freeze is B18: it fires once per file version (and again when any file
opens), on whichever panel key comes next, so it looks random. B17 is worse but only on Alt+6.

**Not reached.** The real WKWebView or WebView2 window; files of 20 MB (they open in Source, so the panels take
their cheap paths); Outline and Links rows at 20,000 headings; Places with a large real index; rail tips and
badges; the foot buttons and Space in the panels; the cause of CMD-03's busy page; `markLines`' own cost in B17.
A listener check (`probes/NAV/listeners.verify.mjs`) found no pile-up: over 20 panel switches no listener landed
on window, document or body.
