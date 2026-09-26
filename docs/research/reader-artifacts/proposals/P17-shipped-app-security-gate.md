# Draft P17. The shipped CSP and the webview's command surface have gates

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** other. **Evidence:** [Trust and safety](../07-trust-safety.md).

## Context

The no-network gate runs in Playwright WebKit over the corpus, not against `tauri.conf.json`. `read_file` reads any path, `allow_asset_scope` accepts any directory, and `build.rs` has no app manifest. Whether Tauri 2 lets an unmanifested command be called from the webview by default was not verified.

## Proposed decision

A gate that parses the CSP string and fails on any `http(s):`, `*`, `unsafe-eval` or missing `base-uri`; a manifest and path root-check for privileged commands after the Tauri default is confirmed.

## Consequences

Makes commitments 2 and 3 checkable at the app boundary.

## What would falsify it

Confirmation that unmanifested commands are already denied.
