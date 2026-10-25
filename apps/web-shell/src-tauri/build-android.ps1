param(
    [switch]$Development,
    [switch]$Verification,
    [switch]$Watch,
    [ValidateSet('arm64-v8a','x86_64')][string]$Abi = 'arm64-v8a',
    [string]$DeviceSerial
)
$ErrorActionPreference = 'Stop'
if ($Development -and $Verification) { throw 'Development execution does not include verification tools.' }
$env:PANDOLAB_SHELL_VERIFICATION = if ($Verification) { '1' } else { '0' }
$env:PANDOLAB_SHELL_DEVELOPMENT = if ($Development) { '1' } else { '0' }
$env:CARGO_INCREMENTAL = if ($Development) { '1' } else { '0' }
$shellDirectory = Split-Path -Parent $PSScriptRoot
& node (Join-Path $shellDirectory 'dev.mjs') --check-space
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node (Join-Path $PSScriptRoot 'sync-android.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node (Join-Path $PSScriptRoot 'sync-android.mjs') --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (Test-Path -LiteralPath 'D:/build/toolchains/env-tauri-gnu.ps1' -PathType Leaf) {
    . 'D:/build/toolchains/env-tauri-gnu.ps1'
}
$targetDirectory = if ($env:CARGO_TARGET_DIR) { [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $PSScriptRoot 'target' }
. (Join-Path $PSScriptRoot '../../../tools/compiler-cache.ps1') -RepositoryRoot ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..')))
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

$cli = Join-Path $shellDirectory 'node_modules/@tauri-apps/cli/tauri.js'
$triple = if ($Abi -eq 'x86_64') { 'x86_64-linux-android' } else { 'aarch64-linux-android' }
$arch = if ($Abi -eq 'x86_64') { 'x86_64' } else { 'arm64' }
$rustTarget = if ($Abi -eq 'x86_64') { 'x86_64' } else { 'aarch64' }
$flavor = if ($Abi -eq 'x86_64') { 'X86_64' } else { 'Arm64' }
if ($Development) {
    $env:PANDOLAB_LIBRARY_REPOSITORY = (Get-Content -LiteralPath (Join-Path $shellDirectory '../../config/library-data.json') -Raw | ConvertFrom-Json).repository
    $nativeArguments = @($cli, 'android', 'dev', '--host', '127.0.0.1', '--config', 'src-tauri/tauri.dev.json')
    if (-not $Watch) { $nativeArguments += '--no-watch' }
} else {
    $nativeArguments = @($cli, 'android', 'build', '--debug', '--apk', '--target', $rustTarget, '--features', $(if ($Verification) { 'custom-protocol,verification' } else { 'custom-protocol' }))
    if ($Verification) { $nativeArguments += @('--config', 'src-tauri/tauri.verification.json') }
}
function Complete-Packaging {
    if ($Development) { return }
    $packagingArguments = @((Join-Path $shellDirectory 'packaged-artifacts.mjs'), '--android', '--record-android', "--abi=$arch")
    if ($Verification) { $packagingArguments += '--verification' }
    & node @packagingArguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$nativeExit = Invoke-LoggedBuild 'node' $nativeArguments $shellDirectory $nativeLog
if ($nativeExit -eq 0) { Complete-Packaging; exit 0 }

# The pinned CLI finishes Cargo before trying this privileged Windows symlink.
# Reuse that completed native output only for this specific packaging failure.
$nativeLibrary = Join-Path $targetDirectory "$triple/debug/libpandolab_web_shell_lib.so"
if (-not ((Get-Content -LiteralPath $nativeLog -Raw) -match 'Creation symbolic link is not allowed' -and
          (Test-Path -LiteralPath $nativeLibrary -PathType Leaf))) {
    exit $nativeExit
}
$jniDirectory = Join-Path $PSScriptRoot "gen/android/app/src/main/jniLibs/$Abi"
$jniLibrary = Join-Path $jniDirectory 'libpandolab_web_shell_lib.so'
New-Item -ItemType Directory -Force -Path $jniDirectory | Out-Null
if (Test-Path -LiteralPath $jniLibrary) {
    if (-not (Test-Path -LiteralPath $jniLibrary -PathType Leaf)) { throw "Unexpected non-file JNI output: $jniLibrary" }
    Remove-Item -LiteralPath $jniLibrary
}
New-Item -ItemType HardLink -Path $jniLibrary -Target $nativeLibrary | Out-Null
Write-Host "Packaging the completed $Abi library through a same-volume hard link (no administrator permission)."
$gradleExit = Invoke-LoggedBuild './gradlew.bat' @(
    ":app:assemble${flavor}Debug", '-x', ":app:rustBuild${flavor}Debug",
    "-PabiList=$Abi", "-ParchList=$arch", "-PtargetList=$rustTarget",
    '--no-daemon', '--max-workers=2', '--console=plain'
) (Join-Path $PSScriptRoot 'gen/android') $gradleLog
if ($gradleExit -ne 0) { exit $gradleExit }
if (-not $Development) { Complete-Packaging; exit 0 }
if (-not $DeviceSerial) { throw 'Development installation needs the selected ADB serial.' }
$apk = Join-Path $PSScriptRoot "gen/android/app/build/outputs/apk/$arch/debug/app-$arch-debug.apk"
& adb -s $DeviceSerial install -r -t $apk
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& adb -s $DeviceSerial shell am force-stop com.pandolab.webshell.prototype
& adb -s $DeviceSerial shell am start -n com.pandolab.webshell.prototype/.MainActivity
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not $Watch) { exit 0 }

# Tauri's watcher cannot start after its Windows symlink failure. Watch only
# canonical native sources, never Cargo/Gradle output or frontend files.
$watchers = @(); $identifiers = @()
try {
    foreach ($path in @($PSScriptRoot, (Join-Path $PSScriptRoot 'src'), (Join-Path $PSScriptRoot 'android'), (Join-Path $PSScriptRoot 'capabilities'), (Join-Path $PSScriptRoot 'permissions'))) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { continue }
        $watcher = [IO.FileSystemWatcher]::new($path)
        $watcher.IncludeSubdirectories = $path -ne $PSScriptRoot
        foreach ($eventName in @('Changed','Created','Deleted','Renamed')) {
            $identifier = "PandoLab.NativeDev.$PID.$($identifiers.Count)"
            Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier $identifier | Out-Null
            $identifiers += $identifier
        }
        $watcher.EnableRaisingEvents = $true; $watchers += $watcher
    }
    Write-Host 'Android development ready. Frontend reloads without Cargo; native source changes rebuild incrementally.'
    while ($true) {
        $event = Wait-Event -Timeout 1
        if (-not $event -or $identifiers -notcontains $event.SourceIdentifier) { continue }
        Start-Sleep -Milliseconds 250
        $pending = @(Get-Event | Where-Object { $identifiers -contains $_.SourceIdentifier })
        $nativeChanged = @($pending | Where-Object { $_.SourceEventArgs.FullPath -match '\.(rs|toml|lock|json|kt|kts|xml|properties)$' }).Count -gt 0
        $pending | Remove-Event
        if ($nativeChanged) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Development -Abi $Abi -DeviceSerial $DeviceSerial
            if ($LASTEXITCODE -ne 0) { Write-Host 'Native rebuild failed; fix the source and save again. Existing project data is preserved.' }
        }
    }
} finally {
    foreach ($identifier in $identifiers) { Unregister-Event -SourceIdentifier $identifier -ErrorAction SilentlyContinue; Get-Event -SourceIdentifier $identifier -ErrorAction SilentlyContinue | Remove-Event }
    foreach ($watcher in $watchers) { $watcher.Dispose() }
}
