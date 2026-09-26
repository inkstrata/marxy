# Draft P13. Three grammars join the allow-list

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** other. **Evidence:** [Structured output](../03-structured-output.md).

## Context

There is no grammar for `console`, `log` or `jsonl`. An `sh` fence colours a `$` prompt as a function.

## Proposed decision

Allow-list `shellsession` (aliases `console`, `bash session`), `jsonl` and, once a weight class exists, `log`, each with its licence recorded and `gate:licences` run. Do not allow-list `csv` (it colours columns in rotation).

## Consequences

Licences were checked upstream (MIT) but not the packaged files for `shellsession`.

## What would falsify it

A licence that fails the gate.
