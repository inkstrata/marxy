// The style nonce CodeMirror needs to style itself under the release CSP (F-98).
//
// CodeMirror delivers its CSS (the base theme, Marxy's theme, the gutters, the search panel) as runtime <style> elements
// (style-mod). The shipped policy is `style-src 'self'` and a release build adds a per-load style nonce
// (docs/design/06-shell.md), so a <style> that does not carry that nonce is refused and the editor is left unstyled.
// Tauri writes the nonce into every <style> element of the page it serves (tauri-utils `inject_nonce_token` marks each one
// at build time; the protocol handler swaps the mark for a fresh nonce on each load and adds it to `style-src`). The
// page's own <style> elements therefore carry a nonce this script can read (`.nonce`: the attribute itself is hidden once a
// policy is enforced), and CodeMirror puts it on the <style> it creates (`EditorView.cspNonce`). No nonce is not an error:
// the dev server and the test harness have no policy, so the answer is the empty string and CodeMirror adds none.

/** The nonce Tauri put on the page's own <style> (or <script>) elements; '' when the page has none (no policy, dev). */
export function pageStyleNonce(doc: Document = document): string {
  for (const el of doc.querySelectorAll<HTMLElement>('style, script')) {
    if (el.nonce) return el.nonce;
  }
  return '';
}
