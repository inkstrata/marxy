// `pnpm sign:self-cert` makes (or reuses) the self-signed code-signing certificate that
// MARXY_SIGN=self signs with, in CurrentUser\My; `--remove` deletes it. Its private key cannot be
// exported, so it never leaves this machine: a second build machine makes its own.
// MARXY_SELF_SIGN_NAME sets the subject (default "Marxy (self-signed)"); it is the publisher name
// Windows shows, and must not contain a comma.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function selfCertName() {
  return process.env.MARXY_SELF_SIGN_NAME?.trim() || 'Marxy (self-signed)';
}

// Values reach PowerShell through the environment, never spliced into the command text.
export function powershell(command, env = {}) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const FIND = `Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert |
  Where-Object { $_.Subject -eq "CN=$env:MARXY_CERT_NAME" -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) } |
  Sort-Object NotAfter -Descending | Select-Object -First 1 |
  ForEach-Object { [pscustomobject]@{ thumbprint = $_.Thumbprint; subject = $_.Subject; notAfter = $_.NotAfter.ToString('yyyy-MM-dd') } } |
  ConvertTo-Json -Compress`;

export function findSelfCert(name = selfCertName()) {
  const result = powershell(FIND, { MARXY_CERT_NAME: name });
  if (result.status !== 0) throw new Error(`could not read CurrentUser\\My: ${result.stderr}`);
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function main() {
  const name = selfCertName();
  if (name.includes(',')) {
    console.error('self-signed-cert: MARXY_SELF_SIGN_NAME must not contain a comma');
    process.exit(1);
  }
  if (process.argv.includes('--remove')) {
    const removed = powershell(
      `$c = @(Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq "CN=$env:MARXY_CERT_NAME" }); $c | Remove-Item; $c.Count`,
      { MARXY_CERT_NAME: name },
    );
    if (removed.status !== 0) {
      console.error(removed.stderr);
      process.exit(1);
    }
    console.log(`self-signed-cert: removed ${removed.stdout.trim()} certificate(s) "CN=${name}" from CurrentUser\\My`);
    return;
  }
  const existing = findSelfCert(name);
  // Less than 30 days left: a fresh one, so a build is never signed by a certificate about to lapse.
  const soon = Date.now() + 30 * 24 * 3600 * 1000;
  if (existing && Date.parse(existing.notAfter) > soon) {
    console.log(`self-signed-cert: using ${existing.subject}, ${existing.thumbprint}, valid to ${existing.notAfter}`);
    return;
  }
  const created = powershell(
    `New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=$env:MARXY_CERT_NAME" ` +
      '-CertStoreLocation Cert:\\CurrentUser\\My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 ' +
      '-KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(5) | Out-Null',
    { MARXY_CERT_NAME: name },
  );
  if (created.status !== 0) {
    console.error(`self-signed-cert: could not create the certificate: ${created.stderr}`);
    process.exit(1);
  }
  const made = findSelfCert(name);
  console.log(`self-signed-cert: made ${made.subject}, ${made.thumbprint}, valid to ${made.notAfter}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
