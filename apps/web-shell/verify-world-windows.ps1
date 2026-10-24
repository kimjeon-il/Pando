param(
  [Parameter(Mandatory = $true)][string]$BinaryPath,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../build-native/web-shell')
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'packaged-artifacts.mjs') "--verify-binary=$BinaryPath"
if ($LASTEXITCODE -ne 0) { throw 'The requested executable is not a verification build.' }

$executable = (Resolve-Path -LiteralPath $BinaryPath).Path
if ([IO.Path]::GetFileName($executable) -ne 'pandolab-web-shell.exe') {
  throw 'Only the trial PandoLab WebView app is allowed.'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output) | Out-Null
$reportFile = Join-Path $output 'world-windows.json'
$startedAt = [DateTime]::UtcNow
$processInfo = [Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = $executable
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.ArgumentList.Add('--probe-auto')
$processInfo.ArgumentList.Add('--diagnostic-output')
$processInfo.ArgumentList.Add($reportFile)
$process = [Diagnostics.Process]::Start($processInfo)
try {
  while (-not $process.WaitForExit(1000)) {
    if ([DateTime]::UtcNow -gt $startedAt.AddMinutes(5)) {
      $process.Kill($true)
      throw 'Full-world Windows app did not finish canonical readiness in the allowed interval.'
    }
  }
  if (-not (Test-Path -LiteralPath $reportFile -PathType Leaf)) {
    throw "No full-world native report was written (exit $($process.ExitCode))."
  }
  if ((Get-Item -LiteralPath $reportFile).LastWriteTimeUtc -lt $startedAt) {
    throw 'The full-world report is stale.'
  }
  $report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
  if ($report.schema -ne 'pandolab-web-shell-world-probe' -or
      $report.phase -ne 'canonical-ready' -or
      -not $report.ok -or $process.ExitCode -ne 0 -or
      $report.observed.sourceCountryCount -ne 258 -or
      $report.observed.countryCount -ne 254 -or
      $report.observed.sovereignRootCount -ne 207) {
    throw "Windows full-world test failed: $($report | ConvertTo-Json -Depth 9 -Compress)"
  }
  Write-Output "Full-world WebView test PASS: $reportFile"
} finally {
  $process.Dispose()
}
