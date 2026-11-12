param([string]$Package = (Join-Path $PSScriptRoot '..\dist\THK-Chat-v2.26.0-Windows-x64.zip'))
$ErrorActionPreference = 'Stop'
$Project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$TestRoot = Join-Path $Project ('target\diagnostics\ota-' + [Guid]::NewGuid().ToString('N'))
if (-not $TestRoot.StartsWith((Join-Path $Project 'target\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test directory' }
New-Item -ItemType Directory -Path $TestRoot | Out-Null
$Version = ([regex]::Match((Get-Content (Join-Path $Project 'Cargo.toml') -Raw), '(?m)^version\s*=\s*"([^"]+)"')).Groups[1].Value
$Binary = Join-Path $Project "dist\THK-Chat-v$Version-Windows-x64\THK-Chat.exe"
$Loader = Join-Path $Project "dist\THK-Chat-v$Version-Windows-x64\WebView2Loader.dll"
$Install = Join-Path $TestRoot 'installed app'
New-Item -ItemType Directory -Path $Install | Out-Null
Copy-Item -LiteralPath $Binary -Destination (Join-Path $Install 'THK-Chat.exe')
[IO.File]::AppendAllText((Join-Path $Install 'THK-Chat.exe'), 'OLD-BINARY-MARKER')
Copy-Item -LiteralPath $Loader -Destination $Install
New-Item -ItemType Directory -Path (Join-Path $Install 'assets') | Out-Null
Set-Content -LiteralPath (Join-Path $Install 'assets\old-marker.txt') -Value 'old assets'
Set-Content -LiteralPath (Join-Path $Install 'user-draft.txt') -Value 'keep my draft'
$OldHash = (Get-FileHash -LiteralPath (Join-Path $Install 'THK-Chat.exe')).Hash
$ExpectedHash = (Get-FileHash -LiteralPath $Package).Hash
function Case-Work([string]$Name) {
    $work = Join-Path $TestRoot $Name
    New-Item -ItemType Directory -Path $work | Out-Null
    Copy-Item -LiteralPath $Package -Destination (Join-Path $work 'package.download')
    return $work
}
function Invoke-Helper([string]$Mode, [string]$Work, [string]$Digest) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Project 'ota\windows-update.ps1') -Mode $Mode -WorkDir $Work -InstallDir $Install -Version $Version -ExpectedHash $Digest -ResultFile (Join-Path $Work 'result.json') 2>&1 | ForEach-Object { Write-Host $_.ToString() }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    return $code
}
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

$badHash = Case-Work 'bad-hash'
Assert ((Invoke-Helper 'Prepare' $badHash ('0' * 64)) -eq 1) 'Checksum mismatch was accepted'
Assert ((Get-FileHash -LiteralPath (Join-Path $Install 'THK-Chat.exe')).Hash -eq $OldHash) 'Checksum failure changed installed app'

$slip = Join-Path $TestRoot 'zip-slip'; New-Item -ItemType Directory -Path $slip | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::Open((Join-Path $slip 'package.download'), [IO.Compression.ZipArchiveMode]::Create)
$stream = New-Object IO.StreamWriter(($zip.CreateEntry('../escaped.txt')).Open()); $stream.Write('escape'); $stream.Dispose(); $zip.Dispose()
Assert ((Invoke-Helper 'Prepare' $slip (Get-FileHash -LiteralPath (Join-Path $slip 'package.download')).Hash) -eq 1) 'Zip slip was accepted'
Assert (-not (Test-Path -LiteralPath (Join-Path $slip 'escaped.txt'))) 'Archive escaped its payload folder'

$locked = Case-Work 'locked-dll'
$lock = [IO.File]::Open((Join-Path $Install 'WebView2Loader.dll'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
try { Assert ((Invoke-Helper 'Install' $locked $ExpectedHash) -eq 1) 'Locked DLL should fail and roll back' } finally { $lock.Dispose() }
Assert ((Get-FileHash -LiteralPath (Join-Path $Install 'THK-Chat.exe')).Hash -eq $OldHash) 'Partial update did not restore old executable'
Assert (Test-Path -LiteralPath (Join-Path $Install 'assets\old-marker.txt')) 'Rollback lost old assets'

$good = Case-Work 'success'
Assert ((Invoke-Helper 'Prepare' $good $ExpectedHash) -eq 0) 'Valid update failed preparation'
Assert ((Get-FileHash -LiteralPath (Join-Path $Install 'THK-Chat.exe')).Hash -eq $OldHash) 'Preparation replaced active app'
Assert ((Invoke-Helper 'Install' $good $ExpectedHash) -eq 0) 'Valid update failed installation'
Assert ((Get-FileHash -LiteralPath (Join-Path $Install 'THK-Chat.exe')).Hash -eq (Get-FileHash -LiteralPath $Binary).Hash) 'New binary hash differs'
Assert ((Get-FileHash -LiteralPath (Join-Path $good 'backup\THK-Chat.exe')).Hash -eq $OldHash) 'Previous version backup missing'
Assert ((Get-Content -LiteralPath (Join-Path $Install 'user-draft.txt') -Raw).Trim() -eq 'keep my draft') 'Unmanaged user data was changed'
Assert ((Get-Content -LiteralPath (Join-Path $good 'result.json') -Raw | ConvertFrom-Json).status -eq 'success') 'Success result missing'
Write-Host 'OTA checksum, archive paths, rollback, preparation, installation and data preservation passed.'
