# ADR-0002 — A webview shell; native toolkits are out

**Status:** accepted · **Source:** brainstorm D3, rejected-outright table

## Decision
The renderer is a web engine. Native Swift, GTK, Qt and Flutter are out.

## Why
First-class user CSS is a headline feature; shipping it natively means writing a CSS engine.
Linux is a must-support platform, which a macOS toolkit cannot serve. Nothing native offers a
typographic ceiling above a webview once line breaking is owned (ADR-0007).

## Consequences
- The shell (ADR-0010) is a thin host; the product is the frontend.
- Engine differences are a fact of life and are neutralised by owning typography, bundling
  fonts, and testing on every shipped engine (ADR-0016).
