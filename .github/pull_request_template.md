<!-- Title: type(scope): imperative subject (MARXY-123). See docs/conventions.md. -->

## Summary

<!-- Two to four sentences in plain language: what a reader of marxy notices, or what a developer can now do, and why. -->

## Changes

- 
- 

## Verification

<!-- Gates run, with their result lines. One sentence on how a person could try it. -->

```
pnpm typecheck && pnpm lint && pnpm test
pnpm gate:…
```

## For the reviewer

<!-- Trade-offs, decisions the story did not specify, ADRs relied on (ADR-00nn), before/after screenshots if anything visible changed. -->

<details>
<summary>Agent detail</summary>

**Acceptance criteria → checks**

| Criterion | Checked by |
| --- | --- |
|  |  |

**Files by path**

- 

**Result**

```json
{ "key": "MARXY-", "status": "done" }
```

</details>

## Checklist

- [ ] Only the story's listed paths are touched
- [ ] Every acceptance criterion has a test or gate in this PR
- [ ] `CHANGELOG.md` has an entry under `Unreleased` in the right heading
- [ ] Queue entry in `docs/taste-review/queue.md` if anything visible changed
- [ ] No contract files changed, or an ADR is included
- [ ] No attribution trailers
