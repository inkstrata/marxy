// Byte-fidelity gate: opening a document and saving it must put back exactly the bytes that were
// there, and an edit must change exactly the bytes it names (AGENTS.md non-negotiable 4, ADR-0004).
//
// Lives in scripts/ so packages/core never reaches into the shell (ADR-0020). The gate compiles
// apps/desktop/src-tauri/src/atomic_write.rs with a bare rustc — the module depends on std and
// Linux xattr syscalls declared inline — and drives that exact code over the corpus, so a
// normalising save turns this red. Deliberately broken copies of the save path prove the gate
// would catch them.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const savePathSource = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'atomic_write.rs');
const shellDir = join(repoRoot, 'apps', 'desktop', 'src', 'shell');
const thisFile = fileURLToPath(import.meta.url);

/** The two fixtures that exist because every plausible save path gets them wrong. */
const HARD_FIXTURES = ['12-crlf-and-bom.md', '13-no-trailing-newline.md'];

/** The signature the gate compiles against; also the anchor the deliberately broken copies patch. */
const SAVE_SIGNATURE = 'pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {';

/** Rust tests MARXY-14 shipped. The live list must stay equal or grow (criterion 2). */
const MARXY_14_RUST_CASES = [
  'hostile_payloads_survive_a_round_trip',
  'a_new_file_is_created',
  'the_staging_file_is_in_the_destinations_own_directory',
  'a_successful_save_leaves_no_staging_file',
  'a_failed_save_leaves_no_staging_file_and_the_old_bytes_intact',
  'a_reader_holding_the_file_open_still_sees_the_old_bytes',
  'the_destinations_mode_survives_the_save',
  'a_read_only_destination_is_refused',
  'an_unwritable_directory_is_refused_and_the_old_bytes_survive',
  'a_symlinked_document_is_saved_through_the_link',
  'a_dangling_symlink_is_refused',
  'a_hard_linked_document_is_refused',
  'a_directory_is_not_a_document',
  'extended_attributes_survive_the_save_on_macos',
];

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const failures = [];
const fail = message => void failures.push(message);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const work = mkdtempSync(join(tmpdir(), 'marxy-fidelity-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const corpus = readdirSync(corpusDir).filter(name => !name.startsWith('.')).sort();
const bytesOf = name => readFileSync(join(corpusDir, name));

/** UTF-8 byte offset of a UTF-16 code-unit index; the same conversion operations use. */
const byteOffsetAt = (text, utf16Offset) => Buffer.byteLength(text.slice(0, utf16Offset), 'utf8');

// ---------------------------------------------------------------------------------------------
// The gate is this file, and packages/core does not reach into the shell (criterion 1).
// ---------------------------------------------------------------------------------------------

function checkTheGateIsWhatPnpmRuns() {
  if (!thisFile.endsWith(`${join('scripts', 'gate-fidelity.mjs')}`)) {
    fail(`gate: this file is ${thisFile}, not scripts/gate-fidelity.mjs`);
  }
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const core = JSON.parse(readFileSync(join(repoRoot, 'packages', 'core', 'package.json'), 'utf8'));
  const alias = root.scripts?.['gate:fidelity'] ?? '';
  const viaCore = alias === 'pnpm --filter @marxy/core test:fidelity';
  const viaScripts = /scripts\/gate-fidelity\.mjs/.test(alias);
  if (!viaCore && !viaScripts) {
    fail(`gate: package.json gate:fidelity is ${JSON.stringify(alias)}, not this file`);
  }
  if (viaCore && !/scripts\/gate-fidelity\.mjs/.test(core.scripts?.['test:fidelity'] ?? '')) {
    fail('gate: packages/core test:fidelity does not run scripts/gate-fidelity.mjs');
  }
}

function checkCoreDoesNotReachDesktop() {
  const root = join(repoRoot, 'packages', 'core');
  const hits = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|mts|cts|js|mjs|cjs|json)$/.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      if (/apps\/desktop|@marxy\/desktop/.test(text)) {
        hits.push(relative(repoRoot, path));
      }
    }
  };
  walk(root);
  if (hits.length > 0) {
    fail(`core: packages/core reads apps/desktop (${hits.join(', ')})`);
  } else {
    console.log('fidelity: no file under packages/core reads or imports apps/desktop');
  }
}

// ---------------------------------------------------------------------------------------------
// The corpus still carries the hazards the gate exists to catch.
// ---------------------------------------------------------------------------------------------

function checkCorpusPreconditions() {
  for (const name of HARD_FIXTURES) {
    if (!corpus.includes(name)) fail(`corpus: ${name} is missing; the gate's hardest case is gone`);
  }
  if (corpus.includes(HARD_FIXTURES[0])) {
    const bytes = bytesOf(HARD_FIXTURES[0]);
    if (!bytes.subarray(0, 3).equals(BOM)) {
      fail(`corpus: ${HARD_FIXTURES[0]} no longer starts with a byte-order mark`);
    }
    if (!bytes.includes('\r\n')) fail(`corpus: ${HARD_FIXTURES[0]} no longer contains a CRLF line ending`);
  }
  if (corpus.includes(HARD_FIXTURES[1])) {
    const bytes = bytesOf(HARD_FIXTURES[1]);
    if (bytes.at(-1) === 0x0a) fail(`corpus: ${HARD_FIXTURES[1]} now ends with a newline, so it tests nothing`);
  }
  if (corpus.length < 10) fail(`corpus: only ${corpus.length} files; the round trip needs the corpus`);
  // A precondition on the corpus rather than on the code: the view decodes for display, and a file
  // that cannot survive that decode would make a display-side bug look like a save-side one.
  for (const name of corpus) {
    const bytes = bytesOf(name);
    const decoded = Buffer.from(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), 'utf-8');
    if (!bytes.equals(decoded)) {
      fail(`corpus: ${name} does not survive a UTF-8 decode, so the view cannot show it faithfully`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The real save path, compiled and driven.
// ---------------------------------------------------------------------------------------------

/** Compiles a driver around the save path's source and returns the binary. `patch` breaks it on purpose. */
function buildSavePath(label, patch) {
  const dir = join(work, label);
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(savePathSource, 'utf8');
  if (patch && !source.includes(SAVE_SIGNATURE)) {
    fail(`gate: the save path no longer declares \`${SAVE_SIGNATURE}\`, so the gate cannot prove it catches a normalising save`);
    return '';
  }
  // The save path is compiled as itself, beside a generated driver that calls it, so what runs below
  // is the shipped code rather than a description of it.
  writeFileSync(join(dir, 'atomic_write.rs'), patch ? patch(source) : source);
  const driver = join(dir, 'driver.rs');
  writeFileSync(driver, `mod atomic_write;\n\n${DRIVER_MAIN}`);
  const binary = join(dir, 'driver');
  const built = spawnSync('rustc', ['--edition', '2021', '-A', 'dead_code', '-o', binary, driver], {
    encoding: 'utf8',
  });
  if (built.error || built.status !== 0) {
    fail(`gate: cannot compile the save path (${label}): ${built.error?.message ?? built.stderr.trim()}`);
    return '';
  }
  return binary;
}

const DRIVER_MAIN = `fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).expect("the document to open");
    if let Err(message) = atomic_write::write_atomic(std::path::Path::new(&args[2]), &bytes) {
        eprintln!("{message}");
        std::process::exit(2);
    }
}
`;

/** Saves `source`'s bytes over `destination` through the real save path. Returns an error message or null. */
function save(binary, source, destination) {
  const run = spawnSync(binary, [source, destination], { encoding: 'utf8' });
  if (run.error) return run.error.message;
  return run.status === 0 ? null : run.stderr.trim() || `exit ${run.status}`;
}

/** Opens each corpus file and saves it back; returns the files whose bytes did not survive. */
function roundTrip(binary, names, label) {
  const changed = [];
  const dir = join(work, `round-trip-${label}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const original = bytesOf(name);
    const destination = join(dir, name);
    // Seeded with something longer than most documents, so a save that failed to truncate would
    // leave a tail behind and be caught rather than hidden by the new bytes being longer.
    writeFileSync(destination, Buffer.alloc(original.length + 4096, 0x7e));
    const error = save(binary, join(corpusDir, name), destination);
    if (error) {
      changed.push(`${name} (refused: ${error})`);
      continue;
    }
    if (sha256(readFileSync(destination)) !== sha256(original)) changed.push(name);
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------
// An edited document: the splice changes its range and nothing else.
// ---------------------------------------------------------------------------------------------

/**
 * Editing is transformation over byte ranges (ADR-0004), so a save after an edit has to be faithful
 * everywhere the edit is not. The interesting fixture is the CRLF-and-BOM one, where an offset taken
 * from a JavaScript string is not the byte offset and the naive version would cut the document apart
 * in the wrong place.
 */
function checkEditedDocumentIsSpliced(binary) {
  const dir = join(work, 'edited');
  mkdirSync(dir, { recursive: true });

  const edits = [
    { file: '12-crlf-and-bom.md', find: 'Windows', replaceWith: 'CRLF-terminated' },
    { file: '13-no-trailing-newline.md', find: 'last line', replaceWith: 'final line' },
  ];

  let edited = 0;
  for (const { file, find, replaceWith } of edits) {
    if (!corpus.includes(file)) continue;
    const original = bytesOf(file);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(original);
    const at = text.indexOf(find);
    if (at < 0) {
      fail(`edit: ${file} no longer contains "${find}", so the spliced-save check tests nothing`);
      continue;
    }
    const start = byteOffsetAt(text, at);
    const end = byteOffsetAt(text, at + find.length);
    const replacement = Buffer.from(replaceWith, 'utf-8');
    const spliced = Buffer.concat([original.subarray(0, start), replacement, original.subarray(end)]);

    const source = join(dir, `${file}.spliced`);
    const destination = join(dir, file);
    writeFileSync(source, spliced);
    writeFileSync(destination, original);
    const error = save(binary, source, destination);
    if (error) {
      fail(`edit: saving an edited ${file} was refused: ${error}`);
      continue;
    }

    const saved = readFileSync(destination);
    if (!saved.subarray(0, start).equals(original.subarray(0, start))) {
      fail(`edit: saving ${file} changed bytes before the edited range`);
    }
    if (!saved.subarray(start, start + replacement.length).equals(replacement)) {
      fail(`edit: saving ${file} did not put the edit in its range`);
    }
    if (!saved.subarray(start + replacement.length).equals(original.subarray(end))) {
      fail(`edit: saving ${file} changed bytes after the edited range`);
    }
    if (saved.at(-1) !== original.at(-1)) {
      fail(`edit: saving ${file} changed the document's last byte`);
    }
    const crlfCount = bytes => bytes.toString('latin1').split('\r\n').length - 1;
    if (crlfCount(saved) !== crlfCount(original)) {
      fail(`edit: saving ${file} changed its line endings`);
    }
    edited++;
  }
  if (edited > 0) {
    console.log(`fidelity: an edited document saves its spliced range and nothing else (${edited} documents, byte offsets over UTF-16 ones)`);
  }

  // The CRLF-and-BOM fixture must genuinely punish an offset taken from the decoded string, or the
  // check above would pass just as happily against code that never converts offsets at all.
  const file = HARD_FIXTURES[0];
  if (corpus.includes(file)) {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytesOf(file));
    const at = text.indexOf('Windows');
    if (at >= 0 && byteOffsetAt(text, at) === at) {
      fail(`edit: in ${file} the byte offset equals the string offset, so the fixture no longer exercises the hazard`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The gate can tell a faithful save from a normalising one.
// ---------------------------------------------------------------------------------------------

/** Each entry is a normalisation someone might add to the save path in good faith. */
const NORMALISATIONS = [
  {
    name: 'CRLF line endings rewritten to LF',
    rust: `let owned: Vec<u8> = { let mut out = Vec::new(); let mut i = 0;
        while i < bytes.len() { if bytes[i] == b'\\r' && bytes.get(i + 1) == Some(&b'\\n') { i += 1; continue; }
        out.push(bytes[i]); i += 1; } out };
        let bytes: &[u8] = &owned;`,
  },
  {
    name: 'a trailing newline added to a file that had none',
    rust: `let owned: Vec<u8> = { let mut out = bytes.to_vec();
        if out.last() != Some(&b'\\n') { out.push(b'\\n'); } out };
        let bytes: &[u8] = &owned;`,
  },
  {
    name: 'a byte-order mark stripped',
    rust: `let owned: Vec<u8> = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) { bytes[3..].to_vec() }
        else { bytes.to_vec() };
        let bytes: &[u8] = &owned;`,
  },
];

function checkTheGateWouldCatchANormalisingSave() {
  for (const { name, rust } of NORMALISATIONS) {
    const label = name.replace(/[^a-z]+/gi, '-');
    const binary = buildSavePath(label, source => source.replace(SAVE_SIGNATURE, `${SAVE_SIGNATURE}\n    ${rust}`));
    if (!binary) continue;
    const caught = roundTrip(binary, corpus, label);
    if (caught.length === 0) {
      fail(`selftest: a save path with ${name} passed the round trip; this gate proves nothing`);
    } else {
      console.log(`fidelity: a save path with ${name} is caught (${caught.length} files differ, including ${caught[0]})`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// MARXY-14's case list survived the move (criterion 2).
// ---------------------------------------------------------------------------------------------

function rustTestNames(source) {
  return [...source.matchAll(/#\[test\][^\n]*\n(?:\s*#\[[^\]]+\]\s*\n)*\s*fn\s+(\w+)/g)].map(m => m[1]);
}

function checkMarxy14CasesSurvived(source) {
  const names = rustTestNames(source);
  const missing = MARXY_14_RUST_CASES.filter(name => !names.includes(name));
  if (missing.length > 0) {
    fail(`cases: MARXY-14 tests missing after the move: ${missing.join(', ')}`);
  }
  if (names.length < MARXY_14_RUST_CASES.length) {
    fail(`cases: save-path tests shrank from ${MARXY_14_RUST_CASES.length} to ${names.length}`);
  } else {
    console.log(`fidelity: save-path case list is ${names.length} (MARXY-14 had ${MARXY_14_RUST_CASES.length})`);
  }
  const mutantNames = NORMALISATIONS.map(n => n.name);
  if (mutantNames.length < 3) fail('cases: the three MARXY-14 normalising mutants are gone');
}

// ---------------------------------------------------------------------------------------------
// The durability and refusal semantics, from the save path's own tests.
// ---------------------------------------------------------------------------------------------

function runSavePathUnitTests() {
  const binary = join(work, 'save-path-tests');
  const built = spawnSync(
    'rustc',
    ['--test', '--edition', '2021', '-A', 'dead_code', '-o', binary, savePathSource],
    { encoding: 'utf8' },
  );
  if (built.error || built.status !== 0) {
    fail(`gate: cannot compile the save path's tests: ${built.error?.message ?? built.stderr.trim()}`);
    return '';
  }
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  const summary = (run.stdout ?? '').split('\n').find(line => line.startsWith('test result:')) ?? '';
  if (run.status !== 0) {
    fail(`gate: the save path's own tests fail — ${summary || run.stderr.trim()}\n${run.stdout}`);
    return run.stdout ?? '';
  }
  console.log(`fidelity: the save path's durability and refusal tests pass — ${summary.trim()}`);
  return run.stdout ?? '';
}

// ---------------------------------------------------------------------------------------------
// Linux xattr skip cannot become the silent default (criterion 3).
// ---------------------------------------------------------------------------------------------

function linuxXattrTestBody(source) {
  const match = source.match(
    /#\[cfg\(target_os = "linux"\)\]\s*fn (extended_attributes\w*)\s*\(([\s\S]*?)\n    \}/,
  );
  return match ? { name: match[1], body: match[2] } : null;
}

function checkLinuxXattrSkipIsNotSilent(source) {
  const test = linuxXattrTestBody(source);
  if (!test) {
    fail('linux-xattr: the save path has no Linux extended-attribute test');
    return;
  }
  if (!/filesystem_lacks_support/.test(test.body)) {
    fail('linux-xattr: the Linux test may skip without checking that the filesystem lacks support');
  }
  if (/_\s*=>\s*return/.test(test.body)) {
    fail('linux-xattr: the Linux test has a catch-all skip; that is the silent default this check forbids');
  }
  if (!/user\.marxy\.test/.test(test.body) || !/write_atomic/.test(test.body)) {
    fail('linux-xattr: the Linux test does not set an attribute and save through the real path');
  }
  if (!/posix_acl|POSIX ACL/.test(test.body)) {
    fail('linux-xattr: the Linux test does not cover POSIX ACLs');
  }
}

function probeLinuxXattrSupport() {
  const dir = mkdtempSync(join(work, 'xattr-probe-'));
  const probeRs = join(dir, 'probe.rs');
  writeFileSync(
    probeRs,
    `fn main() {
    use std::ffi::{CString, c_char, c_void};
    use std::io::Write;
    extern "C" {
        fn setxattr(path: *const c_char, name: *const c_char, value: *const c_void, size: usize, flags: i32) -> i32;
        fn getxattr(path: *const c_char, name: *const c_char, value: *mut c_void, size: usize) -> isize;
    }
    let dir = std::env::temp_dir().join(format!("marxy-xattr-probe-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("p");
    std::fs::write(&path, b"x").unwrap();
    let c_path = CString::new(path.to_string_lossy().as_bytes()).unwrap();
    let c_name = CString::new("user.marxy.probe").unwrap();
    let value = b"1";
    let rc = unsafe {
        setxattr(c_path.as_ptr(), c_name.as_ptr(), value.as_ptr() as *const c_void, value.len(), 0)
    };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        let errno = err.raw_os_error();
        std::fs::remove_dir_all(&dir).ok();
        if matches!(errno, Some(95) | Some(38)) { std::process::exit(2); }
        eprintln!("{err}");
        std::process::exit(1);
    }
    let mut buf = [0u8; 8];
    let n = unsafe {
        getxattr(c_path.as_ptr(), c_name.as_ptr(), buf.as_mut_ptr() as *mut c_void, buf.len())
    };
    std::fs::remove_dir_all(&dir).ok();
    if n == 1 && &buf[..1] == b"1" { std::process::exit(0); }
    std::process::exit(1);
}
`,
  );
  const binary = join(dir, 'probe');
  const built = spawnSync('rustc', ['--edition', '2021', '-o', binary, probeRs], { encoding: 'utf8' });
  if (built.status !== 0) return { status: 'error', detail: built.stderr.trim() };
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  if (run.status === 0) return { status: 'supported' };
  if (run.status === 2) return { status: 'unsupported' };
  return { status: 'error', detail: run.stderr.trim() || `exit ${run.status}` };
}

function checkLinuxXattrWasRequired(testStdout) {
  if (process.platform !== 'linux') return;
  if (/\blinux-xattr: preserved\b/.test(testStdout)) {
    console.log('fidelity: Linux extended attributes were preserved through the real save path');
    return;
  }
  if (/\blinux-xattr: skipped:/.test(testStdout)) {
    const probe = probeLinuxXattrSupport();
    if (probe.status === 'supported') {
      fail('linux-xattr: the save-path test skipped, but this filesystem accepts extended attributes; skip cannot be the default');
    } else if (probe.status === 'unsupported') {
      console.log('fidelity: Linux xattr test skipped; independent probe also found no support');
    } else {
      fail(`linux-xattr: could not independently probe support (${probe.detail})`);
    }
    return;
  }
  fail('linux-xattr: the Linux attribute test neither preserved an attribute nor skipped for missing filesystem support');
}

// ---------------------------------------------------------------------------------------------
// CI runs the gate on both runner classes, and the Linux step cannot be optional (criterion 4).
// ---------------------------------------------------------------------------------------------

function fidelityWorkflowStep(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex(line => /run:\s*pnpm gate:fidelity\b/.test(line));
  if (start < 0) return null;
  const indent = /^\s*/.exec(lines[start])[0].length;
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      block.push(line);
      continue;
    }
    const ind = /^\s*/.exec(line)[0].length;
    if (line.trimStart().startsWith('- ') && ind <= indent) break;
    if (ind < indent) break;
    block.push(line);
  }
  return block.join('\n');
}

function checkCiRunsFidelityOnBothRunners() {
  const workflow = join(repoRoot, '.github', 'workflows', 'ci.yml');
  if (!existsSync(workflow)) {
    fail('ci: .github/workflows/ci.yml is missing');
    return;
  }
  const yaml = readFileSync(workflow, 'utf8');
  if (!/macos-latest/.test(yaml) || !/ubuntu-latest/.test(yaml)) {
    fail('ci: the workflow does not name both macos-latest and ubuntu-latest');
  }
  const step = fidelityWorkflowStep(yaml);
  if (!step) {
    fail('ci: pnpm gate:fidelity is not a workflow step');
    return;
  }
  if (/continue-on-error/.test(step)) {
    fail('ci: the gate:fidelity step carries continue-on-error; the Linux attribute test would not be required');
  }
  if (/\|\|\s*true/.test(step)) {
    fail('ci: the gate:fidelity step carries || true; the Linux attribute test would not be required');
  }
  if (/if:\s*runner\.os\s*!=\s*'Linux'/.test(step) || /if:\s*runner\.os\s*==\s*'macOS'/.test(step)) {
    fail('ci: the gate:fidelity step is skipped on Linux');
  }
  console.log('fidelity: CI runs gate:fidelity on both runner classes with no continue-on-error');
}

// ---------------------------------------------------------------------------------------------
// The shell never turns a document into text.
// ---------------------------------------------------------------------------------------------

/** Converting bytes to a string and back is where every normalisation in this gate would enter. */
function checkTheShellKeepsBytes() {
  const forbidden = /\bTextDecoder\b|\bTextEncoder\b|\.normalize\s*\(|String\.fromCharCode|\btoString\s*\(\s*['"]/;
  const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const name of readdirSync(shellDir)) {
    if (!/\.m?ts$/.test(name)) continue;
    const source = stripComments(readFileSync(join(shellDir, name), 'utf8'));
    const hit = forbidden.exec(source);
    if (hit) {
      fail(`shell: apps/desktop/src/shell/${name} converts document bytes to text (\`${hit[0]}\`); the shell passes bytes through`);
    }
  }
}

// ---------------------------------------------------------------------------------------------

checkTheGateIsWhatPnpmRuns();
checkCoreDoesNotReachDesktop();
checkCiRunsFidelityOnBothRunners();
checkCorpusPreconditions();
checkTheShellKeepsBytes();

const saveSource = readFileSync(savePathSource, 'utf8');
checkMarxy14CasesSurvived(saveSource);
checkLinuxXattrSkipIsNotSilent(saveSource);

const testStdout = runSavePathUnitTests();
checkLinuxXattrWasRequired(testStdout);

const savePath = buildSavePath('faithful');
if (savePath) {
  const changed = roundTrip(savePath, corpus, 'faithful');
  for (const name of changed) fail(`fidelity: ${name} does not survive open → save`);
  if (changed.length === 0) {
    console.log(`fidelity: ${corpus.length} corpus files survive open → save byte-identically, including ${HARD_FIXTURES.join(' and ')}`);
  }
  checkEditedDocumentIsSpliced(savePath);
  checkTheGateWouldCatchANormalisingSave();
}

if (failures.length > 0) {
  for (const message of failures) console.error(message);
  process.exit(1);
}
console.log('fidelity: ok');
