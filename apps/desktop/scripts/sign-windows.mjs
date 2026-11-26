// Tauri's Windows signCommand (tauri.windows.conf.json): called once per file the bundler signs,
// with that file's path. MARXY_SIGN picks the mode:
//   unset   leave the file unsigned (every local `pnpm bundle` stays as it was)
//   azure   Azure Artifact Signing (formerly Trusted Signing) through signtool and Microsoft's dlib;
//           needs MARXY_SIGN_ENDPOINT, MARXY_SIGN_ACCOUNT, MARXY_SIGN_PROFILE and an Azure sign-in
//           (`az login`, Connect-AzAccount, or AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID)
//   self    a certificate in CurrentUser\My: the one `pnpm sign:self-cert` made (subject
//           MARXY_SELF_SIGN_NAME, default "Marxy (self-signed)"), or any other named by
//           MARXY_SIGN_THUMBPRINT. Valid only where its .cer, copied next to the installer, is trusted.
// Any mode but unset fails the build when it cannot sign: a release must never ship unsigned quietly.
// Optional: MARXY_SIGNTOOL, MARXY_SIGN_DLIB (paths), MARXY_SIGN_TIMESTAMP (a URL, or "none" in self
// mode to sign offline), MARXY_SIGN_LOG (appends one line per signed file).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { findSelfCert, powershell, selfCertName } from './self-signed-cert.mjs';

const file = process.argv[2];
const mode = (process.env.MARXY_SIGN ?? '').trim().toLowerCase();

function fail(message) {
  console.error(`sign-windows: ${message}`);
  process.exit(1);
}

if (!file) fail('no file given (signCommand passes it as %1)');
if (!mode) {
  console.log(`sign-windows: MARXY_SIGN unset, ${file} left unsigned`);
  process.exit(0);
}
if (!existsSync(file)) fail(`${file} does not exist`);

function versionKey(name) {
  return name.split('.').map((part) => part.padStart(8, '0')).join('.');
}

// The newest x64 signtool in the Windows 10/11 SDK. The dlib needs 10.0.22621.755 or later and
// does not work with the 20348 SDK.
function findSigntool() {
  if (process.env.MARXY_SIGNTOOL) return process.env.MARXY_SIGNTOOL;
  const bin = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (!existsSync(bin)) return null;
  const versions = readdirSync(bin)
    .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name) && !name.startsWith('10.0.20348.'))
    .sort((a, b) => versionKey(b).localeCompare(versionKey(a)));
  for (const version of versions) {
    const candidate = join(bin, version, 'x64', 'signtool.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Where the Artifact Signing Client Tools installer (or a NuGet extract) put the x64 dlib. The
// installer's folder name has changed with the product's name, so search rather than hard-code it.
function findDlib() {
  if (process.env.MARXY_SIGN_DLIB) return process.env.MARXY_SIGN_DLIB;
  const roots = [
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft'),
    process.env.ProgramFiles ?? 'C:\\Program Files',
  ];
  const entriesOf = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const found = [];
  const walk = (dir, depth) => {
    for (const entry of entriesOf(dir)) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'azure.codesigning.dlib.dll') found.push(path);
      else if (entry.isDirectory() && depth > 0) walk(path, depth - 1);
    }
  };
  for (const root of roots) {
    for (const entry of entriesOf(root)) {
      if (entry.isDirectory() && /signing/i.test(entry.name)) walk(join(root, entry.name), 5);
    }
  }
  // An x86 dlib loads only in x86 signtool; prefer the x64 one, then the newest.
  found.sort((a, b) => {
    const x64 = Number(/[\\/]x64[\\/]/i.test(b)) - Number(/[\\/]x64[\\/]/i.test(a));
    return x64 || statSync(b).mtimeMs - statSync(a).mtimeMs;
  });
  return found.find((path) => !/[\\/]x86[\\/]/i.test(path)) ?? null;
}

function run(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8' });
  if (result.error) fail(`could not run ${tool}: ${result.error.message}`);
  return result;
}

const signtool = findSigntool();
if (!signtool || !existsSync(signtool)) fail('signtool.exe not found (install the Windows SDK or set MARXY_SIGNTOOL)');

let args;
let thumbprint;
let cleanup = () => {};
if (mode === 'azure') {
  const endpoint = process.env.MARXY_SIGN_ENDPOINT;
  const account = process.env.MARXY_SIGN_ACCOUNT;
  const profile = process.env.MARXY_SIGN_PROFILE;
  const missing = [
    ['MARXY_SIGN_ENDPOINT', endpoint],
    ['MARXY_SIGN_ACCOUNT', account],
    ['MARXY_SIGN_PROFILE', profile],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) fail(`MARXY_SIGN=azure needs ${missing.join(', ')}`);
  const dlib = findDlib();
  if (!dlib || !existsSync(dlib)) {
    fail('Azure.CodeSigning.Dlib.dll not found: `winget install -e --id Microsoft.Azure.ArtifactSigningClientTools`, or set MARXY_SIGN_DLIB');
  }
  const dir = mkdtempSync(join(tmpdir(), 'marxy-sign-'));
  cleanup = () => rmSync(dir, { recursive: true, force: true });
  const metadata = join(dir, 'metadata.json');
  // Only the credentials a desktop or CI run uses; the rest each cost a probe (managed identity
  // waits on a network timeout off Azure) and an interactive browser prompt mid-build is worse.
  writeFileSync(metadata, JSON.stringify({
    Endpoint: endpoint,
    CodeSigningAccountName: account,
    CertificateProfileName: profile,
    ExcludeCredentials: [
      'ManagedIdentityCredential',
      'WorkloadIdentityCredential',
      'SharedTokenCacheCredential',
      'VisualStudioCredential',
      'VisualStudioCodeCredential',
      'AzureDeveloperCliCredential',
      'InteractiveBrowserCredential',
    ],
  }, null, 2));
  // Artifact Signing certificates last three days: without a timestamp the signature dies with them.
  const timestamp = process.env.MARXY_SIGN_TIMESTAMP || 'http://timestamp.acs.microsoft.com';
  args = ['sign', '/v', '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256', '/d', 'Marxy',
    '/dlib', dlib, '/dmdf', metadata, file];
} else if (mode === 'self') {
  thumbprint = (process.env.MARXY_SIGN_THUMBPRINT ?? '').replace(/\s/g, '') || findSelfCert()?.thumbprint;
  if (!thumbprint) fail(`no certificate "CN=${selfCertName()}" in CurrentUser\\My: run \`pnpm sign:self-cert\` first`);
  const timestamp = process.env.MARXY_SIGN_TIMESTAMP || 'http://timestamp.digicert.com';
  args = ['sign', '/v', '/fd', 'SHA256', '/d', 'Marxy', '/s', 'My', '/sha1', thumbprint];
  if (timestamp !== 'none') args.push('/tr', timestamp, '/td', 'SHA256');
  args.push(file);
} else {
  fail(`unknown MARXY_SIGN "${mode}" (azure, self, or unset)`);
}

const signed = run(signtool, args);
cleanup();
if (signed.status !== 0) {
  process.stderr.write(signed.stdout + signed.stderr);
  fail(`signtool failed on ${file} (exit ${signed.status})`);
}

// A self-signed certificate passes the policy check only where it is trusted, so only Azure's is checked.
if (mode === 'azure') {
  const verified = run(signtool, ['verify', '/pa', file]);
  if (verified.status !== 0) {
    process.stderr.write(verified.stdout + verified.stderr);
    fail(`${file} was signed but does not verify`);
  }
}

// The installer travels with the public half of its certificate: a machine trusts the build by
// importing that .cer.
if (mode === 'self' && /-setup\.exe$/i.test(basename(file))) {
  const cer = join(dirname(file), 'marxy-self-signed.cer');
  const exported = powershell(
    `Export-Certificate -Cert "Cert:\\CurrentUser\\My\\$env:MARXY_EXPORT_THUMBPRINT" -FilePath $env:MARXY_EXPORT_PATH -Type CERT | Out-Null`,
    { MARXY_EXPORT_THUMBPRINT: thumbprint, MARXY_EXPORT_PATH: cer },
  );
  if (exported.status !== 0) fail(`could not export the certificate to ${cer}: ${exported.stderr}`);
  console.log(`sign-windows: wrote ${cer}`);
}

console.log(`sign-windows: signed ${file} (${mode})`);
if (process.env.MARXY_SIGN_LOG) appendFileSync(process.env.MARXY_SIGN_LOG, `${new Date().toISOString()} ${mode} ${file}\n`);
