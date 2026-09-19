---
key: MARXY-97
design: [13-trust, 06-shell]
depends: [MARXY-44, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-97]
---
# MARXY-97 — Load images from hosts a reader allowed, through the shell, never from the webview

**Design:** [13-trust](../../design/13-trust.md) §Fetching · [06-shell](../../design/06-shell.md) `fetchRemoteImage`, §CSP · **ADR:** [ADR-0027](../../adr/0027-remote-content-through-the-shell.md) (this story and MARXY-45 move it to accepted) · **Depends on:** MARXY-44 (grants, notice), MARXY-94.

**Outcome.** After "Load images from img.shields.io and github.com", a README's badges and screenshots appear. The request is made by marxy's Rust process, over HTTPS only, without cookies or a referrer, and only to the hosts the reader named for this document. The webview still cannot reach the network.

## Files and signatures
- `apps/desktop/src-tauri/src/net.rs` (or `commands/net.rs` if the commands split exists) — `fetch_remote_image(url) -> Result<String, ShellError>` returning `marxy-remote://localhost/<sha1 of url>` (the form Tauri 2 uses for custom schemes on macOS and Linux; `http://marxy-remote.localhost/<key>` on Windows); an in-memory `Mutex<HashMap<String, (mime, Vec<u8>)>>`; the `marxy-remote` URI scheme handler (`register_uri_scheme_protocol`) serving from it.
- `apps/desktop/src-tauri/Cargo.toml` — `ureq = { version = "3", default-features = false, features = ["rustls", "platform-verifier"] }` (check the licence gate; fall back to `native-tls` per ADR-0027 if a crate fails), `imagesize` if MARXY-26 has not added it, `sha1_smol`.
- `apps/desktop/src-tauri/tauri.conf.json` — CSP `img-src` gains `marxy-remote: http://marxy-remote.localhost` (MARXY-45 finalises the rest).
- `apps/desktop/src/shell/tauri.ts` — `fetchRemoteImage`.
- `apps/desktop/src/render/remote-images.ts` — §12 §Fetching loop.
- Remove the "Images will load when marxy can fetch them" string MARXY-44 left.
- Tests: Rust unit tests in `net.rs`; `apps/desktop/test/remote-images.test.mjs` (app harness, memory shell returns a `data:` PNG).

## Do this, in order
1. Rust fetch with every ADR-0027 §3 property, written as `fetch_with(transport, url)` so each policy (scheme, redirects, size, time, content type, headers sent) is unit-tested against a stub transport. One `#[ignore]` test hits a real https URL for manual runs.
2. The scheme handler: `GET marxy-remote://localhost/<key>` → 200 with the stored MIME, or 404. Nothing else.
3. App loop with ≤ 4 in flight, version check, reserved boxes, grid snap on decode.
4. Flatpak case: when `FLATPAK_ID` is set in the environment and the fetch fails before any byte is received (DNS or connect), return `unsupported` with the reason `no-network-sandbox`; the app shows the §13 notice text once per session.

## Tests → expected
| Check | Expect |
| --- | --- |
| Rust: `http://` URL | `unsupported`, no connection attempted |
| Rust: headers | no `Cookie`, `Referer`, `Origin`, `Authorization`; `User-Agent: marxy` |
| Rust: redirect to another host | refused; same host ≤ 3 followed |
| Rust: 11 MB body, `text/html` body, non-image bytes with `image/png` | each refused with `invalid` |
| harness: grant `img.shields.io` on `02-readme-real-world.md` | every `img[data-marxy-remote]` for that host gets a `src` starting `data:` (memory shell) and decodes; other hosts untouched; `fetchRemoteImage` calls only for the granted host |
| no-network harness attached | zero requests from the page throughout |
| document replaced mid-fetch | late results discarded (no `src` set on the new document) |

## Acceptance → check
1. Consented images load, via the shell only → harness case + zero page requests.
2. Every ADR-0027 §3 property → the Rust table.
3. CSP still has no `http(s)` source → MARXY-45's CSP check (run it here too).

## Do not
Add `https:` to any CSP directive. Write fetched bytes to disk. Fetch for a host that is not granted for this path. Follow a redirect to another host.
