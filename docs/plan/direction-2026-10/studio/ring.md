# The ring: history over any app (designed, for later)

**Verdict:** leave, designed (mock row 16). **Not in v1.** No card in v0.7.0; the shape is here so the
author can rule on it and a later card can start from it. **Plate:** [ring.html](ring.html).

**In short.** The mock's ring is a small floating panel, opened by a global key over whatever app is
in front, that lists history and pastes the chosen item into that app. It needs four things Marxy does
not have: a global key, which means Marxy running with no window (`resident`, ADR-0013, off by
default); a native panel that does not take focus; other apps' copies, which ADR-0066's option A does
not record; and, to paste for the reader, the macOS Accessibility permission. v1 builds none of it.

## Should v1 build it

No. With option A the ring lists only what the reader copied in Marxy, which the Clipboard view
already shows one `⇧⌘V` away while Marxy is in front. Its value comes with watching (option B), and
its cost is native code (a non-activating `NSPanel`, through `tauri-nspanel` or an `objc2` shim, kept
warm so it shows in one frame), a resident process, and a permission. It returns when ADR-0066's
"How we would know" item 1 is seen.

## The design, for when it is built

**Opening.** A global key the reader assigns in Settings › Clipboard; no default. The mock's `⌥⌘V`
is Finder's *Move Item Here*, so taking it would break moving files in Finder; `⌃⌥⌘V` is the
suggestion. The key works only while Marxy runs (with `resident = true`, or a window open).

**The panel.** 420 × at most 480 px, centred on the active screen, floating, on all Spaces, no title
bar, the `--glass` surface. A filter field, focused; scopes *History* and *Pinned* (`⇥`, `⇧⇥`); up to
60 rows, the first nine numbered for `⌘1` to `⌘9` (these keys live only in the ring's own panel,
while it has focus; they never reach Marxy's window, where `⌘1` to `⌘3` choose the mode); a preview of the selected row. `↵` uses the item,
`⌥↵` uses it as plain text, `⌥P` pins, `Esc` clears the filter and then closes.

**On `↵`, with and without permission.**

| Accessibility | What happens on `↵` | What the reader sees |
| --- | --- | --- |
| Not asked (the default) | Marxy writes the item to the clipboard and hides the panel | The ring's foot line, before `↵`: "Copies to the clipboard · press ⌘V to paste". Nothing is pasted for the reader |
| The reader turned on *Paste into the front app* | Marxy asks macOS once (`AXIsProcessTrustedWithOptions`), only at that moment | The system's own prompt; the row says "Waiting for permission in System Settings" |
| Granted | Marxy writes the item, hides the panel, reactivates the app that was in front, and posts `⌘V` (`CGEventPost`) | The text appears in that app |
| Refused or revoked | The setting turns itself off; `↵` falls back to copying | The row: "macOS did not allow Marxy to paste into other apps. The ring copies, and you press ⌘V." with *Open Privacy & Security…* |

Marxy never asks for Accessibility at launch, during onboarding, or for any other feature, and never
asks again after a refusal unless the reader turns the setting on again.

## What it may never do

Read what is in front of the reader, read the selection in another app, send keys other than one
`⌘V` after the reader's `↵`, show over a secure input field's contents, or keep the panel's list
anywhere but the history it already has.
