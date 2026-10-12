# ADR-0073 — The native menu may list any registry command, and never a list of documents; amends ADR-0011's menu note

- **Status:** accepted (author, 2026-10-12, W-20 questions 1 to 3: "recommended approved")
- **Date:** 2026-10-12
- **Amends:** ADR-0011's *Note: the native menu (MARXY-342)*, which said "no tab list or document-specific command is
  added to the menu". ADR-0011's decision and its reversal criterion are untouched.
- **Evidence:** the W-20 card in `docs/plan/direction-2026-10/19-cards-wave-10.md`; `mock-v2/09-macos.md` §2 Menu bar.

## Context

W-20 grows the macOS menu bar from seven items to the mock's menus, cut to the commands that exist. Most of them act on
the document in front of the reader (Save, Fork This File, Source, Bold, Find), which ADR-0011's menu note forbids. The
note's purpose was to keep the menu from becoming a second document manager; listing commands does not do that.

## The rulings (2026-10-12)

1. **The menu may list any registry command** with the key the registry gives it, and **never a list of documents, tabs
   or windows**. The palette stays the document manager.
2. **Close Window keeps `⌘W`** until tabs have their own close command and key (the mock gives Close Window `⇧⌘W`
   because its `⌘W` closes a tab). Closing the one window quits, as today.
3. **An item that cannot run now is disabled, not hidden**, as the Mac does, so the menus keep their shape.

## Decision

1. A native menu item is a **registry command**: its title is the command's, its accelerator is the key the registry
   gives that command on macOS (no item adds a key a command does not have), and a click runs that command through the
   registry with the focused pane's context, as its key or its palette row would.
2. The menu **never lists documents, tabs or windows**: no open-documents list, no Open Recent, no Window list of
   documents. Finding and switching documents stays the palette's (ADR-0011).
3. **Close Window is `⌘W`** until a tab close exists with its own key; that change is a later story, not a new record.
4. An item whose command's `when` is false is **shown disabled**, never removed.
5. No two items share a key, and none takes a system-wide macOS shortcut; W-20's tests hold both.

## Consequences

- W-20 builds the menus to `mock-v2/09-macos.md`, cut to existing commands. ADR-0011's status line and menu note point
  here (this pull request).
- ADR-0011's decision (no tab bar at rest outside the unfolded workspace, ADR-0058) and its reversal criterion are read
  as before.

## How we would know this was wrong

1. **The menu becomes a document list** (a recent-files submenu, a list of tabs). A breach of item 2.
2. **A menu key and its command's key differ**, or a menu item replays a chord rather than running the command. W-20's
   keys-table test should catch it.
