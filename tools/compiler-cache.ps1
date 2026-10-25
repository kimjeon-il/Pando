param([Parameter(Mandatory=$true)][string]$RepositoryRoot)
# Only this build process and its children inherit the repository's activation.
$compilerEnvironment = & node (Join-Path $RepositoryRoot 'tools/worktree-storage.mjs') "--root=$RepositoryRoot" --compiler-env
if ($LASTEXITCODE -ne 0) { throw 'Activated compiler cache configuration failed.' }
$compilerValues = $compilerEnvironment | ConvertFrom-Json
foreach ($compilerProperty in $compilerValues.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($compilerProperty.Name, [string]$compilerProperty.Value, 'Process')
}
