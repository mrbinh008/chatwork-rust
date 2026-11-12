param(
    [ValidateSet('Prepare','Install')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$WorkDir,
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$ExpectedHash,
    [Parameter(Mandatory=$true)][string]$ResultFile,
    [int]$ParentPid = 0,
    [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$WorkDir = [IO.Path]::GetFullPath($WorkDir)
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$Payload = Join-Path $WorkDir 'payload'
$Backup = Join-Path $WorkDir 'backup'
$Log = Join-Path $WorkDir 'install.log'
$Managed = @('THK-Chat.exe','WebView2Loader.dll','assets','THK-ChatLauncher.bat')
$Moved = New-Object 'System.Collections.Generic.List[string]'
$Placed = New-Object 'System.Collections.Generic.List[string]'
$ParentExited = $false
function Assert-Within([string]$Path, [string]$Root) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update path escapes its destination.' }
    return $full
}
function Remove-Owned([string]$Path, [string]$Root) {
    $checked = Assert-Within $Path $Root
    if (Test-Path -LiteralPath $checked) {
        if ((Get-Item -LiteralPath $checked -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to remove an update symlink.' }
        Remove-Item -LiteralPath $checked -Recurse -Force
    }
}
function Move-Retry([string]$From, [string]$To) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { Move-Item -LiteralPath $From -Destination $To -ErrorAction Stop; return }
        catch { if ($attempt -eq 59) { throw }; Start-Sleep -Milliseconds 500 }
    }
}
function Prepare-Package {
    if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $ExpectedHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid update version or digest.' }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'THK-Chat.exe') -PathType Leaf)) { throw 'Run the packaged THK-Chat.exe before updating.' }
    $archive = Assert-Within (Join-Path $WorkDir 'package.download') $WorkDir
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $ExpectedHash) { throw 'SHA-256 mismatch. The update was not installed.' }
    Remove-Owned $Payload $WorkDir
    New-Item -ItemType Directory -Path $Payload | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        [long]$total = 0
        if ($zip.Entries.Count -gt 10000) { throw 'Too many archive entries.' }
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            $parts = $name.TrimEnd('/').Split('/')
            if ($name.StartsWith('/') -or $parts.Count -eq 0 -or ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' -or $_ -match '[:<>"|?*\x00-\x1f]' -or $_.EndsWith('.') -or $_.EndsWith(' ') })) { throw 'Unsafe archive path.' }
            if ($name -notin @('THK-Chat.exe','WebView2Loader.dll','THK-ChatLauncher.bat','assets/') -and -not $name.StartsWith('assets/', [StringComparison]::Ordinal)) { throw "Unexpected archive entry: $name" }
            if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Archive symlinks are not supported.' }
            $destination = Assert-Within (Join-Path $Payload ($name.Replace('/','\'))) $Payload
            if (-not $seen.Add($destination)) { throw 'Duplicate archive path.' }
            $total += $entry.Length
            if ($total -gt 2147483648) { throw 'Expanded update is too large.' }
            if ($name.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $destination | Out-Null }
            else {
                New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destination)) | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
            }
        }
    } finally { $zip.Dispose() }
    foreach ($name in @('THK-Chat.exe','WebView2Loader.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Payload $name) -PathType Leaf)) { throw "Missing update file: $name" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Payload 'assets\thk.ico') -PathType Leaf)) { throw 'Missing app icon in update package.' }
    $binaryVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $Payload 'THK-Chat.exe')).ProductVersion
    if ([Version]$binaryVersion -ne [Version]"$Version.0") { throw 'Executable version does not match the GitHub release.' }
    $probe = Join-Path $InstallDir ('.thk-write-' + [Guid]::NewGuid().ToString('N'))
    $probe = Assert-Within $probe $InstallDir
    [IO.File]::WriteAllText($probe, '')
    Remove-Item -LiteralPath $probe -Force
}
function Write-Result([string]$Status, [string]$Message) {
    @{ status=$Status; version=$Version; message=$Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultFile -Encoding UTF8
}
try {
    Prepare-Package
    if ($Mode -eq 'Prepare') { Write-Output 'Package verified'; exit 0 }
    if ($ParentPid -gt 0) {
        $parentProcess = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
        if ($parentProcess -and -not $parentProcess.WaitForExit(60000)) { throw 'The app did not close in time. Try updating again.' }
    }
    $ParentExited = $true
    New-Item -ItemType Directory -Path $Backup | Out-Null
    foreach ($name in $Managed) {
        $target = Assert-Within (Join-Path $InstallDir $name) $InstallDir
        if (Test-Path -LiteralPath $target) {
            Move-Retry $target (Assert-Within (Join-Path $Backup $name) $Backup)
            $Moved.Add($name)
        }
        $source = Assert-Within (Join-Path $Payload $name) $Payload
        if (Test-Path -LiteralPath $source) {
            Move-Retry $source $target
            $Placed.Add($name)
        }
    }
    # Update installer metadata only for an installation registered at this path.
    $registered = Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\THK\Desktop' -Name InstallPath -ErrorAction SilentlyContinue
    if ($registered -and [IO.Path]::GetFullPath($registered).TrimEnd('\') -ieq $InstallDir) {
        Set-ItemProperty -LiteralPath 'HKCU:\Software\THK\Desktop' -Name Version -Value $Version
        Set-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\THK' -Name DisplayVersion -Value $Version -ErrorAction SilentlyContinue
    }
    Write-Result 'success' 'Update installed.'
    if ($Restart) { Start-Process -FilePath (Join-Path $InstallDir 'THK-Chat.exe') -WorkingDirectory $InstallDir }
    # Keep one previous package in this session's backup for recovery.
    exit 0
} catch {
    $message = $_.Exception.Message
    $message | Out-File -LiteralPath $Log -Append -Encoding UTF8
    if ($Mode -eq 'Install') {
        try {
            foreach ($name in $Placed) { Remove-Owned (Join-Path $InstallDir $name) $InstallDir }
            foreach ($name in $Moved) {
                Move-Retry (Assert-Within (Join-Path $Backup $name) $Backup) (Assert-Within (Join-Path $InstallDir $name) $InstallDir)
            }
        } catch { $message += ' Recovery error: ' + $_.Exception.Message }
        Write-Result 'error' $message
        if ($Restart -and $ParentExited -and (Test-Path -LiteralPath (Join-Path $InstallDir 'THK-Chat.exe'))) {
            Start-Process -FilePath (Join-Path $InstallDir 'THK-Chat.exe') -WorkingDirectory $InstallDir
        }
    }
    [Console]::Error.WriteLine($message)
    exit 1
}
