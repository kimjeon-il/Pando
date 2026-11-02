param(
  [Parameter(Mandatory = $true)][string]$BinaryPath,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../build-native/e5-windows')
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'packaged-artifacts.mjs') "--verify-binary=$BinaryPath"
if ($LASTEXITCODE -ne 0) { throw 'E5 requires a source-verified Windows verification executable.' }
$executable = (Resolve-Path -LiteralPath $BinaryPath).Path
if ([IO.Path]::GetFileName($executable) -ne 'pandolab-web-shell.exe') {
  throw 'The verified Windows WebView executable name does not match.'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output) | Out-Null
$reportFile = Join-Path $output 'windows-review-probe.json'
if (Test-Path -LiteralPath $reportFile) {
  throw 'Refusing to overwrite an existing E5 verification report.'
}
$start = [DateTime]::UtcNow
$processInfo = [Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = $executable
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.RedirectStandardError = $true
$processInfo.RedirectStandardOutput = $true
$processInfo.ArgumentList.Add('--probe-auto')
$processInfo.ArgumentList.Add('--diagnostic-output')
$processInfo.ArgumentList.Add($reportFile)
$process = [Diagnostics.Process]::Start($processInfo)
$stderrTask = $process.StandardError.ReadToEndAsync()
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
try {
  while (-not $process.WaitForExit(1000)) {
    if ([DateTime]::UtcNow -gt $start.AddMinutes(5)) {
      $process.Kill($true)
      throw 'E5 Windows review did not finish its actual WebView2/C++ readiness probe.'
    }
  }
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  [IO.File]::WriteAllText((Join-Path $output 'windows-review-stderr.txt'), $stderr)
  [IO.File]::WriteAllText((Join-Path $output 'windows-review-stdout.txt'), $stdout)
  if (-not (Test-Path -LiteralPath $reportFile -PathType Leaf)) {
    throw "Windows E5 reviewer produced no diagnostic report (exit $($process.ExitCode)): $stderr"
  }
  if ((Get-Item -LiteralPath $reportFile).LastWriteTimeUtc -lt $start) {
    throw 'Windows E5 reviewer report is stale.'
  }
  $report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
  $observed = $report.observed
  if ($report.schema -ne 'pandolab-windows-review-probe' -or
      $report.phase -ne 'read-only-map-ready' -or
      -not $report.ok -or $process.ExitCode -ne 0 -or
      -not $observed.readOnly -or
      $observed.projection -ne 'flat' -or
      -not $observed.dataReady -or
      -not $observed.panelOpen -or
      -not $observed.hasReviewLoad -or
      -not $observed.editorDomAbsent -or
      $observed.canUndo -ne $false -or
      -not $observed.mutationBlocked) {
    throw "Windows E5 review GUI failed: $($report | ConvertTo-Json -Depth 8 -Compress)"
  }
  Write-Output "E5 Windows WebView2 reviewer PASS: $reportFile"
} finally {
  $process.Dispose()
}
