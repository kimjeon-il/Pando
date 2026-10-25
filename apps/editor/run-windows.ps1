param([string]$BinaryPath,[switch]$ProbeAuto,[string]$DiagnosticOutput)
$ErrorActionPreference='Stop'
if(!$BinaryPath) {
    if($ProbeAuto -or $DiagnosticOutput){throw 'Verification options require an explicit verified BinaryPath.'}
    & node (Join-Path $PSScriptRoot 'dev.mjs') --native=windows --offline
    exit $LASTEXITCODE
}
& node (Join-Path $PSScriptRoot 'packaged-artifacts.mjs') "--verify-binary=$([IO.Path]::GetFullPath($BinaryPath))"
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$arguments=@()
if($ProbeAuto){$arguments+='--probe-auto'}
if($DiagnosticOutput){$arguments+='--diagnostic-output';$arguments+=[IO.Path]::GetFullPath($DiagnosticOutput)}
& $BinaryPath @arguments
