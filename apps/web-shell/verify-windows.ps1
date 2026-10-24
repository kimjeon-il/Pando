param(
    [Parameter(Mandatory = $true)][string]$BinaryPath,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../build-native/web-shell'),
    [string]$EnvironmentScript
)
$ErrorActionPreference = 'Stop'

if ($EnvironmentScript) { . $EnvironmentScript }
$resolvedBinary = (Resolve-Path -LiteralPath $BinaryPath).Path
if ([IO.Path]::GetFileName($resolvedBinary) -ne 'pandolab-web-shell.exe') {
    throw 'Only the new trial application may be executed by this check.'
}
$nativeBuildDir = Join-Path (Split-Path -Parent $resolvedBinary) 'build'
if (Test-Path -LiteralPath $nativeBuildDir -PathType Container) {
    $loaderDirectory = Get-ChildItem -LiteralPath $nativeBuildDir -Directory -Filter 'webview2-com-sys-*' |
        ForEach-Object { Join-Path $_.FullName 'out/x64' } |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'WebView2Loader.dll') -PathType Leaf } |
        Select-Object -First 1
    if ($loaderDirectory) { $env:Path = "$loaderDirectory;$env:Path" }
}
& node (Join-Path $PSScriptRoot 'packaged-artifacts.mjs') "--verify-binary=$BinaryPath"
if ($LASTEXITCODE -ne 0) { throw 'The requested executable is not a verification build.' }
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
foreach ($phase in @('write', 'reopen')) {
    $reportPath = Join-Path $resolvedOutput "windows-$phase.json"
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $resolvedBinary
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.ArgumentList.Add('--probe-auto')
    $start.ArgumentList.Add('--diagnostic-output')
    $start.ArgumentList.Add($reportPath)
    $process = [Diagnostics.Process]::Start($start)
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(120)
        while (-not $process.WaitForExit(1000)) {
            if ([DateTime]::UtcNow -gt $deadline) {
                $process.Kill($true)
                throw "Trial app timeout during $phase; only the launched process tree was stopped."
            }
        }
        if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) { throw "No fresh $phase report was written (exit $($process.ExitCode))." }
        $reportFile = Get-Item -LiteralPath $reportPath
        if ($reportFile.LastWriteTimeUtc -lt $deadline.AddSeconds(-120)) { throw "The $phase report is stale." }
        $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        if (-not $report.ok -or $report.phase -ne $phase -or $process.ExitCode -ne 0) {
            throw "Trial $phase failed: $($report | ConvertTo-Json -Depth 8 -Compress)"
        }
        Write-Output "Windows $phase PASS: $reportPath"
    } finally { $process.Dispose() }
}
Write-Output 'The new Windows WebView app passed both processes. Android and native file pickers are separate checks.'
