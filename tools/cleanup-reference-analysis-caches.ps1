#requires -Version 5.1
<##
Preview: .\tools\cleanup-reference-analysis-caches.ps1
Delete verified unused copies: .\tools\cleanup-reference-analysis-caches.ps1 -Apply
Add -IncludeRetiredAppBinaries -IncludeEmulatorSnapshots for retired native
executables and stopped Android emulators' Quick Boot snapshots. Use
-IncludeGitTemporaryPacks for abandoned, unindexed Git packing output after
offline reference verification. Preview writes no files. Applied results use
the canonical report owner. No backups are created. Sources, installed apps,
SDKs, Git history and active builds stay.
##>
[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Apply,
    [string[]]$Revision = @(),
    [switch]$SkipWorkerRuntimes,
    [switch]$SkipDataCaches,
    [switch]$IncludeRetiredAppBinaries,
    [switch]$IncludeEmulatorSnapshots,
    [switch]$IncludeGitTemporaryPacks,
    [string]$AndroidAvdRoot = 'D:/Android/avd'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot 'config/library-data.json'))) { throw 'Not a PandoLab checkout.' }
foreach ($id in $Revision) { if ($id -notmatch '^[a-f0-9]{40}$') { throw 'Revision must be a full 40-character data commit.' } }

function Invoke-GitText([string]$Root, [string[]]$Arguments, [string[]]$InputLines = @()) {
    $consoleEncoding = [Console]::OutputEncoding
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    try {
        [Console]::OutputEncoding = $OutputEncoding
        $output = if ($InputLines.Count) { @($InputLines | & $script:Git -C $Root @Arguments 2>&1) } else { @(& $script:Git -C $Root @Arguments 2>&1) }
        if ($LASTEXITCODE -ne 0) { throw ('Git failed: ' + (($output | Select-Object -Last 12) -join "`n")) }
        return ($output -join "`n")
    } finally { [Console]::OutputEncoding = $consoleEncoding }
}

function Resolve-DirectoryTarget([string]$Path) {
    $pathNow = [IO.Path]::GetFullPath($Path)
    $visited = @{}
    for ($depth = 0; $depth -lt 16; $depth++) {
        if ($visited.ContainsKey($pathNow)) { throw 'Directory link cycle.' }
        $visited[$pathNow] = $true
        $item = Get-Item -LiteralPath $pathNow -Force
        if (-not $item.PSIsContainer) { throw "Not a directory: $pathNow" }
        if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $item.FullName.TrimEnd('\', '/') }
        $target = @($item.Target)[0]
        if (-not $target) { throw "Cannot resolve directory link: $pathNow" }
        if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $item.Parent.FullName $target }
        $pathNow = [IO.Path]::GetFullPath($target)
    }
    throw 'Too many directory links.'
}

function Get-ChildPath([string]$Root, [string]$RelativePath) {
    if (-not $RelativePath -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '[\r\n:]' -or $RelativePath.Split([char[]]@('/', '\')) -contains '..') { throw 'Unsafe relative archive path.' }
    $target = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
    if (-not $target.StartsWith($Root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes its cache.' }
    return $target
}

function Get-PlainFiles([string]$Root) {
    $rootItem = Get-Item -LiteralPath $Root -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Root is a link; preserve it.' }
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $files = New-Object 'System.Collections.Generic.List[object]'
    $stack.Push($rootItem.FullName)
    while ($stack.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $stack.Pop() -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Nested link; preserve cache: $($item.FullName)" }
            if ($item.PSIsContainer) { $stack.Push($item.FullName) } else { $files.Add($item) }
        }
    }
    return ,$files
}

function Get-FileDigest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose(); $stream.Dispose() }
}

$cacheRoot = Resolve-DirectoryTarget (Join-Path $RepositoryRoot '.library-data/materialized')
$dataPath = if ($env:PANDOLAB_LIBRARY_DATA_ROOT) { $env:PANDOLAB_LIBRARY_DATA_ROOT } else { Join-Path $RepositoryRoot '.library-data/repository' }
$dataRoot = Resolve-DirectoryTarget $dataPath
if (-not (Test-Path -LiteralPath (Join-Path $dataRoot '.git'))) { throw 'Library Git checkout is required for archive verification.' }

function Get-Protection {
    $pins = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $roots = New-Object 'System.Collections.Generic.List[string]'
    $listing = Invoke-GitText $RepositoryRoot @('worktree', 'list', '--porcelain')
    foreach ($line in $listing.Split("`n")) {
        if (-not $line.StartsWith('worktree ')) { continue }
        $root = $line.Substring(9).Trim()
        $roots.Add($root)
        $config = Get-Content -LiteralPath (Join-Path $root 'config/library-data.json') -Raw | ConvertFrom-Json
        if ($config.revision -notmatch '^[a-f0-9]{40}$') { throw "Invalid active pin in $root" }
        [void]$pins.Add($config.revision)
        if (Test-Path -LiteralPath (Join-Path $root '.library-data/prepare.lock')) { throw 'A library preparation or storage operation is running.' }
        $leasePath = Join-Path $root '.library-data/dev-server.json'
        if (Test-Path -LiteralPath $leasePath) {
            $lease = Get-Content -LiteralPath $leasePath -Raw | ConvertFrom-Json
            if (Get-Process -Id $lease.pid -ErrorAction SilentlyContinue) {
                foreach ($activePath in $lease.materialized) {
                    $active = [IO.Path]::GetFullPath($activePath)
                    $prefix = $cacheRoot + [IO.Path]::DirectorySeparatorChar
                    if ($active.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { [void]$pins.Add($active.Substring($prefix.Length).Split([char[]]@('\', '/'))[0]) }
                }
            }
        }
        foreach ($mount in $config.mounts) {
            $path = Join-Path $root $mount
            if (-not (Test-Path -LiteralPath $path)) { continue }
            $target = Resolve-DirectoryTarget $path
            $prefix = $cacheRoot + [IO.Path]::DirectorySeparatorChar
            if ($target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                [void]$pins.Add($target.Substring($prefix.Length).Split([char[]]@('\', '/'))[0])
            }
        }
    }
    if (-not $roots.Count) { throw 'No registered worktrees; refusing cleanup.' }
    return @{ Pins = $pins; Roots = $roots }
}

function Test-UnchangedFiles($Before, [string]$Root) {
    $after = Get-PlainFiles $Root
    if ($after.Count -ne $Before.Count) { return $false }
    $stamps = @{}
    foreach ($file in $Before) { $stamps[$file.FullName] = @($file.Length, $file.LastWriteTimeUtc.Ticks) }
    foreach ($file in $after) {
        if (-not $stamps.ContainsKey($file.FullName)) { return $false }
        $stamp = $stamps[$file.FullName]
        if ($file.Length -ne $stamp[0] -or $file.LastWriteTimeUtc.Ticks -ne $stamp[1]) { return $false }
    }
    return $true
}

function Remove-CheckedDirectory([string]$Path, [string]$ExpectedParent) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $parent = [IO.Path]::GetDirectoryName($full)
    if (-not $parent.Equals($ExpectedParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Delete target is outside its verified parent.' }
    [void](Get-PlainFiles $full)
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $full) { throw 'Cleanup did not finish.' }
}

function Assert-GitIdle([string]$Common) {
    $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(git|git-pack-objects|git-index-pack)\.exe$' })
    if ($running.Count) { throw 'A Git operation is running; preserve temporary packs.' }
    if (@(Get-ChildItem -LiteralPath $Common -Filter '*.lock' -File -Force | Where-Object { $_.Name -ne 'pando-library.lock' }).Count -or (Test-Path -LiteralPath (Join-Path $Common 'gc.pid'))) { throw 'Git has an operation lock; preserve temporary packs.' }
}

$protection = Get-Protection
$modulePath = Join-Path $PSScriptRoot 'library-data.mjs'
$reportRoot = & node $modulePath --report-root $RepositoryRoot
if ($LASTEXITCODE -ne 0 -or -not $reportRoot) { throw 'Cannot resolve the canonical report owner.' }
$reportDirectory = Get-ChildPath $reportRoot 'reference-analysis'
$reportPath = Join-Path $reportDirectory ('cleanup-result-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
$drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($cacheRoot))
$freeBytesBefore = $drive.AvailableFreeSpace
$rows = New-Object 'System.Collections.Generic.List[object]'
[long]$deletedBytes = 0
[long]$eligibleBytes = 0
$oldLazyFetch = $env:GIT_NO_LAZY_FETCH
$oldOptionalLocks = $env:GIT_OPTIONAL_LOCKS
$env:GIT_NO_LAZY_FETCH = '1'
$env:GIT_OPTIONAL_LOCKS = '0'
$lockStream = $null
$common = Invoke-GitText $dataRoot @('rev-parse', '--git-common-dir')
if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $dataRoot $common }
$lockPath = Join-Path $common 'pando-library.lock'

try {
    if ($Apply) { $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
    elseif (Test-Path -LiteralPath $lockPath) { throw 'Library storage is already running.' }
    foreach ($directory in $(if (-not $SkipDataCaches) { Get-ChildItem -LiteralPath $cacheRoot -Force -Directory })) {
        $id = $directory.Name
        if ($id -notmatch '^[a-f0-9]{40}$' -or ($Revision.Count -and $Revision -notcontains $id)) { continue }
        $row = [ordered]@{ kind = 'data-cache'; path = $directory.FullName; revision = $id; status = 'checking'; bytes = 0; files = 0; reason = '' }
        $rows.Add($row)
        try {
            $protection = Get-Protection
            if ($protection.Pins.Contains($id)) { $row.status = 'protected-active'; continue }
            Write-Host "Checking cache $id ..."
            $target = Get-ChildPath $cacheRoot $id
            $actualFiles = Get-PlainFiles $target
            $marker = Join-Path $target '.complete'
            if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $id) { throw 'Incomplete cache; preserve it.' }
            $index = (Invoke-GitText $dataRoot @('show', "${id}:archive/index.json")) | ConvertFrom-Json
            $expected = @{}
            $archiveReferences = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
            foreach ($property in $index.files.PSObject.Properties) {
                if ($property.Name.StartsWith('reports/')) { continue }
                $filePath = Get-ChildPath $target $property.Name
                if ($expected.ContainsKey($filePath)) { throw 'Duplicate archive path.' }
                $entry = $property.Value
                if ($entry.sha256 -notmatch '^[a-f0-9]{64}$' -or [long]$entry.bytes -lt 0) { throw 'Invalid archive digest or size.' }
                [void](Get-ChildPath $dataRoot $entry.stored)
                [void]$archiveReferences.Add($entry.stored)
                $expected[$filePath] = $entry
            }
            $ownerPath = Join-Path $target '.cache-owner.json'
            $markerCount = 1
            if (Test-Path -LiteralPath $ownerPath) {
                $owner = Get-Content -LiteralPath $ownerPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($owner.schema -ne 'pando-materialized-cache-v1' -or $owner.revision -ne $id) { throw 'Invalid cache ownership record.' }
                $ownerFiles = @($owner.files.PSObject.Properties)
                if ($ownerFiles.Count -ne $expected.Count) { throw 'Ownership record does not match the archived files.' }
                foreach ($property in $ownerFiles) {
                    $ownedPath = Get-ChildPath $target $property.Name
                    if (-not $expected.ContainsKey($ownedPath) -or $expected[$ownedPath].sha256 -ne $property.Value) { throw 'Ownership digest does not match the archive.' }
                }
                $markerCount++
            }
            if (-not $expected.Count -or $actualFiles.Count -ne $expected.Count + $markerCount) { throw 'Extra or missing files; preserve cache.' }
            foreach ($file in $actualFiles) {
                if ($file.FullName.Equals($marker, [StringComparison]::OrdinalIgnoreCase) -or $file.FullName.Equals($ownerPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
                if (-not $expected.ContainsKey($file.FullName)) { throw "Unarchived file: $($file.FullName)" }
                $entry = $expected[$file.FullName]
                if ($file.Length -ne [long]$entry.bytes) { throw "Modified file size: $($file.FullName)" }
                $digest = Get-FileDigest $file.FullName
                if (-not $digest.Equals($entry.sha256, [StringComparison]::OrdinalIgnoreCase)) { throw "Modified file hash: $($file.FullName)" }
                $row.files++; $row.bytes += $file.Length
            }
            # Resolve the tree once: thousands of revision:path requests repeatedly
            # reopen large trees on Windows. Still verify every referenced blob.
            $tree = @{}
            foreach ($line in (Invoke-GitText $dataRoot @('-c', 'core.quotePath=false', 'ls-tree', '-r', $id)).Split("`n")) {
                if ($line -match '^100[0-7]{3} blob ([a-f0-9]{40,64})\t(.+)$') { $tree[$Matches[2]] = $Matches[1] }
            }
            $blobIds = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
            foreach ($stored in $archiveReferences) {
                if (-not $tree.ContainsKey($stored)) { throw 'An archived backup path is unavailable.' }
                [void]$blobIds.Add($tree[$stored])
            }
            $backup = (Invoke-GitText $dataRoot @('cat-file', '--batch-check') @($blobIds)).Split("`n")
            if ($backup.Count -ne $blobIds.Count) { throw 'Archived backups cannot be verified.' }
            foreach ($line in $backup) { if ([string]$line -notmatch ' blob [0-9]+$') { throw 'An archived backup blob is unavailable.' } }
            $eligibleBytes += $row.bytes
            $row.status = 'verified-unused'
            if ($Apply) {
                $protection = Get-Protection
                if ($protection.Pins.Contains($id)) { $row.status = 'protected-newly-active'; continue }
                if (-not (Test-UnchangedFiles $actualFiles $target)) { throw 'Files changed during verification; preserve cache.' }
                Remove-CheckedDirectory $target $cacheRoot
                $row.status = 'removed'; $deletedBytes += $row.bytes
                Write-Host "REMOVED $target ($($row.bytes) bytes)"
            } else { Write-Host "WOULD REMOVE $target ($($row.bytes) bytes)" }
        } catch {
            $row.status = 'protected-or-failed'; $row.reason = $_.Exception.Message
            Write-Warning "KEEP $($directory.FullName): $($row.reason)"
        }
    }

    if (-not $SkipWorkerRuntimes -and -not $Revision.Count) {
        $runtimeParent = Join-Path $RepositoryRoot 'assets/worker-runtime'
        $oldCopies = @('422b0412b53d61290ad9da853c3c5aeb', '446ebba7e5dc4e2691e947c8807446e8', 'b0cb939a8b27d1c145a352148012dc4c', 'bc4106298e35ed8501d195fe8441d6e2', 'e1d287d9ca4ae82b5bb18e2b823e4835')
        foreach ($id in $oldCopies) {
            $target = Get-ChildPath $runtimeParent $id
            if (-not (Test-Path -LiteralPath $target)) { continue }
            $row = [ordered]@{ kind = 'generated-worker'; path = $target; revision = $id; status = 'checking'; bytes = 0; files = 0; reason = '' }
            $rows.Add($row)
            try {
                if ((Invoke-GitText $RepositoryRoot @('ls-files', '--', "assets/worker-runtime/$id")).Trim()) { throw 'Tracked Worker assets are preserved.' }
                $protection = Get-Protection
                foreach ($root in $protection.Roots) {
                    foreach ($relativeMeta in @('assets/js/build-meta.js', 'apps/web-shell/dist/assets/js/build-meta.js')) {
                        $meta = Join-Path $root $relativeMeta
                        if ((Test-Path -LiteralPath $meta) -and (Get-Content -LiteralPath $meta -Raw).Contains("assets/worker-runtime/$id/")) { throw 'Worker copy is referenced by a current worktree or app stage.' }
                    }
                }
                $files = Get-PlainFiles $target
                if (-not $files.Count) { throw 'Unrecognized empty Worker directory.' }
                foreach ($file in $files) {
                    if ($file.Extension -ne '.js') { throw 'Unrecognized non-JavaScript Worker file; preserve it.' }
                    $row.files++; $row.bytes += $file.Length
                }
                $eligibleBytes += $row.bytes; $row.status = 'verified-unused'
                if ($Apply) {
                    $protection = Get-Protection
                    foreach ($root in $protection.Roots) {
                        foreach ($relativeMeta in @('assets/js/build-meta.js', 'apps/web-shell/dist/assets/js/build-meta.js')) {
                            $meta = Join-Path $root $relativeMeta
                            if ((Test-Path -LiteralPath $meta) -and (Get-Content -LiteralPath $meta -Raw).Contains("assets/worker-runtime/$id/")) { throw 'Worker became active during verification.' }
                        }
                    }
                    if (-not (Test-UnchangedFiles $files $target)) { throw 'Worker changed during verification.' }
                    Remove-CheckedDirectory $target $runtimeParent
                    $deletedBytes += $row.bytes; $row.status = 'removed'; Write-Host "REMOVED $target"
                } else { Write-Host "WOULD REMOVE $target" }
            } catch { $row.status = 'protected-or-failed'; $row.reason = $_.Exception.Message; Write-Warning "KEEP ${target}: $($row.reason)" }
        }
    }
    if ($IncludeRetiredAppBinaries -and -not $Revision.Count) {
        foreach ($root in (Get-Protection).Roots) {
            $nativeRoot = Join-Path $root 'apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug'
            $current = Join-Path $nativeRoot 'pandolab-web-shell.exe'
            $deps = Join-Path $nativeRoot 'deps'
            if (-not (Test-Path -LiteralPath $current) -or -not (Test-Path -LiteralPath $deps)) { continue }
            $currentItem = Get-Item -LiteralPath $current
            $currentHash = $null
            foreach ($file in Get-ChildItem -LiteralPath $deps -File -Filter 'pandolab_web_shell-*.exe') {
                if ($file.Name -notmatch '^pandolab_web_shell-([a-f0-9]{16})\.exe$') { continue }
                $fingerprint = Join-Path $nativeRoot ('.fingerprint/pandolab-web-shell-' + $Matches[1] + '/bin-pandolab-web-shell.json')
                if (-not (Test-Path -LiteralPath $fingerprint) -or $file.LastWriteTimeUtc -ge $currentItem.LastWriteTimeUtc) { continue }
                $row = [ordered]@{ kind = 'retired-app-binary'; path = $file.FullName; status = 'checking'; bytes = $file.Length; reason = '' }
                $rows.Add($row)
                try {
                    $builders = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(cargo|rustc|rust-lld)\.exe$' })
                    if ($builders.Count) { throw 'A native build is running.' }
                    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Executable is a link.' }
                    if (-not $currentHash) { $currentHash = Get-FileDigest $current }
                    if ((Get-FileDigest $file.FullName) -eq $currentHash) { throw 'Current executable copy is protected.' }
                    $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^pandolab' -and $_.ExecutablePath -eq $file.FullName })
                    if ($running.Count) { throw 'Executable is running.' }
                    if ($file.DirectoryName -ne [IO.Path]::GetFullPath($deps) -or (Resolve-DirectoryTarget $deps) -ne [IO.Path]::GetFullPath($deps)) { throw 'Unexpected executable parent.' }
                    $eligibleBytes += $file.Length; $row.status = 'verified-unused'
                    if ($Apply) {
                        $now = Get-Item -LiteralPath $file.FullName
                        if ($now.Length -ne $file.Length -or $now.LastWriteTimeUtc -ne $file.LastWriteTimeUtc) { throw 'Executable changed during review.' }
                        $currentNow = Get-Item -LiteralPath $current
                        if ($currentNow.Length -ne $currentItem.Length -or $currentNow.LastWriteTimeUtc -ne $currentItem.LastWriteTimeUtc) { throw 'Current application changed during review.' }
                        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                        $deletedBytes += $file.Length; $row.status = 'removed'; Write-Host "REMOVED $($file.FullName)"
                    } else { Write-Host "WOULD REMOVE $($file.FullName) ($($file.Length) bytes)" }
                } catch { $row.status = 'protected-or-failed'; $row.reason = $_.Exception.Message; Write-Warning "KEEP $($file.FullName): $($row.reason)" }
            }
        }
        # These completed Qt comparison runs predate the current WebView app.
        # Remove only their compiled test executables, retaining logs and inputs.
        $retiredQtRuns = @('qt-pair-70789caf-failed', 'qt-pair-4418b791', 'qt-pair-9bd078c7', 'qt-pair-ad3ba73b-baseline', 'qt-pair-ad3ba73b-candidate', 'qt-pair-b81c6173-baseline', 'qt-pair-b81c6173-candidate')
        foreach ($root in (Get-Protection).Roots) {
            $benchmarkRoot = Join-Path $root 'build-native/p9'
            foreach ($name in $retiredQtRuns) {
                $run = Join-Path $benchmarkRoot $name
                if (-not (Test-Path -LiteralPath $run)) { continue }
                try { $files = Get-PlainFiles $run } catch { Write-Warning "KEEP ${run}: $($_.Exception.Message)"; continue }
                foreach ($file in $files) {
                    if ($file.Name -notin @('baseline-ui_tests.exe', 'candidate-ui_tests.exe') -or $file.Directory.Name -ne 'qt-runtime') { continue }
                    $row = [ordered]@{ kind = 'retired-qt-test'; path = $file.FullName; status = 'checking'; bytes = $file.Length; reason = '' }
                    $rows.Add($row)
                    try {
                        $prefix = [IO.Path]::GetFullPath($run).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
                        if (-not $file.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test executable escapes its benchmark directory.' }
                        $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
                        if ((Invoke-GitText $root @('ls-files', '--', $relative)).Trim()) { throw 'Tracked test executable is protected.' }
                        $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('baseline-ui_tests.exe', 'candidate-ui_tests.exe', 'cmake.exe', 'ninja.exe', 'msbuild.exe') })
                        if ($running.Count) { throw 'A native test or build is running.' }
                        $eligibleBytes += $file.Length; $row.status = 'verified-unused'
                        if ($Apply) {
                            $now = Get-Item -LiteralPath $file.FullName
                            if ($now.Length -ne $file.Length -or $now.LastWriteTimeUtc -ne $file.LastWriteTimeUtc) { throw 'Test executable changed during review.' }
                            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                            $deletedBytes += $file.Length; $row.status = 'removed'; Write-Host "REMOVED $($file.FullName)"
                        } else { Write-Host "WOULD REMOVE $($file.FullName) ($($file.Length) bytes)" }
                    } catch { $row.status = 'protected-or-failed'; $row.reason = $_.Exception.Message; Write-Warning "KEEP $($file.FullName): $($row.reason)" }
                }
            }
        }
    }

    if ($IncludeGitTemporaryPacks -and -not $Revision.Count) {
        $packRoot = [IO.Path]::GetFullPath((Join-Path $common 'objects/pack'))
        if ((Resolve-DirectoryTarget $packRoot) -ne $packRoot) { throw 'Git pack directory is a link.' }
        $packs = @(Get-ChildItem -LiteralPath $packRoot -File -Filter 'tmp_pack_*' | Where-Object { $_.Name -match '^tmp_pack_[A-Za-z0-9]{6}$' })
        $packVerificationError = $null
        if ($packs.Count) {
            try {
                Assert-GitIdle $common
                # These names are not part of Git's object database. Prove all
                # locally required objects for refs and paired pins readable
                # offline. A partial clone may intentionally lack promisor
                # blobs; do not fetch them or confuse them with corruption.
                $pins = @((Get-Protection).Pins)
                [void](Invoke-GitText $dataRoot (@('rev-list', '--objects', '--all', '--quiet', '--missing=allow-promisor') + $pins))
            } catch { $packVerificationError = $_.Exception.Message }
        }
        foreach ($file in $packs) {
            $row = [ordered]@{ kind = 'abandoned-git-pack'; path = $file.FullName; status = 'checking'; bytes = $file.Length; reason = '' }
            $rows.Add($row)
            try {
                if ($packVerificationError) { throw $packVerificationError }
                Assert-GitIdle $common
                if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Temporary pack is a link.' }
                if (Test-Path -LiteralPath ($file.FullName + '.idx')) { throw 'Temporary pack has an index; review it separately.' }
                if ($file.DirectoryName -ne $packRoot -or (Resolve-DirectoryTarget $packRoot) -ne $packRoot) { throw 'Temporary pack is outside the verified directory.' }
                $stream = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
                $stream.Dispose()
                $eligibleBytes += $file.Length; $row.status = 'verified-unused'
                if ($Apply) {
                    Assert-GitIdle $common
                    $now = Get-Item -LiteralPath $file.FullName
                    if ($now.Length -ne $file.Length -or $now.LastWriteTimeUtc -ne $file.LastWriteTimeUtc) { throw 'Temporary pack changed during verification.' }
                    Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                    if (Test-Path -LiteralPath $file.FullName) { throw 'Temporary pack deletion did not finish.' }
                    $deletedBytes += $file.Length; $row.status = 'removed'; Write-Host "REMOVED $($file.FullName)"
                } else { Write-Host "WOULD REMOVE $($file.FullName) ($($file.Length) bytes)" }
            } catch { $row.status = 'protected-or-failed'; $row.reason = $_.Exception.Message; Write-Warning "KEEP $($file.FullName): $($row.reason)" }
        }
    }

    if ($IncludeEmulatorSnapshots -and -not $Revision.Count -and (Test-Path -LiteralPath $AndroidAvdRoot)) {
        $avdRoot = [IO.Path]::GetFullPath($AndroidAvdRoot).TrimEnd('\', '/')
        if ((Resolve-DirectoryTarget $avdRoot) -ne $avdRoot) { throw 'AVD root is a link.' }
        foreach ($avd in Get-ChildItem -LiteralPath $avdRoot -Directory -Filter '*.avd') {
            $parent = Join-Path $avd.FullName 'snapshots'
            $target = Join-Path $parent 'default_boot'
            if (-not (Test-Path -LiteralPath $target) -or -not (Test-Path -LiteralPath (Join-Path $avd.FullName 'config.ini'))) { continue }
            $row = [ordered]@{ kind = 'emulator-quickboot'; path = $target; status = 'checking'; bytes = 0; reason = '' }
            $rows.Add($row)
            try {
                if ($avd.Attributes -band [IO.FileAttributes]::ReparsePoint -or (Resolve-DirectoryTarget $parent) -ne $parent) { throw 'AVD or snapshots parent is a link.' }
                $files = Get-PlainFiles $target
                $incompleteRamOnly = $files.Count -eq 1 -and $files[0].FullName -eq (Join-Path $target 'ram.img')
                if (-not ($files | Where-Object { $_.FullName -eq (Join-Path $target 'snapshot.pb') }) -and -not $incompleteRamOnly) { throw 'Unrecognized snapshot layout.' }
                $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(emulator|qemu-system-.*|qemu)\.exe$' })
                if ($running.Count) { throw 'An emulator is running.' }
                foreach ($file in $files) { $row.bytes += $file.Length }
                $eligibleBytes += $row.bytes; $row.status = 'verified-unused'
                if ($Apply) {
                    if (-not (Test-UnchangedFiles $files $target)) { throw 'Snapshot changed during review.' }
                    $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(emulator|qemu-system-.*|qemu)\.exe$' })
                    if ($running.Count) { throw 'An emulator started during review.' }
                    Remove-CheckedDirectory $target $parent
                    $deletedBytes += $row.bytes; $row.status = 'removed'; Write-Host "REMOVED $target"
                } else { Write-Host "WOULD REMOVE $target ($($row.bytes) bytes)" }
            } catch { $row.status = 'protected-or-failed'; $row.reason = $_.Exception.Message; Write-Warning "KEEP ${target}: $($row.reason)" }
        }
    }
} finally {
    $env:GIT_NO_LAZY_FETCH = $oldLazyFetch
    $env:GIT_OPTIONAL_LOCKS = $oldOptionalLocks
    if ($lockStream) { $lockStream.Dispose(); Remove-Item -LiteralPath $lockPath -Force }
    $freeBytesAfter = (New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($cacheRoot))).AvailableFreeSpace
    $result = [ordered]@{ schemaVersion = 1; at = (Get-Date).ToUniversalTime().ToString('o'); apply = [bool]$Apply; repository = $RepositoryRoot; cacheRoot = $cacheRoot; freeBytesBefore = $freeBytesBefore; freeBytesAfter = $freeBytesAfter; freeBytesDelta = $freeBytesAfter - $freeBytesBefore; eligibleBytes = $eligibleBytes; deletedBytes = $deletedBytes; entries = @($rows.ToArray()) }
    if ($Apply) {
        [void](New-Item -ItemType Directory -Path $reportDirectory -Force)
        $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Write-Host "Report: $reportPath"
    } else { $result | ConvertTo-Json -Depth 10 }
    Write-Host ('Eligible: {0:N2} GiB; removed: {1:N2} GiB' -f ($eligibleBytes / 1GB), ($deletedBytes / 1GB))
}
