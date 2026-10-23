param([ValidateSet('windows','android')][string]$Platform = 'windows')
$ErrorActionPreference = 'Stop'
$shellDirectory = $PSScriptRoot
if (Test-Path -LiteralPath 'D:/build/toolchains/env-tauri-gnu.ps1') { . 'D:/build/toolchains/env-tauri-gnu.ps1' }
Push-Location -LiteralPath $shellDirectory
try {
    & node dev.mjs --check-space
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $env:CARGO_INCREMENTAL = '1'
    $configuration = Get-Content -LiteralPath '../../config/library-data.json' -Raw | ConvertFrom-Json
    $env:PANDOLAB_LIBRARY_REPOSITORY = $configuration.repository
    # Keep the last offline executable before Cargo reuses its fixed debug path.
    if ($Platform -eq 'android') { & node packaged-artifacts.mjs --preserve-existing --android }
    else { & node packaged-artifacts.mjs --preserve-existing }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $cli = Join-Path $shellDirectory 'node_modules/@tauri-apps/cli/tauri.js'
    if ($Platform -eq 'windows') {
        & node $cli dev --config src-tauri/tauri.dev.json --target x86_64-pc-windows-gnu
        exit $LASTEXITCODE
    }
    & node src-tauri/sync-android.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
    $devices = & $adb devices
    $device = $devices | Where-Object { $_ -match '^\S+\s+device$' } | Select-Object -First 1
    if (-not $device) {
        $emulatorHome = $env:ANDROID_HOME
        if (-not (Test-Path -LiteralPath (Join-Path $emulatorHome 'emulator/emulator.exe')) -and (Test-Path -LiteralPath 'D:/Android/Sdk/emulator/emulator.exe')) { $emulatorHome = 'D:/Android/Sdk' }
        $emulator = Join-Path $emulatorHome 'emulator/emulator.exe'
        if (Test-Path -LiteralPath 'D:/Android/avd/Medium_Phone.ini') { $env:ANDROID_AVD_HOME = 'D:/Android/avd' }
        if (-not ((& $emulator -list-avds) -contains 'Medium_Phone')) { throw 'Existing Medium_Phone AVD is missing. No new image or AVD was created.' }
        $buildSdk = $env:ANDROID_HOME; $buildSdkRoot = $env:ANDROID_SDK_ROOT
        try {
            $env:ANDROID_HOME = $emulatorHome; $env:ANDROID_SDK_ROOT = $emulatorHome
            Start-Process -FilePath $emulator -ArgumentList @('-avd','Medium_Phone','-no-snapshot') -WindowStyle Hidden | Out-Null
        } finally { $env:ANDROID_HOME = $buildSdk; $env:ANDROID_SDK_ROOT = $buildSdkRoot }
        & $adb wait-for-device
        $devices = & $adb devices
        $device = $devices | Where-Object { $_ -match '^\S+\s+device$' } | Select-Object -First 1
    }
    if (-not $device) { throw 'No authorized Android device is available.' }
    $serial = ($device -split '\s+')[0]
    $architecture = (& $adb -s $serial shell getprop ro.product.cpu.abi).Trim()
    $target = switch ($architecture) { 'x86_64' { 'x86_64-linux-android' }; 'arm64-v8a' { 'aarch64-linux-android' }; default { throw "Unsupported development ABI: $architecture" } }
    if (-not ((& rustup target list --installed) -contains $target)) {
        & rustup target add $target
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & $adb -s $serial reverse tcp:4175 tcp:4175
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    try {
        $env:PANDOLAB_SHELL_DEVELOPMENT = '1'
        # Tauri matches its positional selector against the device name, not the
        # ADB serial. With one connected device, let it select that exact device.
        $connected = @((& $adb devices) | Where-Object { $_ -match '^\S+\s+device$' })
        if ($connected.Count -ne 1) { throw 'Keep one authorized Android device connected for this development session.' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $shellDirectory 'src-tauri/build-android.ps1') -Development -Watch -Abi $architecture -DeviceSerial $serial
        exit $LASTEXITCODE
    } finally { & $adb -s $serial reverse --remove tcp:4175 }
} finally { Pop-Location }
