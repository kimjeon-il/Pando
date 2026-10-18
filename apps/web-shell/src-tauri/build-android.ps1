param()
$ErrorActionPreference = 'Stop'
$shellDirectory = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot 'sync-android.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node (Join-Path $PSScriptRoot 'sync-android.mjs') --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (Test-Path -LiteralPath 'D:/build/toolchains/env-tauri-gnu.ps1' -PathType Leaf) {
    . 'D:/build/toolchains/env-tauri-gnu.ps1'
}
$targetDirectory = if ($env:CARGO_TARGET_DIR) { [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $PSScriptRoot 'target' }
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$nativeLog = Join-Path $targetDirectory 'android-native-build.log'
$gradleLog = Join-Path $targetDirectory 'android-gradle-build.log'

function Invoke-LoggedBuild([string]$Executable, [string[]]$BuildArguments, [string]$Directory, [string]$Log) {
    # Native compiler diagnostics on stderr are normal, including in Windows PS5.
    $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $Directory
    try {
        Get-Command $Executable -ErrorAction Stop | Out-Null
        & $Executable @BuildArguments 2>&1 | Tee-Object -FilePath $Log | ForEach-Object { Write-Host $_ }
        return $LASTEXITCODE
    } finally { Pop-Location }
}

$nativeExit = Invoke-LoggedBuild 'node' @(
    (Join-Path $shellDirectory 'node_modules/@tauri-apps/cli/tauri.js'),
    'android', 'build', '--debug', '--apk', '--target', 'aarch64'
) $shellDirectory $nativeLog
if ($nativeExit -eq 0) { exit 0 }

# The pinned CLI finishes Cargo before trying this privileged Windows symlink.
# Reuse that completed native output only for this specific packaging failure.
$nativeLibrary = Join-Path $targetDirectory 'aarch64-linux-android/debug/libpandolab_web_shell_lib.so'
if (-not ((Get-Content -LiteralPath $nativeLog -Raw) -match 'Creation symbolic link is not allowed' -and
          (Test-Path -LiteralPath $nativeLibrary -PathType Leaf))) {
    exit $nativeExit
}
$jniDirectory = Join-Path $PSScriptRoot 'gen/android/app/src/main/jniLibs/arm64-v8a'
$jniLibrary = Join-Path $jniDirectory 'libpandolab_web_shell_lib.so'
New-Item -ItemType Directory -Force -Path $jniDirectory | Out-Null
if (Test-Path -LiteralPath $jniLibrary) {
    if (-not (Test-Path -LiteralPath $jniLibrary -PathType Leaf)) { throw "Unexpected non-file JNI output: $jniLibrary" }
    Remove-Item -LiteralPath $jniLibrary -Force
}
New-Item -ItemType HardLink -Path $jniLibrary -Target $nativeLibrary | Out-Null
Write-Host 'Packaging the completed arm64 library through a same-volume hard link (no administrator permission).'
$gradleExit = Invoke-LoggedBuild './gradlew.bat' @(
    ':app:assembleArm64Debug', '-x', ':app:rustBuildArm64Debug',
    '-PabiList=arm64-v8a', '-ParchList=arm64', '-PtargetList=aarch64',
    '--no-daemon', '--max-workers=2', '--console=plain'
) (Join-Path $PSScriptRoot 'gen/android') $gradleLog
exit $gradleExit
