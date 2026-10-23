param(
    [string]$BinaryPath,
    [string]$EnvironmentScript,
    [switch]$ProbeAuto,
    [string]$DiagnosticOutput
)
$ErrorActionPreference = 'Stop'
if (-not $EnvironmentScript -and (Test-Path -LiteralPath 'D:/build/toolchains/env-tauri-gnu.ps1' -PathType Leaf)) {
    $EnvironmentScript = 'D:/build/toolchains/env-tauri-gnu.ps1'
}
if ($EnvironmentScript) { . $EnvironmentScript }
if (-not $BinaryPath) {
    $targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $PSScriptRoot 'src-tauri/target' }
    $candidates = @(
        (Join-Path $targetRoot 'packaged/windows/pandolab-web-shell.exe'),
        (Join-Path $targetRoot 'x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe'),
        (Join-Path $targetRoot 'x86_64-pc-windows-msvc/debug/pandolab-web-shell.exe')
    )
    if (Test-Path -LiteralPath (Join-Path $targetRoot '.development-output-windows')) {
        $candidates = @((Join-Path $targetRoot 'packaged/windows/pandolab-web-shell.exe'))
    }
    $BinaryPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $BinaryPath) { throw 'Prototype EXE missing. Build the Windows prototype first.' }
if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "Prototype EXE missing: $BinaryPath. Build with pnpm --dir apps/web-shell build:windows."
}
$nativeBuildDir = Join-Path (Split-Path -Parent $BinaryPath) 'build'
if (Test-Path -LiteralPath $nativeBuildDir -PathType Container) {
    $loaderDirectory = Get-ChildItem -LiteralPath $nativeBuildDir -Directory -Filter 'webview2-com-sys-*' |
        ForEach-Object { Join-Path $_.FullName 'out/x64' } |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'WebView2Loader.dll') -PathType Leaf } |
        Select-Object -First 1
    if ($loaderDirectory) { $env:Path = "$loaderDirectory;$env:Path" }
}
$launchArgs = @()
if ($ProbeAuto) { $launchArgs += '--probe-auto' }
if ($DiagnosticOutput) {
    $launchArgs += '--diagnostic-output'
    $launchArgs += [System.IO.Path]::GetFullPath($DiagnosticOutput)
}
& $BinaryPath @launchArgs
