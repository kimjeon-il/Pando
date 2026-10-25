param(
  [Parameter(Mandatory = $true)][string]$BinaryPath,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../build-native/web-shell'),
  [ValidateRange(1000, 30000)][int]$HoldAfterReadyMs = 12000
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'packaged-artifacts.mjs') "--verify-binary=$BinaryPath"
if ($LASTEXITCODE -ne 0) { throw 'The requested executable is not a verification build.' }

$exe = (Resolve-Path -LiteralPath $BinaryPath).Path
if ([IO.Path]::GetFileName($exe) -ne 'pandolab-web-shell.exe') {
  throw 'Only the PandoLab trial WebView executable can be benchmarked.'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output) | Out-Null
$destination = Join-Path $output 'paired-startup-memory.json'
$profiles = @('immediate','deferred','deferred','immediate','immediate','deferred')
$results = [Collections.Generic.List[object]]::new()

function Read-ProcessTreeMemory([int]$RootPid, [int64]$ElapsedMs) {
  # Query only the process graph rooted at the exact spawned trial EXE.
  # PSS is not available from these Windows APIs. Report private committed
  # bytes and summed working sets separately; summed working sets double-count
  # shared resident pages and cannot be equated to physical RAM or PSS.
  $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $ids = [Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootPid)
  do {
    $again = $false
    foreach ($item in $all) {
      if ($ids.Contains([int]$item.ParentProcessId)) {
        if ($ids.Add([int]$item.ProcessId)) { $again = $true }
      }
    }
  } while ($again)
  [long]$private = 0
  [long]$working = 0
  [int]$count = 0
  $processBreakdown = [Collections.Generic.List[object]]::new()
  foreach ($ownedPid in $ids) {
    try {
      $p = Get-Process -Id $ownedPid -ErrorAction Stop
      $private += [long]$p.PrivateMemorySize64
      $working += [long]$p.WorkingSet64
      $count++
      $processBreakdown.Add([pscustomobject]@{
        id = $ownedPid
        name = $p.ProcessName
        privateCommitMiB = [math]::Round([double]$p.PrivateMemorySize64 / 1MB, 2)
        workingSetMiB = [math]::Round([double]$p.WorkingSet64 / 1MB, 2)
      })
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
      # The exact process exited between snapshots.
    }
  }
  return [pscustomobject]@{
    elapsedMs = $ElapsedMs
    processCount = $count
    privateCommitMiB = [math]::Round($private / 1MB, 2)
    summedWorkingSetMiB = [math]::Round($working / 1MB, 2)
    processBreakdown = @($processBreakdown | Sort-Object privateCommitMiB -Descending)
  }
}

function Median([double[]]$Items) {
  $values = @($Items | Sort-Object)
  if ($values.Count -eq 0) { return $null }
  $mid = [int][math]::Floor($values.Count / 2)
  if ($values.Count % 2 -eq 1) { return [double]$values[$mid] }
  return ([double]$values[$mid - 1] + [double]$values[$mid]) / 2
}

for ($index = 0; $index -lt $profiles.Count; $index++) {
  $mode = $profiles[$index]
  $number = $index + 1
  $profileId = ('pair-{0:D2}-{1}' -f $number, $mode)
  $reportFile = Join-Path $output ("world-$profileId.json")
  if (Test-Path -LiteralPath $reportFile) {
    throw "Diagnostic result already exists; refusing to reuse it: $reportFile"
  }
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $exe
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.ArgumentList.Add('--probe-auto')
  $info.ArgumentList.Add('--probe-hold-ms')
  $info.ArgumentList.Add([string]$HoldAfterReadyMs)
  $info.ArgumentList.Add('--probe-profile-id')
  $info.ArgumentList.Add($profileId)
  if ($mode -eq 'immediate') { $info.ArgumentList.Add('--probe-physical-immediate') }
  $info.ArgumentList.Add('--diagnostic-output')
  $info.ArgumentList.Add($reportFile)

  $startUtc = [DateTime]::UtcNow
  $process = [Diagnostics.Process]::Start($info)
  if (-not $process) { throw "Trial process did not start for $mode" }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $samples = [Collections.Generic.List[object]]::new()
  try {
    while (-not $process.HasExited) {
      $samples.Add((Read-ProcessTreeMemory -RootPid $process.Id -ElapsedMs $timer.ElapsedMilliseconds))
      if ($timer.ElapsedMilliseconds -gt 210000) {
        $process.Kill($true)
        throw "Timed out while benchmarking $mode"
      }
      [void]$process.WaitForExit(750)
    }
    $timer.Stop()
    $exitCode = $process.ExitCode
    if (-not (Test-Path -LiteralPath $reportFile -PathType Leaf)) {
      throw "Missing native world report for $mode, exit $exitCode"
    }
    if ((Get-Item -LiteralPath $reportFile).LastWriteTimeUtc -lt $startUtc) {
      throw "Stale report for $mode"
    }
    $report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
    if ($exitCode -ne 0 -or -not $report.ok -or
        $report.schema -ne 'pandolab-web-shell-world-probe' -or
        $report.phase -ne 'canonical-ready' -or
        $report.observed.renderer -ne 'webgl2' -or
        $report.observed.sourceCountryCount -ne 258 -or
        $report.observed.countryCount -ne 254 -or
        $report.observed.sovereignRootCount -ne 207) {
      throw "Canonical world failed in $mode : $($report | ConvertTo-Json -Depth 8 -Compress)"
    }
    $expectedDeferred = $mode -eq 'deferred'
    if ([bool]$report.observed.physicalDeferredUntilReady -ne $expectedDeferred) {
      throw "Physical startup mode was not applied: $mode"
    }
    $valid = @($samples | Where-Object { $_.processCount -gt 0 })
    if ($valid.Count -lt 5) {
      throw "Insufficient owned-process memory samples in $mode"
    }
    $late = @($valid | Select-Object -Last 4)
    $record = [pscustomobject]@{
      run = $number
      mode = $mode
      startupReadyMs = [math]::Round([double]$report.observed.readyMs, 2)
      canonicalGeometryReceivedMs = [math]::Round([double]$report.observed.canonicalGeometryReceivedMs, 2)
      canonicalMeshReceivedMs = [math]::Round([double]$report.observed.canonicalMeshReceivedMs, 2)
      totalProcessMs = [math]::Round($timer.Elapsed.TotalMilliseconds, 2)
      physicalLoadStartedMs = $report.observed.physicalLoadStartedMs
      physicalManifestLoadFinishedMs = $report.observed.physicalManifestLoadFinishedMs
      physicalManifestLoadResults = $report.observed.physicalManifestLoadResults
      peakPrivateCommitMiB = [math]::Round([double](($valid | Measure-Object privateCommitMiB -Maximum).Maximum), 2)
      peakSummedWorkingSetMiB = [math]::Round([double](($valid | Measure-Object summedWorkingSetMiB -Maximum).Maximum), 2)
      latePrivateCommitMiB = [math]::Round([double](($late | Measure-Object privateCommitMiB -Average).Average), 2)
      lateSummedWorkingSetMiB = [math]::Round([double](($late | Measure-Object summedWorkingSetMiB -Average).Average), 2)
      maximumProcessCount = [int](($valid | Measure-Object processCount -Maximum).Maximum)
      sampleCount = $valid.Count
      lateProcessBreakdown = @($valid[-1].processBreakdown)
      report = [IO.Path]::GetFileName($reportFile)
    }
    $results.Add($record)
    Write-Output ("PAIR_WINDOWS_{0}_PASS {1}" -f $mode.ToUpperInvariant(), ($record | ConvertTo-Json -Depth 4 -Compress))
  } finally {
    if (-not $process.HasExited) { $process.Kill($true) }
    $process.Dispose()
  }
}
$groups = [ordered]@{}
foreach ($mode in @('immediate','deferred')) {
  $rows = @($results | Where-Object { $_.mode -eq $mode })
  $groups[$mode] = [ordered]@{
    count = $rows.Count
    medianStartupReadyMs = [math]::Round((Median ([double[]]@($rows | ForEach-Object { $_.startupReadyMs }))), 2)
    medianPeakPrivateCommitMiB = [math]::Round((Median ([double[]]@($rows | ForEach-Object { $_.peakPrivateCommitMiB }))), 2)
    medianPeakSummedWorkingSetMiB = [math]::Round((Median ([double[]]@($rows | ForEach-Object { $_.peakSummedWorkingSetMiB }))), 2)
    medianLatePrivateCommitMiB = [math]::Round((Median ([double[]]@($rows | ForEach-Object { $_.latePrivateCommitMiB }))), 2)
    medianLateSummedWorkingSetMiB = [math]::Round((Median ([double[]]@($rows | ForEach-Object { $_.lateSummedWorkingSetMiB }))), 2)
  }
}
$measurement = [ordered]@{
  schema = 'pandolab-windows-webview-paired-startup-memory'
  version = 1
  capturedUtc = [DateTime]::UtcNow.ToString('o')
  sequence = $profiles
  readyHoldMs = $HoldAfterReadyMs
  notes = @(
    'Both A/B paths run from the same executable and same pinned world payload on one Windows runner.',
    'Every launch uses a distinct diagnostic-only WebView2 data directory; no user cache is deleted.',
    'PrivateMemorySize64 is process private committed memory, not resident physical RAM.',
    'Summed WorkingSet64 counts shared pages in multiple processes and is not PSS.',
    'Peak and late values sum the test process and its observed descendant process tree.',
    'Values are from three trials per mode; no guaranteed improvement threshold is imposed.',
    'No Android or Qt application was started.'
  )
  summary = $groups
  runs = $results.ToArray()
}
$measurement | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $destination -Encoding utf8
Write-Output ("PAIRED_WINDOWS_MEMORY_REPORT {0}" -f $destination)
