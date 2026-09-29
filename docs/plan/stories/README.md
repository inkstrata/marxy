# Story files

One story is one file here, `KEY.json`, and the epics are together in `docs/plan/epics.json`
(ADR-0042). `scripts/lib/plan.mjs` is the only reader: it returns the same rows, dependencies and
phase lists the CSV and `orchestration/deps.json` do, from disk or from git objects at a ref. Until
those two files are removed, a checkout with no `stories/` directory is read from them, and while
both forms exist they must agree: a difference is an error naming the key and field.
`node scripts/plan-export.mjs --csv` prints the plan as a CSV.

## A story file

The CSV's columns, lowercased, plus what `deps.json` held for the story. The file name is the key.

| Field | Type | Meaning |
| --- | --- | --- |
| `key` | string | The story key, equal to the file name without `.json`. |
| `type` | string | `Story`. |
| `summary` | string | One line. |
| `epic` | string | The epic column; empty for a story. |
| `parent` | string | The epic's key. |
| `labels` | array of strings | The CSV's comma-separated Labels, one string each. |
| `paths` | array of strings | The paths the story may touch; the CSV joins them with `, `. |
| `description` | string | Free text; may be empty. |
| `acceptance` | string | The criteria, multi-line text kept as written. |
| `phase` | string | The phase it belongs to: `"0"`, `"1"`, `"ops"`. Omit for none. |
| `depends` | array of keys | Stories that must be done first. Omit or `[]` for none. |

A missing text field reads as `""`. Rows come out in numeric key order; a `MARXY-NEW-<slug>`
placeholder sorts after every numbered key. A phase's list is its stories in that order.

## Epics

`docs/plan/epics.json` is one JSON array of objects with the same fields as a story, without
`phase` and `depends`, and `type` set to `Epic`. They come out before the stories.

## What the old files said that is not a field

The former `_note` of `deps.json`: a story is ready when all its dependencies are done. Every story
appears in exactly one phase. A non-numeric phase (`ops`) is a lane beside the numbered phases: it
never holds one and is never held by one (MARXY-107). A phase is also a Jira version:
`jira.mjs release <phase> <tag>`. The `research` map is empty and is dropped; research is an ordinary
row labelled `research`.
