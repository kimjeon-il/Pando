param(
 [Parameter(Mandatory=$true)][string]$ProbeExecutable,
 [Parameter(Mandatory=$true)][string]$QtBin,
 [string]$AdditionalQtPluginDirectory,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$FixtureManifest,
 [ValidateSet('acceptance','diagnostic')][string]$Mode='acceptance',
 [string]$DiagnosticReason,
 [ValidateSet('m98-stress','p9-relative')][string]$Profile='m98-stress',
 [string]$BaselineProbeExecutable,
 [string]$BaselineSourceCommit,
 [string]$AdditionalRoundFrom,
 [ValidateRange(1,20)][int]$Runs=3,
 [ValidateRange(60000,3600000)][int]$WarmupMs=60000,
 [ValidateRange(720000,7200000)][int]$RepeatMs=720000,
 [ValidateRange(1,2147483)][int]$TimeoutSeconds=2400
)
# Run the existing Release test executable against installed Qt. No runtime/package copy.
# Fixture manifest schema: pandoeditor-native-performance-fixtures/version2; four
# fixtures {id,projectPath,projectSha256,viewPath,viewSha256,assets:[{path,sha256}],
# fullStack,expectedFinalStates,inputContractPath,inputContractSha256}; paths relative to the manifest.
# productionPlace {path,sha256,revision} pins a fixture manifest copy and the
# identical production manifest used by the measured application.
$ErrorActionPreference='Stop'
$probePath=(Resolve-Path -LiteralPath $ProbeExecutable).Path
$baselinePath=$null
$buildIdentity=$null;$previousRound=$null
if($Profile -eq 'p9-relative'){
 if($Mode -ne 'diagnostic' -or !$DiagnosticReason){throw 'P9 relative comparison requires explicit diagnostic scope; it does not establish M98 acceptance'}
 if($Runs -ne 5){throw 'P9 relative comparison requires exactly five alternating measured pairs'}
 if($BaselineSourceCommit -notmatch '^[a-f0-9]{40}$'){throw 'P9 baseline source commit is required'}
 $baselinePath=(Resolve-Path -LiteralPath $BaselineProbeExecutable).Path
 $identityPath=Join-Path (Split-Path $probePath -Parent) 'source-identity.json'
 $buildIdentity=Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
 if($buildIdentity.baselineSourceSha -ne $BaselineSourceCommit -or $buildIdentity.candidateSourceSha -notmatch '^[a-f0-9]{40}$'){throw 'CI source identity does not match the requested pair'}
 if($buildIdentity.binaries.baseline.sha256 -ne (Get-FileHash -LiteralPath $baselinePath).Hash -or $buildIdentity.binaries.candidate.sha256 -ne (Get-FileHash -LiteralPath $probePath).Hash){throw 'CI test binary identity mismatch'}
 foreach($overlay in $buildIdentity.measurementOverlaySha256.PSObject.Properties){
  $localOverlay=Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) $overlay.Name
  if((Get-FileHash -LiteralPath $localOverlay).Hash -ne $overlay.Value){throw "Measurement overlay differs from compiled CI source: $($overlay.Name)"}
 }
 if($AdditionalRoundFrom){
  $AdditionalRoundFrom=(Resolve-Path -LiteralPath $AdditionalRoundFrom).Path
  $assessment=Get-Content -LiteralPath (Join-Path $AdditionalRoundFrom 'assessment.json') -Raw | ConvertFrom-Json
  if($assessment.schema -ne 'pando-p9-native-relative-comparison' -or $assessment.status -ne 'uncertain' -or $assessment.roundCount -ne 1 -or !$assessment.additionalRoundAllowed){throw 'One additional round is allowed only after initial P9 uncertainty'}
  $previousRound=Get-Content -LiteralPath (Join-Path $AdditionalRoundFrom 'environment.json') -Raw | ConvertFrom-Json
  if($previousRound.additionalRoundFrom){throw 'An additional round cannot be repeated'}
 }
}elseif($AdditionalRoundFrom){throw 'Additional round applies only to P9 relative comparison'}
$qtPath=(Resolve-Path -LiteralPath $QtBin).Path
$manifestPath=(Resolve-Path -LiteralPath $FixtureManifest).Path
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a new evidence output directory'}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$reportRoot=(Resolve-Path -LiteralPath $OutputDirectory).Path
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$fixtureRoot=Split-Path -Parent $manifestPath
$missing=[Collections.Generic.List[string]]::new();$invalidProjects=[Collections.Generic.List[string]]::new();$hashes=@{}
$hashes[$manifestPath]=(Get-FileHash -LiteralPath $manifestPath).Hash
if($AdditionalQtPluginDirectory){
 $AdditionalQtPluginDirectory=(Resolve-Path -LiteralPath $AdditionalQtPluginDirectory).Path
 $supplementalImageCodec=Join-Path $AdditionalQtPluginDirectory 'imageformats/qwebp.dll'
 if(!(Test-Path -LiteralPath $supplementalImageCodec -PathType Leaf)){throw 'Supplemental Qt WebP plugin missing'}
 $hashes[$supplementalImageCodec]=(Get-FileHash -LiteralPath $supplementalImageCodec).Hash
}
function Test-ImmutableInput($relative,$expected){
 if(!$relative -or $expected -notmatch '^[a-fA-F0-9]{64}$'){$missing.Add("Missing path/hash: $relative");return}
 $path=[IO.Path]::GetFullPath((Join-Path $fixtureRoot $relative))
 if(!(Test-Path -LiteralPath $path -PathType Leaf)){$missing.Add("Missing asset: $path");return}
 $actual=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
 if($actual -ne $expected){$missing.Add("SHA256 mismatch: $path");return}
 $hashes[$path]=$actual
}
function Test-ProductionPlaceInput($contract,$productionPath){
 $receipt=@{revision=$null;sha256=$null}
 if(!$contract.path -or $contract.sha256 -notmatch '^[a-fA-F0-9]{64}$'){
  $missing.Add('Missing production place manifest path/hash in fixture contract')
 }else{
  Test-ImmutableInput $contract.path $contract.sha256
 }
 if([string]::IsNullOrWhiteSpace($contract.revision)){$missing.Add('Missing production place revision in fixture contract')}
 if(!(Test-Path -LiteralPath $productionPath -PathType Leaf)){
  $missing.Add('Production place manifest absent');return $receipt
 }
 $receipt.sha256=(Get-FileHash -LiteralPath $productionPath -Algorithm SHA256).Hash
 $hashes[$productionPath]=$receipt.sha256
 $productionPlace=Get-Content -LiteralPath $productionPath -Raw | ConvertFrom-Json
 $receipt.revision=$productionPlace.revision
 if($receipt.sha256 -ne $contract.sha256){$missing.Add('Production place manifest SHA256 mismatch against fixture contract')}
 if(!$receipt.revision -or $receipt.revision -ne $contract.revision){$missing.Add('Production place revision mismatch against fixture contract')}
 if($receipt.revision -eq 'empty-v1'){$missing.Add('Production place runtime is empty-v1: full Dense and full acceptance blocked')}
 return $receipt
}
if($manifest.schema -ne 'pandoeditor-native-performance-fixtures' -or $manifest.version -ne 2){$missing.Add('Immutable fixture schema/version mismatch')}
if($Profile -eq 'p9-relative' -and $manifest.measurementScope -ne 'p9-relative'){$missing.Add('P9 production input scope missing')}
foreach($id in @('world-standard','dense-view','editing-heavy','large-project')){
 $fixture=@($manifest.fixtures | Where-Object id -eq $id)
 if($fixture.Count -ne 1){$missing.Add("Missing/duplicate fixture: $id");continue}
 $fixture=$fixture[0]
 if($Profile -eq 'p9-relative' -and ($fixture.datasetClass -ne 'production-full-world' -or $fixture.unitCount -lt 258)){$missing.Add("P9 requires the entire published production world: $id")}
 Test-ImmutableInput $fixture.projectPath $fixture.projectSha256
 if($fixture.projectPath){
  $projectInput=[IO.Path]::GetFullPath((Join-Path $fixtureRoot $fixture.projectPath))
  if($hashes.ContainsKey($projectInput)){
   $projectHeader=Get-Content -LiteralPath $projectInput -Raw -Encoding utf8 | ConvertFrom-Json
   if($projectHeader.format -ne 'pandoeditor-project' -or $projectHeader.version -ne 10){
    $invalidProjects.Add("Native project format/version required: $id ($projectInput)")
    $missing.Add("Unsupported measurement project format/version: $id")
   }
  }
 }
 Test-ImmutableInput $fixture.viewPath $fixture.viewSha256
 if(!$fixture.assets -or !$fixture.expectedFinalStates -or !$fixture.inputContractPath){$missing.Add("Incomplete fixture contract: $id")}
 Test-ImmutableInput $fixture.inputContractPath $fixture.inputContractSha256
 foreach($asset in $fixture.assets){Test-ImmutableInput $asset.path $asset.sha256}
 if($Mode -eq 'acceptance' -and !$fixture.fullStack){$missing.Add("Reduced fixture forbidden for acceptance: $id")}
}
$productionPlacePath=Join-Path (Split-Path $PSScriptRoot -Parent) 'assets/place/manifest.json'
$productionPlaceReceipt=Test-ProductionPlaceInput $manifest.productionPlace $productionPlacePath
$productionPlaceRevision=$productionPlaceReceipt.revision;$productionPlaceSha=$productionPlaceReceipt.sha256
$preflight=[ordered]@{status=if($missing.Count){'BLOCKED'}else{'PASS'};missing=@($missing);placeDatasetVersion=$productionPlaceRevision;productionPlaceManifestSha256=$productionPlaceSha;fixtureManifestSha256=(Get-FileHash -LiteralPath $manifestPath).Hash}
$preflight | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$reportRoot/preflight.json" -Encoding utf8
if($invalidProjects.Count){throw ($invalidProjects -join '; ')}
if(($Mode -eq 'acceptance' -or $Profile -eq 'p9-relative') -and $missing.Count){throw "Measurement preflight BLOCKED; see $reportRoot/preflight.json"}
if($Mode -eq 'diagnostic' -and !$DiagnosticReason){throw 'Diagnostic mode requires an explicit reduction/synthetic reason'}
if($Profile -eq 'm98-stress' -and $TimeoutSeconds*1000 -lt $WarmupMs+$RepeatMs+180000){throw 'Timeout cannot cover warm-up, long run and scenario sequence'}
if(!(Test-Path -LiteralPath "$qtPath/Qt6Test.dll")){throw 'Installed Qt6Test.dll missing'}
$qtPluginPath=Join-Path (Split-Path $qtPath -Parent) 'plugins'
$qtQmlPath=Join-Path (Split-Path $qtPath -Parent) 'qml'
# windeployqt test artifacts keep plugins beside the DLLs; installed Qt keeps
# them beside bin/. Resolve and validate the actual runtime layout once.
if(Test-Path -LiteralPath "$qtPath/platforms/qwindows.dll"){$qtPluginPath=$qtPath}
if(Test-Path -LiteralPath "$qtPath/qml/QtQuick"){$qtQmlPath=Join-Path $qtPath 'qml'}
if(!(Test-Path -LiteralPath "$qtPluginPath/platforms/qwindows.dll")){throw 'Windows Qt platform plugin missing'}
if(!(Test-Path -LiteralPath "$qtQmlPath/QtQuick")){throw 'QtQuick QML runtime missing'}
foreach($runtimeFile in @("$qtPath/Qt6Core.dll","$qtPath/Qt6Gui.dll","$qtPath/Qt6Quick.dll","$qtPath/Qt6Qml.dll","$qtPath/Qt6Test.dll","$qtPluginPath/platforms/qwindows.dll")){
 $hashes[$runtimeFile]=(Get-FileHash -LiteralPath $runtimeFile).Hash
}
$metadata=[ordered]@{sourceCommit=(git rev-parse HEAD);sourceDirty=[bool](git status --porcelain --untracked-files=no);binarySha256=(Get-FileHash -LiteralPath $probePath).Hash;fixtureManifestSha256=$preflight.fixtureManifestSha256;buildType='Release';qtBin=$qtPath;os=[Environment]::OSVersion.VersionString;adapters=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion);cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors);inputHashes=$hashes;measurementMode=$Mode;diagnosticReason=$DiagnosticReason;runs=$Runs;warmupMs=$WarmupMs;repeatMs=$RepeatMs;qtFunctionTimeoutMs=$TimeoutSeconds*1000;acceptedBy=$null}
$metadata.measurementProfile=$Profile
$metadata.qtPluginPath=$qtPluginPath;$metadata.qtQmlPath=$qtQmlPath
$metadata.workspaceCommit=$metadata.sourceCommit
if($baselinePath){
 $metadata.sourceCommit=$buildIdentity.candidateSourceSha
 $metadata.baselineSourceCommit=$BaselineSourceCommit;$metadata.baselineBinarySha256=(Get-FileHash -LiteralPath $baselinePath).Hash
 $metadata.buildIdentity=$buildIdentity
 $metadata.warmupMs=0;$metadata.repeatMs=0
 $metadata.cacheCondition='One discarded full workload per version warms OS inputs and the shared installed physical-data disk cache; each measured run starts a fresh process with isolated project persistence and fresh in-memory caches. Existing physical-data cache is preserved.'
 $metadata.scope='P9 same-input production-world relative startup/pan-swap/edit-preview-cancel/save/process-memory comparison. No M98 full-stack, 12-minute plateau, GPU completion, or Android evidence.'
 $metadata.additionalRoundFrom=$AdditionalRoundFrom
 if($previousRound){
  foreach($key in @('sourceCommit','baselineSourceCommit','binarySha256','baselineBinarySha256','fixtureManifestSha256')){
   if($previousRound.$key -ne $metadata[$key]){throw "Additional round changed $key"}
  }
 }
}
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$reportRoot/environment.json" -Encoding utf8
if($Mode -eq 'acceptance' -and $metadata.sourceDirty){throw 'Acceptance requires the final fixed source commit; working tree is dirty'}
$envNames=@('PATH','QTEST_FUNCTION_TIMEOUT','QT_QPA_PLATFORM','QT_PLUGIN_PATH','QML_IMPORT_PATH','QML2_IMPORT_PATH','QT_QUICK_BACKEND','QSG_RHI_BACKEND','QSG_INFO','QT_LOGGING_RULES','QSG_RHI_PREFER_SOFTWARE_RENDERER','QT_D3D_ADAPTER_INDEX','PANDOEDITOR_MAP_RENDERER','QSG_RENDER_TIMING','QSG_RENDERER_DEBUG','PANDOEDITOR_NATIVE_PERF_REPORT','PANDOEDITOR_NATIVE_PERF_FIXTURES','PANDOEDITOR_NATIVE_PERF_MODE','PANDOEDITOR_NATIVE_PERF_REASON','PANDOEDITOR_NATIVE_PERF_PROVENANCE','PANDOEDITOR_NATIVE_PERF_PREFLIGHT','PANDOEDITOR_NATIVE_PERF_WARMUP_MS','PANDOEDITOR_NATIVE_PERF_REPEAT_MS','PANDOEDITOR_NATIVE_PERF_RUN_ID','PANDOEDITOR_NATIVE_PERF_BRIEF','PANDOEDITOR_NATIVE_PERF_ABLATION','PANDOEDITOR_NATIVE_PERF_RECOVERY','PANDOEDITOR_NATIVE_PERF_VIEW','PANDOEDITOR_NATIVE_PERF_PROFILE','PANDOEDITOR_NATIVE_PERF_WORLD_ROOT','PANDOEDITOR_WORLD_DATA_ROOT','PANDOEDITOR_TERRAIN_DEM_DATA_ROOT')
$saved=@{};foreach($name in $envNames){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
 $env:PATH="$qtPath;$env:PATH";$env:QT_QPA_PLATFORM='windows'
 $env:QT_PLUGIN_PATH=$qtPluginPath
 if($AdditionalQtPluginDirectory){$env:QT_PLUGIN_PATH=$AdditionalQtPluginDirectory+';'+$env:QT_PLUGIN_PATH}
 $env:QML_IMPORT_PATH=$qtQmlPath;$env:QML2_IMPORT_PATH=$env:QML_IMPORT_PATH
 $env:QT_QUICK_BACKEND=$null;$env:QSG_RHI_BACKEND=$null;$env:PANDOEDITOR_MAP_RENDERER=$null
 if($baselinePath){
  $env:QSG_RHI_BACKEND='d3d11';$env:QSG_INFO='1';$env:QT_LOGGING_RULES='qt.scenegraph.general.debug=true;qt.rhi.general.debug=true'
  $env:QSG_RHI_PREFER_SOFTWARE_RENDERER='0';$env:QT_D3D_ADAPTER_INDEX=$null
 }
 $env:QSG_RENDER_TIMING=$null;$env:QSG_RENDERER_DEBUG=$null
 $env:PANDOEDITOR_NATIVE_PERF_BRIEF=$null;$env:PANDOEDITOR_NATIVE_PERF_ABLATION=$null;$env:PANDOEDITOR_NATIVE_PERF_RECOVERY=$null;$env:PANDOEDITOR_NATIVE_PERF_VIEW=$null
 $env:PANDOEDITOR_NATIVE_PERF_FIXTURES=$manifestPath;$env:PANDOEDITOR_NATIVE_PERF_MODE=$Mode;$env:PANDOEDITOR_NATIVE_PERF_REASON=$DiagnosticReason
 $env:PANDOEDITOR_NATIVE_PERF_PROFILE=$Profile
 $env:PANDOEDITOR_NATIVE_PERF_WORLD_ROOT=Join-Path (Split-Path $PSScriptRoot -Parent) 'assets/world'
 $env:PANDOEDITOR_WORLD_DATA_ROOT=$env:PANDOEDITOR_NATIVE_PERF_WORLD_ROOT
 $env:PANDOEDITOR_TERRAIN_DEM_DATA_ROOT=$env:PANDOEDITOR_NATIVE_PERF_WORLD_ROOT
 $env:PANDOEDITOR_NATIVE_PERF_PROVENANCE="$reportRoot/environment.json";$env:PANDOEDITOR_NATIVE_PERF_PREFLIGHT="$reportRoot/preflight.json"
 $env:PANDOEDITOR_NATIVE_PERF_WARMUP_MS="$WarmupMs";$env:PANDOEDITOR_NATIVE_PERF_REPEAT_MS="$RepeatMs"
 # Qt's five-minute per-function default cannot contain the required twelve-minute
 # repetition. Keep its watchdog finite and equal to the recorded process deadline.
 $env:QTEST_FUNCTION_TIMEOUT="$($metadata.qtFunctionTimeoutMs)"
 $failures=[Collections.Generic.List[object]]::new()
 $runPlan=@()
 if($baselinePath){
  if(!$AdditionalRoundFrom){foreach($version in @('baseline','candidate')){$runPlan+=@{id="warmup-$version";version=$version;warmup=$true}}}
  $runPrefix=if($AdditionalRoundFrom){'extra'}else{'run'}
  for($run=1;$run -le $Runs;$run++){foreach($version in @('baseline','candidate')){$runPlan+=@{id="$runPrefix-$run-$version";version=$version;warmup=$false}}}
 }else{for($run=1;$run -le $Runs;$run++){$runPlan+=@{id="run-$run";version='candidate';warmup=$false}}}
 foreach($planned in $runPlan){
  $currentProbe=if($planned.version -eq 'baseline'){$baselinePath}else{$probePath}
  $runRoot=Join-Path $reportRoot $planned.id;New-Item -ItemType Directory -Path $runRoot | Out-Null
  $env:PANDOEDITOR_NATIVE_PERF_REPORT="$runRoot/measurement.json";$env:PANDOEDITOR_NATIVE_PERF_RUN_ID=$planned.id
  if($baselinePath){
   $runMetadata=[ordered]@{};foreach($key in $metadata.Keys){$runMetadata[$key]=$metadata[$key]}
   if($planned.version -eq 'baseline'){$runMetadata.sourceCommit=$BaselineSourceCommit;$runMetadata.binarySha256=$metadata.baselineBinarySha256}
   $runMetadata.runId=$planned.id;$runMetadata.warmup=$planned.warmup
   $runMetadata | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$runRoot/provenance.json" -Encoding utf8
   $env:PANDOEDITOR_NATIVE_PERF_PROVENANCE="$runRoot/provenance.json"
  }
  $arguments=@('nativePerformanceProbe','-o',('"'+$runRoot+'/qt-test.txt,txt"'))
  # The requested device measurement needs an exposed Windows map window.
  $probe=Start-Process -FilePath $currentProbe -ArgumentList $arguments -WorkingDirectory (Split-Path $currentProbe -Parent) -WindowStyle Normal -PassThru -RedirectStandardOutput "$runRoot/stdout.txt" -RedirectStandardError "$runRoot/stderr.txt"
  $nativeHandle=$probe.Handle
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$processSamples=[Collections.Generic.List[object]]::new();$timedOut=$false
  while(!$probe.WaitForExit(1000)){
   $probe.Refresh();$processSamples.Add([ordered]@{time=[DateTime]::UtcNow.ToString('o');cpuSeconds=$probe.TotalProcessorTime.TotalSeconds;workingSetBytes=$probe.WorkingSet64;privateBytes=$probe.PrivateMemorySize64;responding=$probe.Responding})
   if([DateTime]::UtcNow -gt $deadline){Stop-Process -Id $probe.Id;$timedOut=$true;break}
  }
  $processSamples | ConvertTo-Json | Set-Content -LiteralPath "$runRoot/process.json" -Encoding utf8
  $probe.Refresh();$nativeExit=if($timedOut){$null}else{$probe.ExitCode}
  $failures.Add([ordered]@{run=$planned.id;version=$planned.version;warmup=$planned.warmup;nativePid=$probe.Id;binarySha256=(Get-FileHash -LiteralPath $currentProbe).Hash;timedOut=$timedOut;exitCode=$nativeExit;exitCodeObserved=($null -ne $nativeExit);rawReportExists=(Test-Path -LiteralPath "$runRoot/measurement.json")})
  $failures | ConvertTo-Json | Set-Content -LiteralPath "$reportRoot/run-results.json" -Encoding utf8
  if(!$timedOut -and $null -eq $nativeExit){throw 'Native process exit code unavailable; raw failure preserved'}
  foreach($path in $hashes.Keys){if((Get-FileHash -LiteralPath $path).Hash -ne $hashes[$path]){throw "Immutable fixture changed: $path"}}
  if((Get-FileHash -LiteralPath $probePath).Hash -ne $metadata.binarySha256 -or (git rev-parse HEAD) -ne $metadata.workspaceCommit){throw 'Binary/source changed during the fixed repeated run'}
  if($baselinePath -and (Get-FileHash -LiteralPath $baselinePath).Hash -ne $metadata.baselineBinarySha256){throw 'Baseline binary changed during the fixed repeated run'}
  if($baselinePath -and ($timedOut -or $nativeExit -ne 0 -or !(Test-Path -LiteralPath "$runRoot/measurement.json"))){throw 'P9 workload failed; stop comparison and preserve raw evidence'}
  $failures | ConvertTo-Json | Set-Content -LiteralPath "$reportRoot/run-results.json" -Encoding utf8
 }
 if(@($failures | Where-Object {$_.timedOut -or $_.exitCode -ne 0}).Count){throw 'One or more native runs failed; all raw logs were preserved'}
 Write-Output "Raw evidence: $reportRoot"
 Write-Output 'Qt test completion is not acceptance. Summarize each raw v2 report; acceptedBy remains null.'
}finally{foreach($name in $envNames){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
