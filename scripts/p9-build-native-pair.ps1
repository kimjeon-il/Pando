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
 compileParallelism='MSBuild jobs=2, MSVC /MP2 for both versions'
 binaries=@{}
}
$preset='pando-native-qt-ci-windows'
foreach ($side in @('baseline','candidate')) {
 $root=if ($side -eq 'baseline') { $baseline } else { $sourceRoot }
 Push-Location $root
 try {
  cmake --preset $preset "-DCMAKE_TOOLCHAIN_FILE=$env:VCPKG_INSTALLATION_ROOT/scripts/buildsystems/vcpkg.cmake" '-DCMAKE_CXX_FLAGS=/MP2' 2>&1 | Tee-Object (Join-Path $sourceRoot "build-native/p9/qt-pair-$side-configure.log")
  if ($LASTEXITCODE -ne 0) { throw "$side configure failed" }
  cmake --build --preset $preset --target ui_tests 2>&1 | Tee-Object (Join-Path $sourceRoot "build-native/p9/qt-pair-$side-build.log")
  if ($LASTEXITCODE -ne 0) { throw "$side test executable build failed" }
  if ($side -eq 'candidate') {
   $engineTests=@('polygon_boundary_contract_tests','m976_shared_boundary_engine_tests')
   cmake --build --preset $preset --target @engineTests 2>&1 | Tee-Object (Join-Path $sourceRoot 'build-native/p9/qt-pair-engine-build.log')
   if ($LASTEXITCODE -ne 0) { throw 'Changed mesh/contact engine test build failed' }
   ctest --test-dir (Join-Path $root "build-native/p3/$preset") --build-config Release -R '^(polygon_boundary_contract_tests|m976_shared_boundary_engine_tests)$' --output-on-failure --no-tests=error 2>&1 | Tee-Object (Join-Path $sourceRoot 'build-native/p9/qt-pair-engine-tests.log')
   if ($LASTEXITCODE -ne 0) { throw 'Changed mesh/contact engine tests failed' }
   $receipt.candidateEngineTests=$engineTests
  }
  $built=@(Get-ChildItem -LiteralPath (Join-Path $root "build-native/p3/$preset") -Recurse -File -Filter ui_tests.exe)
  if ($built.Count -ne 1) { throw "Expected one built ui_tests executable for $side, found $($built.Count)" }
  $binary=$built[0].FullName
  $target=Join-Path $output "$side-ui_tests.exe"
  Copy-Item -LiteralPath $binary -Destination $target
  # vcpkg's app-local deployment owns third-party DLL names and placement.
  foreach ($dependency in Get-ChildItem -LiteralPath $built[0].DirectoryName -File -Filter '*.dll') {
   $deployed=Join-Path $output $dependency.Name
   if ((Test-Path -LiteralPath $deployed) -and (Get-FileHash -LiteralPath $deployed).Hash -ne (Get-FileHash -LiteralPath $dependency.FullName).Hash) { throw "Different shared runtime dependency: $($dependency.Name)" }
   Copy-Item -LiteralPath $dependency.FullName -Destination $deployed
  }
  $receipt.binaries[$side]=@{file=[IO.Path]::GetFileName($target);sha256=(Get-FileHash -LiteralPath $target).Hash}
 } finally { Pop-Location }
}
$deploy=(Get-Command windeployqt.exe -CommandType Application).Source
& $deploy --release --no-translations --qmldir (Join-Path $sourceRoot 'native/ui') --dir $output (Join-Path $output 'candidate-ui_tests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Qt test runtime staging failed' }
$receipt.qtVersion=(& (Join-Path (Split-Path $deploy -Parent) 'qmake.exe') -query QT_VERSION)
$receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'source-identity.json') -Encoding utf8
