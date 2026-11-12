# Build the current source for Apple Silicon and Intel using Docker.
param([switch]$RebuildBuilder)
$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$LogDir = Join-Path $ScriptDir 'target\diagnostics'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir ("mac-build-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Write-Host "macOS build log: $LogPath"
function Invoke-Docker([string[]]$DockerArguments) {
    ("docker arguments: " + (ConvertTo-Json -InputObject $DockerArguments -Compress)) | Out-File -LiteralPath $LogPath -Append -Encoding utf8
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker @DockerArguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            $line | Out-File -LiteralPath $LogPath -Append -Encoding utf8
            Write-Host $line
        }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw "macOS build stopped (Docker exit $code). Original compiler output is above. Full log: $LogPath" }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is not installed or unavailable in PATH.' }
Invoke-Docker @('version', '--format', '{{.Server.Version}}')
$ErrorActionPreference = 'Continue'
& docker image inspect mac-builder *> $null
$imageExists = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if ($RebuildBuilder -or -not $imageExists) { Invoke-Docker @('build', '-t', 'mac-builder', '-f', (Join-Path $ScriptDir 'Dockerfile.mac-builder'), $ScriptDir) }
Invoke-Docker @('run', '--rm', '--mount', "type=bind,source=$ScriptDir,target=/workspace", '--workdir', '/workspace', 'mac-builder', 'bash', 'mac/build-universal.sh', '--universal')

if (Test-Path "$ScriptDir\dist\THK.app") {
    Compress-Archive -Path "$ScriptDir\dist\THK.app" -DestinationPath "$ScriptDir\dist\THK-macOS-Universal.zip" -Force
    Write-Host "Created $ScriptDir\dist\THK-macOS-Universal.zip" -ForegroundColor Green
}

Write-Host 'macOS Universal build finished. See the versioned archive in dist.'
