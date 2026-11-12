# Build, verify, and package THK Desktop for Windows.
param([switch]$SkipTests, [switch]$Online)
$ErrorActionPreference = 'Stop'
$ProjectDir = $PSScriptRoot
$ReleaseDir = Join-Path $ProjectDir 'target\release'
$AppVersion = ([regex]::Match((Get-Content -LiteralPath (Join-Path $ProjectDir 'Cargo.toml') -Raw), '(?m)^version\s*=\s*"([^"]+)"')).Groups[1].Value
if (-not $AppVersion) { throw 'Cannot determine app version' }
$PackageDir = Join-Path $ProjectDir "dist\THK-Chat-v$AppVersion-Windows-x64"

$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$CargoNetwork = if ($Online) { @() } else { @('--offline') }
$RustInfo = & rustc -vV
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine Rust host' }
$IsGnu = [bool]($RustInfo -match '^host: .*windows-gnu$')
$LinkFlags = if ($IsGnu) { @('-C','linker=rust-lld','-C','linker-flavor=ld.lld') } else { @() }
# Apply LLD to the application link only. Dependencies retain their normal toolchain.
# This also avoids rebuilding every dependency merely to change the final linker.
function Invoke-Cargo([string[]]$CargoArguments) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & cargo @CargoArguments
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($code -ne 0) { throw "cargo $CargoArguments failed (exit $code)" }
}
Push-Location -LiteralPath $ProjectDir
try {
    if (-not $SkipTests) {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $testArgs = @('rustc','--tests','--locked','--message-format=json-render-diagnostics') + $CargoNetwork
        if ($LinkFlags.Count -gt 0) { $testArgs += @('--') + $LinkFlags }
        $artifacts = & cargo @testArgs
        $compileCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($compileCode -ne 0) { throw 'Test compilation failed' }
        $testExecutables = @($artifacts | ForEach-Object {
            try { $artifact = $_ | ConvertFrom-Json } catch { return }
            if ($artifact.reason -eq 'compiler-artifact' -and $artifact.profile.test -and $artifact.executable) { $artifact.executable }
        })
        if ($testExecutables.Count -eq 0) { throw 'Test executable missing' }
        foreach ($testExecutable in $testExecutables) {
            & $testExecutable
            if ($LASTEXITCODE -ne 0) { throw "Tests failed: $testExecutable" }
        }
    }
    $releaseArgs = @('rustc','--release','--locked') + $CargoNetwork
    if ($LinkFlags.Count -gt 0) { $releaseArgs += @('--') + $LinkFlags }
    Invoke-Cargo $releaseArgs
    $binary = Join-Path $ReleaseDir 'chatwork.exe'
    if (-not (Test-Path -LiteralPath $binary)) { throw 'Release executable missing' }

    $loader = Join-Path $ReleaseDir 'WebView2Loader.dll'
    if (-not (Test-Path -LiteralPath $loader)) { throw 'WebView2Loader.dll missing from release output' }
    New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
    Copy-Item -LiteralPath $binary -Destination (Join-Path $PackageDir 'THK-Chat.exe') -Force
    Copy-Item -LiteralPath $loader -Destination $PackageDir -Force
    $packageAssets = Join-Path $PackageDir 'assets'
    New-Item -ItemType Directory -Force -Path $packageAssets | Out-Null
    Copy-Item -Path (Join-Path $ProjectDir 'assets\*') -Destination $packageAssets -Recurse -Force
    '@echo off', 'start "" "%~dp0THK-Chat.exe"' | Set-Content -LiteralPath (Join-Path $PackageDir 'THK-ChatLauncher.bat') -Encoding ASCII

    $nsis = 'C:\Program Files (x86)\NSIS\makensis.exe'
    if (Test-Path -LiteralPath $nsis) {
        & $nsis "/DAPP_VERSION=$AppVersion" (Join-Path $ProjectDir 'installer.nsi')
        if ($LASTEXITCODE -ne 0) { throw 'NSIS installer build failed' }
        $setup = Join-Path $ProjectDir 'THK-ChatSetup.exe'
        if (-not (Test-Path -LiteralPath $setup)) { throw 'Installer output missing' }
        Copy-Item -LiteralPath $setup -Destination (Join-Path $ProjectDir "dist\THK-ChatSetup-v$AppVersion.exe") -Force
    } else { Write-Warning 'NSIS unavailable; portable package was created.' }
    $portable = Join-Path $ProjectDir "dist\THK-Chat-v$AppVersion-Windows-x64.zip"
    Compress-Archive -Path (Join-Path $PackageDir '*') -DestinationPath $portable -Force
    $hashFiles = @($portable)
    $versionedSetup = Join-Path $ProjectDir "dist\THK-ChatSetup-v$AppVersion.exe"
    if (Test-Path -LiteralPath $versionedSetup) { $hashFiles += $versionedSetup }
    $hashFiles | ForEach-Object { $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256; "$($hash.Hash.ToLower())  $([IO.Path]::GetFileName($_))" } | Set-Content -LiteralPath (Join-Path $ProjectDir "dist\THK-Chat-v$AppVersion-Windows-SHA256.txt") -Encoding ASCII
    Write-Host "Built THK-Chat $AppVersion"
    Write-Host "Application: $PackageDir\THK-Chat.exe"
    Write-Host "Portable ZIP: $portable"
} finally { Pop-Location }
