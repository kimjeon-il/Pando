$ErrorActionPreference='Stop'
# Load only the production preflight functions; never start Qt or a measurement.
$runner=Join-Path $PSScriptRoot 'run-native-performance.ps1'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($runner,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors -join "`n")}
foreach($name in @('Test-ImmutableInput','Test-ProductionPlaceInput')) {
 $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
 if(!$definition){throw "Missing production preflight function: $name"}
 . ([scriptblock]::Create($definition.Extent.Text))
}
$fixtureRoot=Join-Path $PSScriptRoot '../../build-native/p9/native-preflight-contract-test'
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$fixtureRoot=(Resolve-Path $fixtureRoot).Path
$fixtureFile=Join-Path $fixtureRoot 'fixture-place.json'
$runtimeFile=Join-Path $fixtureRoot 'runtime-place.json'
$cases=@(
 @{name='declared current dataset';change={};expected=$null},
 @{name='missing declaration';change={$script:contract=$null};expected='Missing production place manifest path/hash'},
 @{name='missing hash';change={$script:contract.sha256=$null};expected='Missing production place manifest path/hash'},
 @{name='missing fixture file';change={$script:contract.path='absent.json'};expected='Missing asset'},
 @{name='corrupt fixture';change={Set-Content -LiteralPath $fixtureFile -Value '{"revision":"corrupt"}'};expected='SHA256 mismatch'},
 @{name='changed runtime';change={Set-Content -LiteralPath $runtimeFile -Value '{"revision":"changed"}'};expected='Production place manifest SHA256 mismatch'},
 @{name='missing runtime';change={$script:actualPath=Join-Path $fixtureRoot 'absent-runtime.json'};expected='Production place manifest absent'},
 @{name='missing revision';change={$script:contract.revision=$null};expected='Missing production place revision'},
 @{name='wrong revision';change={$script:contract.revision='other'};expected='Production place revision mismatch'},
 @{name='empty dataset';change={
   Set-Content -LiteralPath $fixtureFile -Value '{"revision":"empty-v1"}'
   Copy-Item -LiteralPath $fixtureFile -Destination $runtimeFile -Force
   $script:contract.sha256=(Get-FileHash -LiteralPath $fixtureFile).Hash
   $script:contract.revision='empty-v1'
  };expected='Production place runtime is empty-v1'}
)
foreach($case in $cases) {
 Set-Content -LiteralPath $fixtureFile -Value '{"version":1,"revision":"approved-test-dataset"}'
 Copy-Item -LiteralPath $fixtureFile -Destination $runtimeFile -Force
 $script:contract=@{path='fixture-place.json';sha256=(Get-FileHash -LiteralPath $fixtureFile).Hash;revision='approved-test-dataset'}
 $script:actualPath=$runtimeFile
 $missing=[Collections.Generic.List[string]]::new();$hashes=@{}
 & $case.change
 $receipt=Test-ProductionPlaceInput $contract $actualPath
 if($case.expected) {
  if(!@($missing | Where-Object {$_ -like "*$($case.expected)*"}).Count){throw "$($case.name): expected '$($case.expected)', got '$missing'"}
 } else {
  if($missing.Count){throw "$($case.name): $missing"}
  if($receipt.sha256 -ne $contract.sha256 -or $receipt.revision -ne $contract.revision){throw 'Receipt did not preserve verified identity'}
  if(!$hashes.ContainsKey($fixtureFile) -or !$hashes.ContainsKey($runtimeFile)){throw 'Immutable fixture/runtime hashes not retained'}
 }
}
Write-Output "Native performance preflight: $($cases.Count) contract cases passed; no Qt or performance execution."
