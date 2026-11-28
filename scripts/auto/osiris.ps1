<#
.SYNOPSIS
  Register Marxy's standing automation on Osiris in Task Scheduler, as the current user, no elevation. Idempotent.

.DESCRIPTION
  "Marxy - tick"     every 30 minutes, all day: node scripts/auto/auto.mjs tick (at most 25 minutes per run).
  "Marxy - nightly"  daily 05:15, after the night's agents: node scripts/auto/auto.mjs nightly (at most 4 hours).
  "Marxy - clean"    Sunday 04:30: node scripts/auto/auto.mjs clean (at most 2 hours): old worktrees, branches and logs.
  The nightly and clean tasks wait until the owner has been idle for 10 minutes (up to 8 hours); all run at below-normal priority.

  Both run hidden through conhost --headless, from the main checkout (two folders above this script), with
  stdout and stderr appended to ~\.local\state\fleet\marxy\logs\<tick|nightly>.log. Same pattern as
  command-center's machines\osiris\tasks.ps1. marxy/scripts/auto/osiris.ps1

.PARAMETER Status  Show the tasks. Changes nothing.
.PARAMETER Remove  Unregister the tasks.
#>
[CmdletBinding()]
param([switch]$Status, [switch]$Remove)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$user = "$env:USERDOMAIN\$env:USERNAME"
$logs = Join-Path $HOME '.local\state\fleet\marxy\logs'

$tick    = 'Marxy - tick'
$nightly = 'Marxy - nightly'
$clean   = 'Marxy - clean'

function Show-Status {
    foreach ($n in $tick, $nightly, $clean) {
        $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
        if (-not $t) { Write-Host ("{0,-16} not registered" -f $n); continue }
        $i = $t | Get-ScheduledTaskInfo
        Write-Host ("{0,-16} {1,-8} last run {2} (result {3}), next {4}" -f $n, $t.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime)
    }
}

if ($Status) { Show-Status; return }

if ($Remove) {
    foreach ($n in $tick, $nightly, $clean) {
        if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $n -Confirm:$false
            Write-Host "removed $n"
        }
    }
    return
}

$node = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

# conhost has no redirection of its own, so cmd.exe does it: /s keeps the outer quotes from being read as part of the command.
function New-MarxyAction([string]$command) {
    $log = Join-Path $logs "$command.log"
    $script = Join-Path $repo 'scripts\auto\auto.mjs'
    $line = '--headless cmd.exe /d /s /c ""{0}" "{1}" {2} >> "{3}" 2>&1"' -f $node, $script, $command, $log
    New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $repo -Argument $line
}
function New-MarxySettings([TimeSpan]$limit, [switch]$WhenIdle) {
    # Priority 7 is below normal: a build never competes with a game.
    $set = @{ ExecutionTimeLimit = $limit; MultipleInstances = 'IgnoreNew'; Priority = 7 }
    if ($WhenIdle) {
        # Windows itself holds the task until the owner has been away ten minutes, and waits up to eight hours for
        # that. It is not stopped when the owner returns: device.mjs checks between its own steps.
        $set += @{ RunOnlyIfIdle = $true; IdleDuration = (New-TimeSpan -Minutes 10); IdleWaitTimeout = (New-TimeSpan -Hours 8); DontStopOnIdleEnd = $true }
    }
    New-ScheduledTaskSettingsSet @set -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
}

$tickTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $tick -Action (New-MarxyAction 'tick') -Trigger $tickTrigger -Principal $principal `
    -Settings (New-MarxySettings (New-TimeSpan -Minutes 25)) -Force `
    -Description 'Marxy automation tick, every 30 minutes. marxy/scripts/auto/osiris.ps1' | Out-Null
Write-Host "registered $tick"

$nightTrigger = New-ScheduledTaskTrigger -Daily -At '05:15'
Register-ScheduledTask -TaskName $nightly -Action (New-MarxyAction 'nightly') -Trigger $nightTrigger -Principal $principal `
    -Settings (New-MarxySettings (New-TimeSpan -Hours 4) -WhenIdle) -Force `
    -Description 'Marxy nightly full verify and installer check on origin/main. marxy/scripts/auto/osiris.ps1' | Out-Null
Write-Host "registered $nightly"

$cleanTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:30'
Register-ScheduledTask -TaskName $clean -Action (New-MarxyAction 'clean') -Trigger $cleanTrigger -Principal $principal `
    -Settings (New-MarxySettings (New-TimeSpan -Hours 2) -WhenIdle) -Force `
    -Description 'Marxy weekly cleanup of old worktrees, branches and logs. marxy/scripts/auto/osiris.ps1' | Out-Null
Write-Host "registered $clean"
