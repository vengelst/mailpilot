<#
.SYNOPSIS
    Interactive MailPilot deploy helper (no required parameters).

.DESCRIPTION
    Script asks all values interactively, offers a menu and supports:
      1) App checks + push/version workflow
      2) Deploy app to server
      3) Deploy app + copy/import DB file to server
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host ""; Write-Host "=================================" -ForegroundColor Cyan; Write-Host "  $msg" -ForegroundColor Cyan; Write-Host "=================================" -ForegroundColor Cyan }
function Write-Info([string]$msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "[ OK ]  $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

function Invoke-Checked([string]$desc, [scriptblock]$action) {
    Write-Info $desc
    & $action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        Fail "Schritt fehlgeschlagen: $desc (Exit $LASTEXITCODE)"
    }
    Write-Ok "Erfolgreich: $desc"
}

function Quote-Bash([string]$value) {
    if ($null -eq $value) { return "''" }
    $quoteBreak = "'" + '"' + "'" + '"' + "'"
    $escaped = ($value -split "'") -join $quoteBreak
    return "'" + $escaped + "'"
}

function Ask-Text([string]$prompt, [string]$default = "") {
    $suffix = if ($default) { " [$default]" } else { "" }
    $v = Read-Host "$prompt$suffix"
    if ([string]::IsNullOrWhiteSpace($v)) { return $default }
    return $v.Trim()
}

function Ask-YesNo([string]$prompt, [bool]$default = $true) {
    $hint = if ($default) { "[J/n]" } else { "[j/N]" }
    $v = (Read-Host "$prompt $hint").Trim().ToLowerInvariant()
    if (-not $v) { return $default }
    return @("j","ja","y","yes") -contains $v
}

function Get-DefaultDeployConfig {
    return @{
        remoteName = "vengelst"
        branch = "master"
        repoUrl = "https://github.com/vengelst/mailpilot"
        serverHost = "mailpilot.vivahome.de"
        serverUser = "root"
        serverPath = "/opt/mailpilot"
        nginxConfigLocalPath = "deploy/nginx/mailpilot.vivahome.de.conf"
        nginxConfigName = "mailpilot.vivahome.de.conf"
        nginxSitesAvailablePath = "/etc/nginx/sites-available"
        nginxSitesEnabledPath = "/etc/nginx/sites-enabled"
        forceServerReset = $true
    }
}

function Convert-ToPsLiteral([object]$value) {
    if ($value -is [bool]) { return $(if ($value) { '$true' } else { '$false' }) }
    if ($null -eq $value) { return "''" }
    $text = [string]$value
    return "'" + ($text -replace "'", "''") + "'"
}

function Save-DeployConfig([string]$path, [hashtable]$config) {
    $lines = @(
        "@{"
        "    remoteName = $(Convert-ToPsLiteral $config.remoteName)"
        "    branch = $(Convert-ToPsLiteral $config.branch)"
        "    repoUrl = $(Convert-ToPsLiteral $config.repoUrl)"
        "    serverHost = $(Convert-ToPsLiteral $config.serverHost)"
        "    serverUser = $(Convert-ToPsLiteral $config.serverUser)"
        "    serverPath = $(Convert-ToPsLiteral $config.serverPath)"
        "    nginxConfigLocalPath = $(Convert-ToPsLiteral $config.nginxConfigLocalPath)"
        "    nginxConfigName = $(Convert-ToPsLiteral $config.nginxConfigName)"
        "    nginxSitesAvailablePath = $(Convert-ToPsLiteral $config.nginxSitesAvailablePath)"
        "    nginxSitesEnabledPath = $(Convert-ToPsLiteral $config.nginxSitesEnabledPath)"
        "    forceServerReset = $(Convert-ToPsLiteral $config.forceServerReset)"
        "}"
    )
    Set-Content -Path $path -Value $lines -Encoding UTF8
}

function Load-DeployConfig([string]$path) {
    $defaults = Get-DefaultDeployConfig
    if (-not (Test-Path $path)) {
        Save-DeployConfig -path $path -config $defaults
        return $defaults
    }

    try {
        $loaded = (& $path)
        if (-not ($loaded -is [hashtable])) {
            Write-Warn2 "Config-Datei hat ein unerwartetes Format. Defaults werden verwendet."
            Save-DeployConfig -path $path -config $defaults
            return $defaults
        }
    } catch {
        Write-Warn2 "Config-Datei konnte nicht gelesen werden. Defaults werden verwendet."
        Save-DeployConfig -path $path -config $defaults
        return $defaults
    }

    $merged = @{}
    foreach ($k in $defaults.Keys) {
        if ($loaded.ContainsKey($k) -and -not [string]::IsNullOrWhiteSpace([string]$loaded[$k])) {
            $merged[$k] = $loaded[$k]
        } else {
            $merged[$k] = $defaults[$k]
        }
    }
    $merged.forceServerReset = [bool]$merged.forceServerReset
    return $merged
}

function Show-DeployConfig([hashtable]$config) {
    Write-Step "Aktuelle Deploy-Konfiguration"
    Write-Info "Git remote: $($config.remoteName)"
    Write-Info "Git branch: $($config.branch)"
    Write-Info "Repo URL: $($config.repoUrl)"
    Write-Info "Server host: $($config.serverHost)"
    Write-Info "Server user: $($config.serverUser)"
    Write-Info "Server path: $($config.serverPath)"
    Write-Info "Nginx local config: $($config.nginxConfigLocalPath)"
    Write-Info "Nginx config name: $($config.nginxConfigName)"
    Write-Info "Nginx sites-available: $($config.nginxSitesAvailablePath)"
    Write-Info "Nginx sites-enabled: $($config.nginxSitesEnabledPath)"
    Write-Info "Force server reset: $($config.forceServerReset)"
}

function Edit-DeployConfig([hashtable]$configPathAndConfig) {
    $path = [string]$configPathAndConfig.path
    $config = [hashtable]$configPathAndConfig.config

    Show-DeployConfig -config $config

    $updated = @{}
    $updated.remoteName = Ask-Text "Git remote name" ([string]$config["remoteName"])
    $updated.branch = Ask-Text "Git branch" ([string]$config["branch"])
    $updated.repoUrl = Ask-Text "Repo URL" ([string]$config["repoUrl"])
    $updated.serverHost = Ask-Text "Server host" ([string]$config["serverHost"])
    $updated.serverUser = Ask-Text "Server user" ([string]$config["serverUser"])
    $updated.serverPath = Ask-Text "Server path" ([string]$config["serverPath"])
    $updated.nginxConfigLocalPath = Ask-Text "Nginx local config path" ([string]$config["nginxConfigLocalPath"])
    $updated.nginxConfigName = Ask-Text "Nginx config file name" ([string]$config["nginxConfigName"])
    $updated.nginxSitesAvailablePath = Ask-Text "Nginx sites-available path" ([string]$config["nginxSitesAvailablePath"])
    $updated.nginxSitesEnabledPath = Ask-Text "Nginx sites-enabled path" ([string]$config["nginxSitesEnabledPath"])
    $updated.forceServerReset = Ask-YesNo "Server bei lokalen Aenderungen hart zuruecksetzen?" ([bool]$config["forceServerReset"])

    if (-not $updated.repoUrl) { Fail "Repo URL ist erforderlich." }
    if (-not $updated.remoteName) { Fail "Git-Remote-Name ist fuer Push/Tag erforderlich." }
    if (-not $updated.nginxConfigLocalPath) { Fail "Nginx local config path ist erforderlich." }
    if (-not $updated.nginxConfigName) { Fail "Nginx config file name ist erforderlich." }
    if (-not $updated.nginxSitesAvailablePath) { Fail "Nginx sites-available path ist erforderlich." }
    if (-not $updated.nginxSitesEnabledPath) { Fail "Nginx sites-enabled path ist erforderlich." }

    $changed =
        ([string]$updated.remoteName -ne [string]$config["remoteName"]) -or
        ([string]$updated.branch -ne [string]$config["branch"]) -or
        ([string]$updated.repoUrl -ne [string]$config["repoUrl"]) -or
        ([string]$updated.serverHost -ne [string]$config["serverHost"]) -or
        ([string]$updated.serverUser -ne [string]$config["serverUser"]) -or
        ([string]$updated.serverPath -ne [string]$config["serverPath"]) -or
        ([string]$updated.nginxConfigLocalPath -ne [string]$config["nginxConfigLocalPath"]) -or
        ([string]$updated.nginxConfigName -ne [string]$config["nginxConfigName"]) -or
        ([string]$updated.nginxSitesAvailablePath -ne [string]$config["nginxSitesAvailablePath"]) -or
        ([string]$updated.nginxSitesEnabledPath -ne [string]$config["nginxSitesEnabledPath"]) -or
        ([bool]$updated.forceServerReset -ne [bool]$config["forceServerReset"])

    if (-not $changed) {
        Write-Info "Keine Aenderungen an der Konfiguration."
        return $config
    }

    Save-DeployConfig -path $path -config $updated
    Write-Ok "Konfiguration gespeichert: $path"
    return $updated
}

function Ensure-NoTrackedSecrets {
    $forbidden = @(".env", ".env.production", ".env.local")
    foreach ($f in $forbidden) {
        # Use --cached + pathspec so missing files do not emit git errors.
        $tracked = (& git ls-files --cached -- $f 2>$null)
        if ($tracked) { Fail "Abbruch: '$f' ist in Git getrackt." }
    }
}

function Get-GitRemoteFetchMap {
    $map = @{}
    $lines = (& git remote -v 2>$null)
    foreach ($line in $lines) {
        $parts = $line -split "\s+"
        if ($parts.Length -lt 3) { continue }
        $name = $parts[0].Trim()
        $url = $parts[1].Trim()
        $kind = $parts[2].Trim()
        if (-not $name -or -not $url) { continue }
        if ($kind -eq "(fetch)" -or -not $map.ContainsKey($name)) {
            $map[$name] = $url
        }
    }
    return $map
}

function Ensure-UsableGitRemote([string]$remoteName, [string]$repoUrl) {
    if (-not $remoteName) { Fail "Git-Remote-Name ist leer." }

    $remoteMap = Get-GitRemoteFetchMap
    if ($remoteMap.ContainsKey($remoteName)) {
        return $remoteName
    }

    if ($repoUrl) {
        foreach ($existingName in $remoteMap.Keys) {
            if ([string]$remoteMap[$existingName] -eq $repoUrl) {
                Write-Warn2 "Remote '$remoteName' existiert nicht. Verwende vorhandenes Remote '$existingName' mit gleicher URL."
                return $existingName
            }
        }
    }

    if (-not $repoUrl) {
        Fail "Remote '$remoteName' existiert nicht und Repo URL ist leer."
    }

    Write-Warn2 "Remote '$remoteName' existiert nicht."
    if (-not (Ask-YesNo "Remote '$remoteName' mit Repo URL '$repoUrl' anlegen?" $false)) {
        Fail "Abbruch: Remote '$remoteName' wurde nicht angelegt."
    }
    Invoke-Checked "git remote add $remoteName $repoUrl" { git remote add $remoteName $repoUrl }
    return $remoteName
}

function Get-GitState {
    $dirty = (& git status --porcelain) -join "`n"
    $branchName = (& git rev-parse --abbrev-ref HEAD 2>$null)
    if ($branchName) { $branchName = $branchName.Trim() }
    # Avoid `@{u}` here because it writes fatal messages to stderr when unset,
    # which PowerShell treats as terminating errors with ErrorActionPreference=Stop.
    $upstream = ""
    if ($branchName) {
        $upstream = (& git for-each-ref --format="%(upstream:short)" "refs/heads/$branchName" 2>$null)
        if ($upstream) { $upstream = $upstream.Trim() }
    }
    $ahead = 0
    $behind = 0
    if ($upstream) {
        $counts = (& git rev-list --left-right --count "$upstream...HEAD" 2>$null)
        if ($counts) {
            $parts = $counts.Trim() -split "\s+"
            if ($parts.Length -ge 2) {
                $behind = [int]$parts[0]
                $ahead = [int]$parts[1]
            }
        }
    }
    return [pscustomobject]@{
        Dirty = [bool]$dirty
        DirtyText = $dirty
        HasUpstream = [bool]$upstream
        Upstream = $upstream
        Ahead = $ahead
        Behind = $behind
    }
}

function Get-PreferredGitRemote {
    $remoteName = ""
    $remoteUrl = ""

    try {
        $remoteName = (& git remote 2>$null | Select-Object -First 1)
        if ($remoteName) { $remoteName = $remoteName.Trim() }
    } catch {
        $remoteName = ""
    }

    # Prefer origin when available, otherwise use first configured remote.
    if ($remoteName) {
        try {
            $origin = (& git remote get-url origin 2>$null)
            if ($origin) {
                $remoteName = "origin"
                $remoteUrl = $origin.Trim()
            }
        } catch {
            # Ignore; fallback to first remote below.
        }
    }

    if (-not $remoteUrl -and $remoteName) {
        try {
            $remoteUrl = (& git remote get-url $remoteName 2>$null)
            if ($remoteUrl) { $remoteUrl = $remoteUrl.Trim() }
        } catch {
            $remoteUrl = ""
        }
    }

    return [pscustomobject]@{
        Name = $remoteName
        Url = $remoteUrl
    }
}

function Run-LocalChecks {
    Write-Step "Lokale Pruefungen"
    Invoke-Checked "npm run typecheck" { npm run typecheck }
    if (Test-Path -Path (Join-Path (Get-Location) "node_modules\.bin\eslint.cmd")) {
        Invoke-Checked "npm run lint" { npm run lint }
    } else {
        Write-Warn2 "Lint wird uebersprungen (kein eslint binary gefunden)."
    }
    Invoke-Checked "npm run build" { npm run build }
}

function Handle-PushAndVersion([string]$branch, [string]$remoteName, [string]$repoUrl) {
    Ensure-NoTrackedSecrets
    $resolvedRemote = Ensure-UsableGitRemote -remoteName $remoteName -repoUrl $repoUrl
    $state = Get-GitState
    Write-Step "Git Workflow"
    if ($state.Dirty) {
        Write-Warn2 "Working Tree hat Aenderungen:"
        Write-Info ($state.DirtyText -replace "(?m)^", "    ")
        if (Ask-YesNo "Aenderungen committen?" $true) {
            $msg = Ask-Text "Commit-Message" "Update MailPilot"
            Invoke-Checked "git add -A" { git add -A }
            Invoke-Checked "git commit -m `"$msg`"" { git commit -m $msg }
            $state = Get-GitState
        }
    } else {
        Write-Ok "Working Tree ist sauber."
    }

    if (-not $state.HasUpstream) {
        Write-Warn2 "Aktueller Branch hat kein Upstream-Tracking."
    } else {
        Write-Info "Upstream: $($state.Upstream)"
        Write-Info "Ahead: $($state.Ahead), Behind: $($state.Behind)"
    }

    if ($state.Behind -gt 0) {
        Write-Warn2 "Branch ist hinter dem Upstream. Bitte zuerst pull/rebase."
        return
    }

    if ($state.Ahead -gt 0 -or (Ask-YesNo "Current branch to $resolvedRemote/$branch pushen?" $true)) {
        Invoke-Checked "git push $resolvedRemote $branch" { git push $resolvedRemote $branch }
    } else {
        Write-Warn2 "Push uebersprungen."
    }

    if (Ask-YesNo "Neue Version (Git-Tag) anlegen?" $false) {
        $tag = Ask-Text "Tag-Name (z.B. v1.4.0)"
        if (-not $tag) { Fail "Tag-Name ist erforderlich." }
        Invoke-Checked "git tag $tag" { git tag $tag }
        if (Ask-YesNo "Tag nach $resolvedRemote pushen?" $true) {
            Invoke-Checked "git push $resolvedRemote $tag" { git push $resolvedRemote $tag }
        }
    }
}

function Create-LocalDbDumpFile {
    $dumpDir = Join-Path $PSScriptRoot "dumps"
    if (-not (Test-Path $dumpDir)) {
        New-Item -Path $dumpDir -ItemType Directory | Out-Null
    }

    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $dumpFile = Join-Path $dumpDir ("mailpilot_{0}.sql" -f $timestamp)
    $remoteTmpFile = "/tmp/mailpilot_export.sql"

    Write-Step "Lokalen SQL-Dump erstellen"
    Invoke-Checked "docker compose up -d postgres" {
        docker compose up -d postgres
    }
    Invoke-Checked "pg_dump in Container ausfuehren" {
        docker compose exec -T postgres sh -lc "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --clean --if-exists -f $remoteTmpFile"
    }
    Invoke-Checked "Dump vom Container kopieren -> $dumpFile" {
        docker compose cp "postgres:$remoteTmpFile" $dumpFile
    }
    Invoke-Checked "Temporäre Dump-Datei im Container entfernen" {
        docker compose exec -T postgres sh -lc "rm -f $remoteTmpFile"
    }

    Write-Ok "SQL-Dump erstellt: $dumpFile"
    return $dumpFile
}

function Invoke-ServerDeploy {
    param(
        [string]$ServerHost,
        [string]$ServerUser,
        [string]$ServerPath,
        [string]$RepoUrl,
        [string]$Branch,
        [bool]$ForceServerReset,
        [bool]$SkipMigrate
    )
    $sshTarget = "$ServerUser@$ServerHost"
    $qServerPath = Quote-Bash $ServerPath
    $qRepoUrl = Quote-Bash $RepoUrl
    $qBranch = Quote-Bash $Branch
    $flags = @()
    if ($ForceServerReset) { $flags += "--force-reset" }
    if ($SkipMigrate) { $flags += "--skip-migrate" }
    $flagString = ($flags -join " ")

    $remoteCmd = 'set -e; cd ' + $qServerPath +
        '; chmod +x ' + $qServerPath + '/deploy/server-deploy.sh' +
        '; ' + $qServerPath + '/deploy/server-deploy.sh --repo-url ' + $qRepoUrl +
        ' --branch ' + $qBranch + ' --path ' + $qServerPath + ' ' + $flagString
    $remoteExec = "bash -lc " + (Quote-Bash $remoteCmd)

    Write-Step "Server-Deploy auf $sshTarget"
    Invoke-Checked "ssh $sshTarget" {
        ssh -o StrictHostKeyChecking=accept-new $sshTarget $remoteExec
    }
}

function Install-NginxConfig {
    param(
        [string]$ServerHost,
        [string]$ServerUser,
        [string]$ServerPath,
        [string]$NginxConfigLocalPath,
        [string]$NginxConfigName,
        [string]$NginxSitesAvailablePath,
        [string]$NginxSitesEnabledPath
    )
    $localConfig = Join-Path $repoRoot $NginxConfigLocalPath
    if (-not (Test-Path $localConfig)) { Fail "Nginx-Config nicht gefunden: $localConfig" }

    $sshTarget = "$ServerUser@$ServerHost"
    $remoteStagingDir = "$ServerPath/deploy/nginx"
    $remoteStagingFile = "$remoteStagingDir/$NginxConfigName"
    $remoteAvailableFile = "$NginxSitesAvailablePath/$NginxConfigName"
    $remoteEnabledFile = "$NginxSitesEnabledPath/$NginxConfigName"

    Write-Step "Nginx-Config auf Server kopieren"
    Invoke-Checked "ssh $sshTarget (nginx staging dir)" {
        ssh -o StrictHostKeyChecking=accept-new $sshTarget "mkdir -p $remoteStagingDir"
    }
    Invoke-Checked "scp $localConfig -> ${sshTarget}:$remoteStagingFile" {
        scp -o StrictHostKeyChecking=accept-new $localConfig "${sshTarget}:$remoteStagingFile"
    }

    $qRemoteStagingFile = Quote-Bash $remoteStagingFile
    $qRemoteAvailableFile = Quote-Bash $remoteAvailableFile
    $qRemoteEnabledFile = Quote-Bash $remoteEnabledFile
    $nginxCmd = 'set -e; ' +
        'sudo cp ' + $qRemoteStagingFile + ' ' + $qRemoteAvailableFile +
        '; sudo ln -sfn ' + $qRemoteAvailableFile + ' ' + $qRemoteEnabledFile +
        '; sudo nginx -t' +
        '; sudo systemctl reload nginx'
    $remoteExec = "bash -lc " + (Quote-Bash $nginxCmd)

    Write-Step "Nginx-Config aktivieren"
    Invoke-Checked "ssh $sshTarget (nginx install)" {
        ssh -o StrictHostKeyChecking=accept-new $sshTarget $remoteExec
    }
}

function Restart-ServerApp {
    param(
        [string]$ServerHost,
        [string]$ServerUser,
        [string]$ServerPath
    )
    $sshTarget = "$ServerUser@$ServerHost"
    $qServerPath = Quote-Bash $ServerPath
    $restartCmd = 'set -e; cd ' + $qServerPath +
        '; docker compose -f docker-compose.prod.yml --env-file .env.production up -d app'
    $remoteExec = "bash -lc " + (Quote-Bash $restartCmd)

    Write-Step "App auf Server neu starten"
    Invoke-Checked "ssh $sshTarget (app restart)" {
        ssh -o StrictHostKeyChecking=accept-new $sshTarget $remoteExec
    }
}

function Copy-And-Import-DbFile {
    param(
        [string]$ServerHost,
        [string]$ServerUser,
        [string]$ServerPath,
        [string]$LocalDbFile
    )
    if (-not (Test-Path $LocalDbFile)) { Fail "DB-Datei nicht gefunden: $LocalDbFile" }

    $sshTarget = "$ServerUser@$ServerHost"
    $remoteFile = "$ServerPath/deploy/incoming-db.sql"
    $qServerPath = Quote-Bash $ServerPath
    $qRemoteFile = Quote-Bash $remoteFile

    Write-Step "Schritt 5/7: SQL auf Server kopieren"
    Invoke-Checked "scp $LocalDbFile -> ${sshTarget}:$remoteFile" {
        scp -o StrictHostKeyChecking=accept-new $LocalDbFile "${sshTarget}:$remoteFile"
    }

    $importCmd = 'set -e; cd ' + $qServerPath +
        '; docker compose -f docker-compose.prod.yml --env-file .env.production up -d db' +
        '; docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db sh -lc ' +
        (Quote-Bash 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"') +
        ' < ' + $qRemoteFile
    $remoteExec = "bash -lc " + (Quote-Bash $importCmd)

    Write-Step "Schritt 6/7: SQL auf Server einspielen"
    Invoke-Checked "ssh $sshTarget (db import)" {
        ssh -o StrictHostKeyChecking=accept-new $sshTarget $remoteExec
    }
}

# Repo sanity
$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { Fail "Nicht in einem Git-Repository. Bitte im mailpilot-Projekt starten." }
Set-Location $repoRoot

$configPath = Join-Path $PSScriptRoot "mail.config.ps1"
$cfg = Load-DeployConfig -path $configPath
$remoteName = [string]$cfg["remoteName"]
$branch = [string]$cfg["branch"]
$repoUrl = [string]$cfg["repoUrl"]
$serverHost = [string]$cfg["serverHost"]
$serverUser = [string]$cfg["serverUser"]
$serverPath = [string]$cfg["serverPath"]
$nginxConfigLocalPath = [string]$cfg["nginxConfigLocalPath"]
$nginxConfigName = [string]$cfg["nginxConfigName"]
$nginxSitesAvailablePath = [string]$cfg["nginxSitesAvailablePath"]
$nginxSitesEnabledPath = [string]$cfg["nginxSitesEnabledPath"]
$forceServerReset = [bool]$cfg["forceServerReset"]

if (-not $repoUrl) { Fail "Repo URL ist erforderlich." }
if (-not $remoteName) { Fail "Git-Remote-Name ist fuer Push/Tag erforderlich." }

Show-DeployConfig -config $cfg

while ($true) {
    Write-Step "MailPilot interactive menu"
    Write-Host "  1) App pruefen + Push/Version" -ForegroundColor Gray
    Write-Host "  2) Nur App auf Server deployen" -ForegroundColor Gray
    Write-Host "  3) SQL erzeugen + Push + Deploy + SQL copy/import + App restart" -ForegroundColor Gray
    Write-Host "  4) Deploy-Konfiguration anzeigen/aendern" -ForegroundColor Gray
    Write-Host "  5) Beenden" -ForegroundColor Gray
    $choice = Ask-Text "Auswahl" "5"

    switch ($choice) {
        "1" {
            Run-LocalChecks
            Handle-PushAndVersion -branch $branch -remoteName $remoteName -repoUrl $repoUrl
        }
        "2" {
            Invoke-ServerDeploy -ServerHost $serverHost -ServerUser $serverUser -ServerPath $serverPath `
                -RepoUrl $repoUrl -Branch $branch -ForceServerReset:$forceServerReset -SkipMigrate:$true
            Install-NginxConfig -ServerHost $serverHost -ServerUser $serverUser -ServerPath $serverPath `
                -NginxConfigLocalPath $nginxConfigLocalPath -NginxConfigName $nginxConfigName `
                -NginxSitesAvailablePath $nginxSitesAvailablePath -NginxSitesEnabledPath $nginxSitesEnabledPath
        }
        "3" {
            Write-Step "Schritt 1/7: SQL lokal erzeugen"
            $dbFile = Create-LocalDbDumpFile
            Write-Step "Schritt 2/7: App nach GitHub (Commit/Push)"
            Handle-PushAndVersion -branch $branch -remoteName $remoteName -repoUrl $repoUrl
            Write-Step "Schritt 3/7: App auf Server deployen"
            Invoke-ServerDeploy -ServerHost $serverHost -ServerUser $serverUser -ServerPath $serverPath `
                -RepoUrl $repoUrl -Branch $branch -ForceServerReset:$forceServerReset -SkipMigrate:$false
            Write-Step "Schritt 4/7: Nginx auf Server aktualisieren"
            Install-NginxConfig -ServerHost $serverHost -ServerUser $serverUser -ServerPath $serverPath `
                -NginxConfigLocalPath $nginxConfigLocalPath -NginxConfigName $nginxConfigName `
                -NginxSitesAvailablePath $nginxSitesAvailablePath -NginxSitesEnabledPath $nginxSitesEnabledPath
            Copy-And-Import-DbFile -ServerHost $serverHost -ServerUser $serverUser -ServerPath $serverPath -LocalDbFile $dbFile
            Write-Step "Schritt 7/7: App auf Server neu starten"
            Restart-ServerApp -ServerHost $serverHost -ServerUser $serverUser -ServerPath $serverPath
            Write-Ok "Punkt 3 abgeschlossen (alle 7 Schritte erfolgreich)."
        }
        "4" {
            $cfg = Edit-DeployConfig -configPathAndConfig @{ path = $configPath; config = $cfg }
            $remoteName = [string]$cfg["remoteName"]
            $branch = [string]$cfg["branch"]
            $repoUrl = [string]$cfg["repoUrl"]
            $serverHost = [string]$cfg["serverHost"]
            $serverUser = [string]$cfg["serverUser"]
            $serverPath = [string]$cfg["serverPath"]
            $nginxConfigLocalPath = [string]$cfg["nginxConfigLocalPath"]
            $nginxConfigName = [string]$cfg["nginxConfigName"]
            $nginxSitesAvailablePath = [string]$cfg["nginxSitesAvailablePath"]
            $nginxSitesEnabledPath = [string]$cfg["nginxSitesEnabledPath"]
            $forceServerReset = [bool]$cfg["forceServerReset"]
            Show-DeployConfig -config $cfg
        }
        "5" { break }
        default { Write-Warn2 "Ungueltige Auswahl." }
    }
}

Write-Step "Fertig."
