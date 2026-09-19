# Cold-start budget — product ruling

The measurement is honest now. Packaged cold start is **2844 ms on macOS** and
**1735 ms on Linux** against the withdrawn **500 ms** commitment. That is a
product fact about a Tauri launch, not a missed promise.

## Ruling

**500 ms still the commitment?** no

**What it is:** a standing observation of the sphere of concern. Keep measuring
`cold_start_first_text_ms`. Resist inflation: a slower launch is a cost a story
must own; CI never writes a higher number into the repo to make a red gate green.

**Honest claim:** do not claim a cold-start time on a tag.

Date: 2026-09-18 · Landed: ADR-0022 Amendment 2 (MARXY-103)
