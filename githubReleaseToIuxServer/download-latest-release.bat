@echo off
chcp 65001 >nul 2>&1
title GitHub Release Sync - Hi.Design Stable
set "SCRIPT_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$m='PS'+'_BODY'; $c=Get-Content -Raw -LiteralPath '%~f0'; $c=$c -replace ('(?s)^.*?'+$m),''; Invoke-Expression $c"

echo.
pause
goto :EOF
::PS_BODY

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {

# --- Configuration (from config.json next to this script) ---
$configPath = Join-Path $env:SCRIPT_DIR 'config.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw "Config file not found: $configPath" }
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$Repo        = $config.repo
$versionsDir = $config.versionsDir
$latestDir   = $config.latestDir
$token       = $config.token
$downloader  = $config.downloader
if (-not $downloader) { $downloader = 'auto' }
$ApiUrl      = "https://api.github.com/repos/$Repo/releases/latest"

# --- Detect aria2c (multi-thread CLI downloader) ---
$aria2cExe = $null
$cmd = Get-Command aria2c -ErrorAction SilentlyContinue
if ($cmd) { $aria2cExe = $cmd.Source }

# --- If not in PATH, check known install location ---
if (-not $aria2cExe) {
    $installDir = Join-Path $env:LOCALAPPDATA 'bin'
    $candidate = Join-Path $installDir 'aria2c.exe'
    if (Test-Path -LiteralPath $candidate) {
        $aria2cExe = $candidate
        $env:PATH = "$env:PATH;$installDir"
    }
}

# --- Auto-install aria2c if still not found (and not forced to curl) ---
if (-not $aria2cExe -and $downloader -ne 'curl') {
    Write-Host 'aria2c not found. Auto-installing...' -ForegroundColor Yellow
    try {
        $installDir  = Join-Path $env:LOCALAPPDATA 'bin'
        $aria2cUrl   = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
        $zipPath     = Join-Path $env:TEMP 'aria2-install.zip'
        $extractDir  = Join-Path $env:TEMP 'aria2-extract'

        $p = Start-Process -FilePath 'curl.exe' -ArgumentList "-L --progress-bar -o `"$zipPath`" `"$aria2cUrl`"" -NoNewWindow -Wait -PassThru
        if ($p.ExitCode -ne 0) { throw "Download failed (exit $($p.ExitCode))" }

        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

        $exe = Get-ChildItem $extractDir -Recurse -Filter 'aria2c.exe' | Select-Object -First 1
        if (-not $exe) { throw 'aria2c.exe not found in archive' }

        if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Force -Path $installDir | Out-Null }
        Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $installDir 'aria2c.exe') -Force
        $aria2cExe = Join-Path $installDir 'aria2c.exe'
        $env:PATH = "$env:PATH;$installDir"

        $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
        if (-not ($userPath.Split(';') -contains $installDir)) {
            $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
            [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
        }

        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

        Write-Host "aria2c installed: $aria2cExe" -ForegroundColor Green
    } catch {
        Write-Host "Auto-install failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host 'Falling back to curl.' -ForegroundColor Yellow
    }
}

# --- Determine downloader mode ---
# auto:  aria2c > curl
# aria2c / curl: force that mode
if ($downloader -eq 'auto') {
    if ($aria2cExe) { $dlMode = 'aria2c' } else { $dlMode = 'curl' }
} elseif ($downloader -eq 'aria2c') {
    if ($aria2cExe) { $dlMode = 'aria2c' }
   else { Write-Host 'aria2c not found, using curl.' -ForegroundColor Yellow; $dlMode = 'curl' }
} else {
    $dlMode = 'curl'
}

if ($dlMode -eq 'aria2c') {
    Write-Host "Downloader: aria2c (16-thread, console progress) -> $aria2cExe" -ForegroundColor Green
} else {
    Write-Host 'Downloader: curl (console progress bar)' -ForegroundColor Green
}
Write-Host ''

# --- Step 1: Fetch latest release ---
Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '  GitHub Release Sync - Hi.Design Stable'    -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "Repository: $Repo" -ForegroundColor Gray
Write-Host 'Fetching latest release from GitHub...'      -ForegroundColor Gray
Write-Host ''

$headers = @{
    'User-Agent' = 'od-release-sync'
    'Accept'     = 'application/vnd.github+json'
}
if ($token) { $headers['Authorization'] = "Bearer $token" }

try {
    $release = Invoke-RestMethod -Uri $ApiUrl -Headers $headers -TimeoutSec 30
} catch {
    $detail = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $detail = $_.ErrorDetails.Message
    }
    throw "GitHub API error: $detail"
}

$tagName = $release.tag_name
if (-not $tagName) { throw 'Could not determine release tag name.' }

if (-not $release.assets) { throw 'Latest release has no assets.' }
$assets = @($release.assets)

Write-Host "Latest release: $tagName" -ForegroundColor Green
Write-Host "Total assets:   $($assets.Count)" -ForegroundColor Gray
Write-Host ''

# --- Step 2: Prepare directories ---
$versionDir = Join-Path $versionsDir $tagName
New-Item -ItemType Directory -Force -Path $versionDir | Out-Null
New-Item -ItemType Directory -Force -Path $latestDir  | Out-Null

# Temp buffer: download here first, copy to target only after ALL succeed
$tempDir = Join-Path $env:TEMP "hi-design-sync\$tagName"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

Write-Host 'Output directories (created if missing):' -ForegroundColor Gray
Write-Host "  Assets:        $versionDir" -ForegroundColor Gray
Write-Host "  metadata.json: $latestDir" -ForegroundColor Gray
Write-Host "  Temp (buffer): $tempDir" -ForegroundColor DarkGray
Write-Host ''

# --- Step 3: Filter assets (skip .sha256; metadata.json last) ---
$downloadAssets = @($assets | Where-Object {
    $_.name -notlike '*.sha256' -and $_.name -ne 'metadata.json'
})
$metadataAsset = @($assets | Where-Object { $_.name -eq 'metadata.json' }) | Select-Object -First 1

Write-Host "Assets to download: $($downloadAssets.Count) (excluding .sha256)" -ForegroundColor Cyan
if ($metadataAsset) {
    Write-Host "metadata.json:      will be downloaded last to 'latest'" -ForegroundColor Gray
} else {
    Write-Host 'WARNING: metadata.json not found in release assets' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '--------------------------------------------' -ForegroundColor DarkGray
Write-Host ''

# --- Helper: download one file ---
function Invoke-Download {
    param($Url, $DestPath)
    if ($dlMode -eq 'aria2c') {
        $dir  = Split-Path -Parent $DestPath
        $file = Split-Path -Leaf $DestPath
        $args = '-x 16 -s 16 -k 1M --allow-overwrite=true --auto-file-renaming=false -d "{0}" -o "{1}" "{2}"' -f $dir, $file, $Url
        $p = Start-Process -FilePath $aria2cExe -ArgumentList $args -NoNewWindow -Wait -PassThru
        if ($p.ExitCode -ne 0) {
            Write-Host "  FAILED (exit code $($p.ExitCode))" -ForegroundColor Red
            return $false
        }
        Write-Host '  OK' -ForegroundColor Green
        return $true
    } else {
        $args = '-L --progress-bar -o "{0}" "{1}"' -f $DestPath, $Url
        $p = Start-Process -FilePath 'curl.exe' -ArgumentList $args -NoNewWindow -Wait -PassThru
        if ($p.ExitCode -ne 0) {
            Write-Host "  FAILED (exit code $($p.ExitCode))" -ForegroundColor Red
            return $false
        }
        Write-Host '  OK' -ForegroundColor Green
        return $true
    }
}

# --- Step 4: Download each asset ---
$successCount = 0
$failCount    = 0
$idx          = 0

foreach ($asset in $downloadAssets) {
    $idx++
    $url    = $asset.browser_download_url
    $sizeMB = [math]::Round($asset.size / 1MB, 1)

    Write-Host "[$idx/$($downloadAssets.Count)] $($asset.name)  ($sizeMB MB)" -ForegroundColor Yellow

    $dlPath = Join-Path $tempDir $asset.name
    $ok = Invoke-Download -Url $url -DestPath $dlPath
    if ($ok) { $successCount++ } else { $failCount++ }
    Write-Host ''
}

# --- Step 5: Download metadata.json LAST ---
if ($metadataAsset) {
    $metaUrl = $metadataAsset.browser_download_url
    $sizeKB  = [math]::Round($metadataAsset.size / 1KB, 1)

    Write-Host "[$($idx + 1)] metadata.json  ($sizeKB KB) -> latest" -ForegroundColor Magenta

    $dlPath = Join-Path $tempDir 'metadata.json'
    $ok = Invoke-Download -Url $metaUrl -DestPath $dlPath
    if ($ok) { $successCount++ } else { $failCount++ }
    Write-Host ''
}

# --- Step 6: Copy from temp to target (only if all succeeded) ---
if ($failCount -eq 0) {
    Write-Host '--- Copying files to target directories ---' -ForegroundColor Cyan
    Write-Host ''
    foreach ($asset in $downloadAssets) {
        $src = Join-Path $tempDir $asset.name
        $dst = Join-Path $versionDir $asset.name
        Copy-Item -LiteralPath $src -Destination $dst -Force
        Write-Host "  $($asset.name) -> $versionDir" -ForegroundColor Gray
    }
    if ($metadataAsset) {
        $src = Join-Path $tempDir 'metadata.json'
        $dst = Join-Path $latestDir 'metadata.json'
        Copy-Item -LiteralPath $src -Destination $dst -Force
        Write-Host "  metadata.json -> $latestDir" -ForegroundColor Gray
    }
    Write-Host ''
    Write-Host 'All files copied to target directories.' -ForegroundColor Green
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "$failCount download(s) failed." -ForegroundColor Yellow
    Write-Host 'Target directories NOT modified.' -ForegroundColor Yellow
    Write-Host "Partial downloads kept in temp: $tempDir" -ForegroundColor DarkGray
}

# --- Summary ---
Write-Host '--------------------------------------------' -ForegroundColor DarkGray
Write-Host '============================================' -ForegroundColor Cyan
if ($failCount -eq 0) {
    Write-Host "  All downloads complete: $successCount succeeded" -ForegroundColor Green
} else {
    Write-Host "  Finished: $successCount succeeded, $failCount failed" -ForegroundColor Yellow
}
Write-Host "  Version: $tagName" -ForegroundColor Gray
Write-Host "  Downloader: $dlMode" -ForegroundColor Gray
Write-Host '============================================' -ForegroundColor Cyan

} catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
}
