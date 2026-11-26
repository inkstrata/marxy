# Builds Marxy's Windows installer from a ref, signs it, checks the signatures, keeps a copy, installs it for this
# user and launches it. Windows PowerShell 5.1 compatible. Run it as `pnpm work installer -- <arguments>`, which
# passes the workspace's paths; run alone it takes them from where this file is.
#   -Ref <branch or commit>   what to build (default main); main is merged in when the ref lacks it
#   -Sign self|azure|none     MARXY_SIGN for the build (default self; docs/development.md, Signing)
#   -NoInstall                stop once the copy is kept
#   -NoLaunch                 install without opening the app
[CmdletBinding()]
param(
  [string]$Ref = 'main',
  [ValidateSet('self', 'azure', 'none')][string]$Sign = 'self',
  [switch]$NoInstall,
  [switch]$NoLaunch,
  [string]$Repo = (Split-Path -Parent $PSScriptRoot),
  [string]$Worktree = '',
  [string]$OutRoot = ''
)
# Not 'Stop': under 5.1 a redirected run wraps git's and cargo's ordinary stderr chatter as errors,
# and Stop would end the script on the first one. Failures are caught by exit codes and -ErrorAction.
$ErrorActionPreference = 'Continue'
$workspace = Split-Path -Parent $Repo
if (-not $Worktree) { $Worktree = Join-Path $workspace 'worktrees\exe' }
if (-not $OutRoot) { $OutRoot = Join-Path $workspace 'builds' }

function Step([string]$message) { Write-Host "`n== $message" }
function Invoke-Git {
  & git.exe @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed ($LASTEXITCODE)" }
}
function IsAncestor([string]$a, [string]$b) {
  & git.exe -C $Repo merge-base --is-ancestor $a $b
  return $LASTEXITCODE -eq 0
}

# --- which source -------------------------------------------------------------------------------
Step 'Resolving the source'
& git.exe -C $Repo rev-parse --verify --quiet "$Ref^{commit}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "no such ref: $Ref" }
# Pinned once: other work moves these branches, and a build must be of the commits it reports.
$refFull = (& git.exe -C $Repo rev-parse "$Ref^{commit}").Trim()
$mainFull = (& git.exe -C $Repo rev-parse 'main^{commit}').Trim()
$refSha = $refFull.Substring(0, 7)
$mainSha = $mainFull.Substring(0, 7)
Write-Host "ref $Ref ($refSha), main $mainSha"

# --- the build worktree (this script's own; never edit it by hand) ---------------------------------
Step "Preparing $Worktree"
if (-not (Test-Path (Join-Path $Worktree '.git'))) {
  Invoke-Git -C $Repo worktree add --detach $Worktree main
}
$dirty = & git.exe -C $Worktree status --porcelain --untracked-files=no
if ($dirty) { throw "$Worktree has local changes; it belongs to this script. Inspect it, then clean it." }
& git.exe -C $Worktree rev-parse -q --verify MERGE_HEAD | Out-Null
if ($LASTEXITCODE -eq 0) { Invoke-Git -C $Worktree merge --abort }
Invoke-Git -C $Worktree checkout --quiet --detach $refFull
# A ref that already contains main needs no merge. Otherwise main comes in so the build has
# every fix already landed; the merge commit is detached and on no branch.
if (-not (IsAncestor $mainFull $refFull)) {
  & git.exe -C $Worktree merge --no-edit --no-ff -m "local build: merge main ($mainSha) into $Ref ($refSha)" $mainFull
  if ($LASTEXITCODE -ne 0) {
    & git.exe -C $Worktree merge --abort | Out-Null
    throw "$Ref does not merge cleanly with main; build main, or merge main into the branch first"
  }
}
$buildSha = (& git.exe -C $Worktree rev-parse --short HEAD).Trim()

Step 'Installing dependencies'
Push-Location $Worktree
try {
  & pnpm install --frozen-lockfile --offline
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'offline install failed; trying online'
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
  }

  # --- signing mode ----------------------------------------------------------------------------
  Step "Signing mode: $Sign"
  $selfThumbprint = $null
  switch ($Sign) {
    'self' {
      $env:MARXY_SIGN = 'self'
      & pnpm --filter '@marxy/desktop' -s sign:self-cert
      if ($LASTEXITCODE -ne 0) { throw 'sign:self-cert failed' }
      $name = if ($env:MARXY_SELF_SIGN_NAME) { $env:MARXY_SELF_SIGN_NAME.Trim() } else { 'Marxy (self-signed)' }
      $selfThumbprint = (Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object { $_.Subject -eq "CN=$name" -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) } |
        Sort-Object NotAfter -Descending | Select-Object -First 1).Thumbprint
      if ($env:MARXY_SIGN_THUMBPRINT) { $selfThumbprint = $env:MARXY_SIGN_THUMBPRINT -replace '\s', '' }
    }
    'azure' {
      foreach ($v in 'MARXY_SIGN_ENDPOINT', 'MARXY_SIGN_ACCOUNT', 'MARXY_SIGN_PROFILE') {
        if (-not [Environment]::GetEnvironmentVariable($v)) { throw "-Sign azure needs $v set" }
      }
      $env:MARXY_SIGN = 'azure'
    }
    'none' { Remove-Item Env:MARXY_SIGN -ErrorAction SilentlyContinue }
  }

  # --- build ------------------------------------------------------------------------------------
  Step 'Building the installer (a cold Rust release build takes a while)'
  $started = Get-Date
  & pnpm --filter '@marxy/desktop' bundle
  if ($LASTEXITCODE -ne 0) { throw 'pnpm bundle failed' }
} finally {
  Pop-Location
}

$nsis = Join-Path $Worktree 'apps\desktop\src-tauri\target\release\bundle\nsis'
$setup = Get-ChildItem $nsis -Filter '*-setup.exe' | Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-5) } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "no new installer in $nsis" }

# --- verify -----------------------------------------------------------------------------------------
# Self-signed reads UnknownError until this machine trusts the certificate; HashMismatch or
# NotSigned is always a failure.
function Check-Signature([string]$path) {
  $sig = Get-AuthenticodeSignature $path
  $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '-' }
  Write-Host ("{0,-13} {1}  {2}" -f $sig.Status, $signer, $path)
  switch ($Sign) {
    'none' { if ($sig.Status -ne 'NotSigned') { throw "expected unsigned: $path" } }
    'azure' { if ($sig.Status -ne 'Valid') { throw "not Valid: $path" } }
    'self' {
      if ($sig.Status -notin 'Valid', 'UnknownError') { throw "bad signature ($($sig.Status)): $path" }
      if ($selfThumbprint -and $sig.SignerCertificate.Thumbprint -ne $selfThumbprint) { throw "signed by another certificate: $path" }
      if ($env:MARXY_SIGN_TIMESTAMP -ne 'none' -and -not $sig.TimeStamperCertificate) { throw "no timestamp: $path" }
    }
  }
  return $sig.Status
}
Step 'Checking the installer'
$setupStatus = Check-Signature $setup.FullName

# --- keep a copy --------------------------------------------------------------------------------------
$out = Join-Path $OutRoot ("{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmm'), $buildSha)
New-Item -ItemType Directory -Force $out -ErrorAction Stop | Out-Null
Copy-Item $setup.FullName $out -ErrorAction Stop
$cer = Join-Path $nsis 'marxy-self-signed.cer'
if ($Sign -eq 'self' -and (Test-Path $cer)) { Copy-Item $cer $out -ErrorAction Stop }
@(
  "ref:     $Ref ($refSha)"
  "main:  $mainSha"
  "built:   $buildSha$(if ($buildSha -ne $refSha) { ' (local merge of main into the ref)' })"
  "signing: $Sign ($setupStatus)"
  "date:    $(Get-Date -Format o)"
) | Set-Content -Encoding ascii (Join-Path $out 'BUILD.txt') -ErrorAction Stop
Write-Host "copied to $out"

# --- install and launch -------------------------------------------------------------------------------
if (-not $NoInstall) {
  Step 'Installing for this user'
  $uninstall = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'Marxy' } | Select-Object -First 1
  $installDir = if ($uninstall -and $uninstall.InstallLocation) { $uninstall.InstallLocation.Trim('"') } else { Join-Path $env:LOCALAPPDATA 'Marxy' }
  # Only the installed copy: dev and check builds run from target folders and are left alone. A
  # polite close first, so the app saves its layout; a kill only if it does not exit.
  $running = Get-Process marxy -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir, 'OrdinalIgnoreCase') }
  foreach ($p in $running) { [void]$p.CloseMainWindow() }
  foreach ($p in $running) { if (-not $p.WaitForExit(8000)) { Stop-Process -Id $p.Id -Force } }
  $proc = Start-Process $setup.FullName -ArgumentList '/S' -Wait -PassThru -ErrorAction Stop
  if ($proc.ExitCode -ne 0) { throw "installer exited $($proc.ExitCode)" }
  $uninstall = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall |
    ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'Marxy' } | Select-Object -First 1
  if ($uninstall -and $uninstall.InstallLocation) { $installDir = $uninstall.InstallLocation.Trim('"') }
  $exe = Join-Path $installDir 'marxy.exe'
  if (-not (Test-Path $exe)) { throw "installed, but no $exe" }
  Step 'Checking the installed app'
  [void](Check-Signature $exe)
  if (-not $NoLaunch) {
    Start-Process $exe
    Write-Host "launched $exe"
  }
}

Step 'Done'
Write-Host "installer: $(Join-Path $out $setup.Name)"
if ($Sign -eq 'self' -and $setupStatus -eq 'UnknownError') {
  Write-Host 'This machine does not trust the self-signed certificate yet (signature reads UnknownError).'
  Write-Host 'To trust it, run these yourself, once (Windows asks to confirm the first):'
  Write-Host "  Import-Certificate -FilePath '$(Join-Path $out 'marxy-self-signed.cer')' -CertStoreLocation Cert:\CurrentUser\Root"
  Write-Host "  Import-Certificate -FilePath '$(Join-Path $out 'marxy-self-signed.cer')' -CertStoreLocation Cert:\CurrentUser\TrustedPublisher"
}
