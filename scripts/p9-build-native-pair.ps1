param(
 [Parameter(Mandatory=$true)][string]$BaselineRoot,
 [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
$sourceRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$baseline=(Resolve-Path -LiteralPath $BaselineRoot).Path
$baselineSha='8e22982616e3c9ba43eeb84baec17cd886267cfa'
if ((git -C $baseline rev-parse HEAD) -ne $baselineSha) { throw 'Wrong P9 baseline' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Use a fresh test runtime output' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$output=(Resolve-Path -LiteralPath $OutputDirectory).Path
$overlay=@('native/tests/ui_tests.cpp','native/tests/native_performance_probe.h')
$hashes=@{}
foreach ($relative in $overlay) {
 Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination (Join-Path $baseline $relative)
 $candidateHash=(Get-FileHash -LiteralPath (Join-Path $sourceRoot $relative)).Hash
 $baselineHash=(Get-FileHash -LiteralPath (Join-Path $baseline $relative)).Hash
 if ($candidateHash -ne $baselineHash) { throw "Measurement overlay mismatch: $relative" }
 $hashes[$relative]=$candidateHash
}
$baselineChanges=@(git -C $baseline diff --name-only)
if (@($baselineChanges | Where-Object { $_ -notin $overlay }).Count) { throw 'Baseline product sources were modified' }
$receipt=[ordered]@{
 baselineSourceSha=$baselineSha; candidateSourceSha=(git -C $sourceRoot rev-parse HEAD)
 measurementOverlaySha256=$hashes; baselineChangedFiles=$baselineChanges
 scope='Remote build of test executables and their shared Qt runtime; no product packaging or acceptance claim'
 binaries=@{}
}
$preset='pando-native-qt-ci-windows'
foreach ($side in @('baseline','candidate')) {
 $root=if ($side -eq 'baseline') { $baseline } else { $sourceRoot }
 Push-Location $root
 try {
  cmake --preset $preset "-DCMAKE_TOOLCHAIN_FILE=$env:VCPKG_INSTALLATION_ROOT/scripts/buildsystems/vcpkg.cmake" 2>&1 | Tee-Object (Join-Path $sourceRoot "build-native/p9/qt-pair-$side-configure.log")
  if ($LASTEXITCODE -ne 0) { throw "$side configure failed" }
  cmake --build --preset $preset --target ui_tests 2>&1 | Tee-Object (Join-Path $sourceRoot "build-native/p9/qt-pair-$side-build.log")
  if ($LASTEXITCODE -ne 0) { throw "$side test executable build failed" }
  $binary=Join-Path $root "build-native/p3/$preset/native/app/Release/ui_tests.exe"
  $target=Join-Path $output "$side-ui_tests.exe"
  Copy-Item -LiteralPath $binary -Destination $target
  $receipt.binaries[$side]=@{file=[IO.Path]::GetFileName($target);sha256=(Get-FileHash -LiteralPath $target).Hash}
 } finally { Pop-Location }
}
$deploy=(Get-Command windeployqt.exe -CommandType Application).Source
& $deploy --release --no-translations --qmldir (Join-Path $sourceRoot 'native/ui') --dir $output (Join-Path $output 'candidate-ui_tests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Qt test runtime staging failed' }
$zlib=Join-Path $env:VCPKG_INSTALLATION_ROOT 'installed/x64-windows/bin/zlib1.dll'
Copy-Item -LiteralPath $zlib -Destination $output
$receipt.qtVersion=(& (Join-Path (Split-Path $deploy -Parent) 'qmake.exe') -query QT_VERSION)
$receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'source-identity.json') -Encoding utf8
