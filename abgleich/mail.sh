#!/bin/zsh
#
# MailPilot interactive deploy helper for macOS.
# Equivalent to mail.ps1 (PowerShell/Windows).
#
# Usage: ./abgleich/mail.sh
#

set -eo pipefail

SCRIPT_DIR="${0:A:h}"
CONFIG_FILE="$SCRIPT_DIR/mail.config.sh"

# ─── Colors & helpers ────────────────────────────────────────────────────────

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; CYAN=$'\033[0;36m'; GRAY=$'\033[0;90m'; NC=$'\033[0m'

write_step()  { echo ""; echo "${CYAN}=================================${NC}"; echo "${CYAN}  $1${NC}"; echo "${CYAN}=================================${NC}"; }
write_info()  { echo "${CYAN}[INFO]  $1${NC}"; }
write_ok()    { echo "${GREEN}[ OK ]  $1${NC}"; }
write_warn()  { echo "${YELLOW}[WARN]  $1${NC}"; }
fail()        { echo "${RED}[ERROR] $1${NC}"; exit 1; }

invoke_checked() {
    local desc="$1"; shift
    write_info "$desc"
    if "$@"; then
        write_ok "Erfolgreich: $desc"
    else
        fail "Schritt fehlgeschlagen: $desc (Exit $?)"
    fi
}

ask_text() {
    local prompt="$1"
    local default="${2:-}"
    local suffix=""
    [[ -n "$default" ]] && suffix=" [$default]"
    echo -n "$prompt$suffix: " >&2
    read -r value
    if [[ -z "$value" ]]; then
        echo "$default"
    else
        echo "$value"
    fi
}

ask_yesno() {
    local prompt="$1"
    local default="${2:-y}"
    local hint
    if [[ "$default" == "y" ]]; then hint="[J/n]"; else hint="[j/N]"; fi
    echo -n "$prompt $hint: " >&2
    read -r answer
    answer="${answer:l}"
    if [[ -z "$answer" ]]; then
        [[ "$default" == "y" ]] && return 0 || return 1
    fi
    [[ "$answer" =~ ^(j|ja|y|yes)$ ]] && return 0 || return 1
}

# ─── Configuration ───────────────────────────────────────────────────────────

cfg_remoteName=""
cfg_branch=""
cfg_repoUrl=""
cfg_serverHost=""
cfg_serverUser=""
cfg_serverPath=""
cfg_nginxConfigLocalPath=""
cfg_nginxConfigName=""
cfg_nginxSitesAvailablePath=""
cfg_nginxSitesEnabledPath=""
cfg_forceServerReset=""

set_defaults() {
    cfg_remoteName="origin"
    cfg_branch="main"
    cfg_repoUrl="https://github.com/vengelst/mailpilot.git"
    cfg_serverHost="vivahome.de"
    cfg_serverUser="root"
    cfg_serverPath="/opt/mailpilot"
    cfg_nginxConfigLocalPath="deploy/nginx/mailpilot.vivahome.de.conf"
    cfg_nginxConfigName="mailpilot.vivahome.de.conf"
    cfg_nginxSitesAvailablePath="/etc/nginx/sites-available"
    cfg_nginxSitesEnabledPath="/etc/nginx/sites-enabled"
    cfg_forceServerReset="true"
}

save_config() {
    cat > "$CONFIG_FILE" <<CONF
# MailPilot deploy configuration (auto-generated)
remoteName="$cfg_remoteName"
branch="$cfg_branch"
repoUrl="$cfg_repoUrl"
serverHost="$cfg_serverHost"
serverUser="$cfg_serverUser"
serverPath="$cfg_serverPath"
nginxConfigLocalPath="$cfg_nginxConfigLocalPath"
nginxConfigName="$cfg_nginxConfigName"
nginxSitesAvailablePath="$cfg_nginxSitesAvailablePath"
nginxSitesEnabledPath="$cfg_nginxSitesEnabledPath"
forceServerReset="$cfg_forceServerReset"
CONF
}

load_config() {
    set_defaults
    if [[ -f "$CONFIG_FILE" ]]; then
        local remoteName branch repoUrl serverHost serverUser serverPath
        local nginxConfigLocalPath nginxConfigName nginxSitesAvailablePath nginxSitesEnabledPath forceServerReset
        source "$CONFIG_FILE"
        [[ -n "${remoteName:-}" ]] && cfg_remoteName="$remoteName"
        [[ -n "${branch:-}" ]] && cfg_branch="$branch"
        [[ -n "${repoUrl:-}" ]] && cfg_repoUrl="$repoUrl"
        [[ -n "${serverHost:-}" ]] && cfg_serverHost="$serverHost"
        [[ -n "${serverUser:-}" ]] && cfg_serverUser="$serverUser"
        [[ -n "${serverPath:-}" ]] && cfg_serverPath="$serverPath"
        [[ -n "${nginxConfigLocalPath:-}" ]] && cfg_nginxConfigLocalPath="$nginxConfigLocalPath"
        [[ -n "${nginxConfigName:-}" ]] && cfg_nginxConfigName="$nginxConfigName"
        [[ -n "${nginxSitesAvailablePath:-}" ]] && cfg_nginxSitesAvailablePath="$nginxSitesAvailablePath"
        [[ -n "${nginxSitesEnabledPath:-}" ]] && cfg_nginxSitesEnabledPath="$nginxSitesEnabledPath"
        [[ -n "${forceServerReset:-}" ]] && cfg_forceServerReset="$forceServerReset"
    else
        save_config
    fi
}

show_config() {
    write_step "Aktuelle Deploy-Konfiguration"
    write_info "Git remote: $cfg_remoteName"
    write_info "Git branch: $cfg_branch"
    write_info "Repo URL: $cfg_repoUrl"
    write_info "Server host: $cfg_serverHost"
    write_info "Server user: $cfg_serverUser"
    write_info "Server path: $cfg_serverPath"
    write_info "Nginx local config: $cfg_nginxConfigLocalPath"
    write_info "Nginx config name: $cfg_nginxConfigName"
    write_info "Nginx sites-available: $cfg_nginxSitesAvailablePath"
    write_info "Nginx sites-enabled: $cfg_nginxSitesEnabledPath"
    write_info "Force server reset: $cfg_forceServerReset"
}

edit_config() {
    show_config
    cfg_remoteName="$(ask_text "Git remote name" "$cfg_remoteName")"
    cfg_branch="$(ask_text "Git branch" "$cfg_branch")"
    cfg_repoUrl="$(ask_text "Repo URL" "$cfg_repoUrl")"
    cfg_serverHost="$(ask_text "Server host" "$cfg_serverHost")"
    cfg_serverUser="$(ask_text "Server user" "$cfg_serverUser")"
    cfg_serverPath="$(ask_text "Server path" "$cfg_serverPath")"
    cfg_nginxConfigLocalPath="$(ask_text "Nginx local config path" "$cfg_nginxConfigLocalPath")"
    cfg_nginxConfigName="$(ask_text "Nginx config file name" "$cfg_nginxConfigName")"
    cfg_nginxSitesAvailablePath="$(ask_text "Nginx sites-available path" "$cfg_nginxSitesAvailablePath")"
    cfg_nginxSitesEnabledPath="$(ask_text "Nginx sites-enabled path" "$cfg_nginxSitesEnabledPath")"
    if ask_yesno "Server bei lokalen Aenderungen hart zuruecksetzen?" "y"; then
        cfg_forceServerReset="true"
    else
        cfg_forceServerReset="false"
    fi

    [[ -z "$cfg_repoUrl" ]] && fail "Repo URL ist erforderlich."
    [[ -z "$cfg_remoteName" ]] && fail "Git-Remote-Name ist erforderlich."

    save_config
    write_ok "Konfiguration gespeichert: $CONFIG_FILE"
}

# ─── Git helpers ─────────────────────────────────────────────────────────────

ensure_no_tracked_secrets() {
    local forbidden=(".env" ".env.production" ".env.local")
    for f in "${forbidden[@]}"; do
        if git ls-files --cached -- "$f" 2>/dev/null | grep -q .; then
            fail "Abbruch: '$f' ist in Git getrackt."
        fi
    done
}

ensure_usable_git_remote() {
    if git remote | grep -qx "$cfg_remoteName"; then
        return 0
    fi

    if [[ -n "$cfg_repoUrl" ]]; then
        local existing
        existing="$(git remote -v | grep "(fetch)" | awk -v url="$cfg_repoUrl" '$2 == url {print $1; exit}')"
        if [[ -n "$existing" ]]; then
            write_warn "Remote '$cfg_remoteName' existiert nicht. Verwende vorhandenes Remote '$existing' mit gleicher URL."
            cfg_remoteName="$existing"
            return 0
        fi
    fi

    [[ -z "$cfg_repoUrl" ]] && fail "Remote '$cfg_remoteName' existiert nicht und Repo URL ist leer."

    write_warn "Remote '$cfg_remoteName' existiert nicht."
    if ask_yesno "Remote '$cfg_remoteName' mit Repo URL '$cfg_repoUrl' anlegen?" "n"; then
        invoke_checked "git remote add $cfg_remoteName $cfg_repoUrl" git remote add "$cfg_remoteName" "$cfg_repoUrl"
    else
        fail "Abbruch: Remote '$cfg_remoteName' wurde nicht angelegt."
    fi
}

GIT_DIRTY=""
GIT_BRANCH=""
GIT_UPSTREAM=""
GIT_AHEAD=0
GIT_BEHIND=0

get_git_state() {
    GIT_DIRTY="$(git status --porcelain)"
    GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    GIT_UPSTREAM="$(git for-each-ref --format='%(upstream:short)' "refs/heads/$GIT_BRANCH" 2>/dev/null || true)"
    GIT_AHEAD=0
    GIT_BEHIND=0
    if [[ -n "$GIT_UPSTREAM" ]]; then
        local counts
        counts="$(git rev-list --left-right --count "$GIT_UPSTREAM...HEAD" 2>/dev/null || true)"
        if [[ -n "$counts" ]]; then
            GIT_BEHIND="$(echo "$counts" | awk '{print $1}')"
            GIT_AHEAD="$(echo "$counts" | awk '{print $2}')"
        fi
    fi
}

# ─── Workflow functions ──────────────────────────────────────────────────────

run_local_checks() {
    write_step "Lokale Pruefungen"
    invoke_checked "npm run typecheck" npm run typecheck
    if [[ -f "node_modules/.bin/eslint" ]]; then
        invoke_checked "npm run lint" npm run lint
    else
        write_warn "Lint wird uebersprungen (kein eslint binary gefunden)."
    fi
    invoke_checked "npm run build" npm run build
}

handle_push_and_version() {
    ensure_no_tracked_secrets
    ensure_usable_git_remote
    get_git_state

    write_step "Git Workflow"
    if [[ -n "$GIT_DIRTY" ]]; then
        write_warn "Working Tree hat Aenderungen:"
        echo "$GIT_DIRTY" | sed 's/^/    /'
        if ask_yesno "Aenderungen committen?" "y"; then
            local msg
            msg="$(ask_text "Commit-Message" "Update MailPilot")"
            invoke_checked "git add -A" git add -A
            invoke_checked "git commit" git commit -m "$msg"
            get_git_state
        fi
    else
        write_ok "Working Tree ist sauber."
    fi

    if [[ -z "$GIT_UPSTREAM" ]]; then
        write_warn "Aktueller Branch hat kein Upstream-Tracking."
    else
        write_info "Upstream: $GIT_UPSTREAM"
        write_info "Ahead: $GIT_AHEAD, Behind: $GIT_BEHIND"
    fi

    if [[ "$GIT_BEHIND" -gt 0 ]]; then
        write_warn "Branch ist hinter dem Upstream. Bitte zuerst pull/rebase."
        return
    fi

    if [[ "$GIT_AHEAD" -gt 0 ]] || ask_yesno "Current branch to $cfg_remoteName/$cfg_branch pushen?" "y"; then
        invoke_checked "git push $cfg_remoteName $cfg_branch" git push "$cfg_remoteName" "$cfg_branch"
    else
        write_warn "Push uebersprungen."
    fi

    if ask_yesno "Neue Version (Git-Tag) anlegen?" "n"; then
        local tag
        tag="$(ask_text "Tag-Name (z.B. v1.4.0)")"
        [[ -z "$tag" ]] && fail "Tag-Name ist erforderlich."
        invoke_checked "git tag $tag" git tag "$tag"
        if ask_yesno "Tag nach $cfg_remoteName pushen?" "y"; then
            invoke_checked "git push $cfg_remoteName $tag" git push "$cfg_remoteName" "$tag"
        fi
    fi
}

DB_DUMP_FILE=""

create_local_db_dump() {
    local dump_dir="$SCRIPT_DIR/dumps"
    mkdir -p "$dump_dir"

    local timestamp
    timestamp="$(date +%Y%m%d_%H%M%S)"
    DB_DUMP_FILE="$dump_dir/mailpilot_${timestamp}.sql"
    local remote_tmp="/tmp/mailpilot_export.sql"

    write_step "Lokalen SQL-Dump erstellen"
    invoke_checked "docker compose up -d postgres" docker compose up -d postgres
    invoke_checked "pg_dump in Container ausfuehren" \
        docker compose exec -T postgres sh -lc "pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists -f $remote_tmp"
    invoke_checked "Dump vom Container kopieren -> $DB_DUMP_FILE" \
        docker compose cp "postgres:$remote_tmp" "$DB_DUMP_FILE"
    invoke_checked "Temporaere Dump-Datei im Container entfernen" \
        docker compose exec -T postgres sh -lc "rm -f $remote_tmp"

    write_ok "SQL-Dump erstellt: $DB_DUMP_FILE"
}

invoke_server_deploy() {
    local skip_migrate="${1:-false}"
    local ssh_target="$cfg_serverUser@$cfg_serverHost"
    local flags=""
    [[ "$cfg_forceServerReset" == "true" ]] && flags="$flags --force-reset"
    [[ "$skip_migrate" == "true" ]] && flags="$flags --skip-migrate"

    local force_flag="0"
    [[ "$cfg_forceServerReset" == "true" ]] && force_flag="1"

    local remote_cmd
    remote_cmd="set -e
mkdir -p '$cfg_serverPath'
if [ ! -f '$cfg_serverPath/deploy/server-deploy.sh' ]; then
    if [ -d '$cfg_serverPath/.git' ]; then :
    elif [ -z \"\$(ls -A '$cfg_serverPath' 2>/dev/null)\" ]; then
        git clone --branch '$cfg_branch' '$cfg_repoUrl' '$cfg_serverPath'
    elif [ \"$force_flag\" = \"1\" ]; then
        echo \"WARN: Zielpfad nicht leer, bereinige wegen --force-reset.\"
        find '$cfg_serverPath' -mindepth 1 -maxdepth 1 -exec rm -rf {} +
        git clone --branch '$cfg_branch' '$cfg_repoUrl' '$cfg_serverPath'
    else
        echo \"ERROR: Zielpfad ist nicht leer und deploy/server-deploy.sh fehlt. Erneut mit --force-reset ausfuehren.\"
        exit 1
    fi
fi
if [ ! -f '$cfg_serverPath/.env.production' ]; then
    if [ -f '$cfg_serverPath/.env.production.example' ]; then
        cp '$cfg_serverPath/.env.production.example' '$cfg_serverPath/.env.production'
        chmod 600 '$cfg_serverPath/.env.production'
        echo \"WARN: .env.production wurde aus .env.production.example erstellt. Bitte Werte pruefen.\"
    else
        echo \"ERROR: .env.production fehlt und kein .env.production.example vorhanden.\"
        exit 1
    fi
fi
chmod +x '$cfg_serverPath/deploy/server-deploy.sh'
'$cfg_serverPath/deploy/server-deploy.sh' --repo-url '$cfg_repoUrl' --branch '$cfg_branch' --path '$cfg_serverPath' $flags"

    write_step "Server-Deploy auf $ssh_target"
    invoke_checked "ssh $ssh_target (deploy)" \
        ssh -o StrictHostKeyChecking=accept-new "$ssh_target" "bash -lc ${(q)remote_cmd}"
}

install_nginx_config() {
    local local_config="$REPO_ROOT/$cfg_nginxConfigLocalPath"
    [[ ! -f "$local_config" ]] && fail "Nginx-Config nicht gefunden: $local_config"

    local ssh_target="$cfg_serverUser@$cfg_serverHost"
    local remote_staging="$cfg_serverPath/deploy/nginx"
    local remote_staging_file="$remote_staging/$cfg_nginxConfigName"
    local remote_available_file="$cfg_nginxSitesAvailablePath/$cfg_nginxConfigName"
    local remote_enabled_file="$cfg_nginxSitesEnabledPath/$cfg_nginxConfigName"

    write_step "Nginx-Config auf Server kopieren"
    invoke_checked "ssh $ssh_target (nginx staging dir)" \
        ssh -o StrictHostKeyChecking=accept-new "$ssh_target" "mkdir -p '$remote_staging'"
    invoke_checked "scp $local_config -> ${ssh_target}:$remote_staging_file" \
        scp -o StrictHostKeyChecking=accept-new "$local_config" "${ssh_target}:$remote_staging_file"

    local nginx_cmd="set -e; sudo cp '$remote_staging_file' '$remote_available_file'; sudo ln -sfn '$remote_available_file' '$remote_enabled_file'; sudo nginx -t; sudo systemctl reload nginx"

    write_step "Nginx-Config aktivieren"
    invoke_checked "ssh $ssh_target (nginx install)" \
        ssh -o StrictHostKeyChecking=accept-new "$ssh_target" "bash -lc ${(q)nginx_cmd}"
}

restart_server_app() {
    local ssh_target="$cfg_serverUser@$cfg_serverHost"
    local restart_cmd="set -e; cd '$cfg_serverPath'; docker compose -f docker-compose.prod.yml --env-file .env.production up -d app"

    write_step "App auf Server neu starten"
    invoke_checked "ssh $ssh_target (app restart)" \
        ssh -o StrictHostKeyChecking=accept-new "$ssh_target" "bash -lc ${(q)restart_cmd}"
}

copy_and_import_db() {
    local db_file="$1"
    [[ ! -f "$db_file" ]] && fail "DB-Datei nicht gefunden: $db_file"

    local ssh_target="$cfg_serverUser@$cfg_serverHost"
    local remote_file="$cfg_serverPath/deploy/incoming-db.sql"

    write_step "SQL auf Server kopieren"
    invoke_checked "scp $db_file -> ${ssh_target}:$remote_file" \
        scp -o StrictHostKeyChecking=accept-new "$db_file" "${ssh_target}:$remote_file"

    local import_cmd="set -e
cd '$cfg_serverPath'
DB_USER=\"\$(sed -n 's/^POSTGRES_USER=//p' .env.production | head -n1 | tr -d '\r')\"
DB_NAME=\"\$(sed -n 's/^POSTGRES_DB=//p' .env.production | head -n1 | tr -d '\r')\"
if [ -z \"\$DB_USER\" ] || [ -z \"\$DB_NAME\" ]; then
    echo \"ERROR: POSTGRES_USER/POSTGRES_DB fehlen in .env.production\"
    exit 2
fi
docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -v ON_ERROR_STOP=1 -U \"\$DB_USER\" -d \"\$DB_NAME\" < '$remote_file'"

    write_step "SQL auf Server einspielen"
    invoke_checked "ssh $ssh_target (db import)" \
        ssh -o StrictHostKeyChecking=accept-new "$ssh_target" "bash -lc ${(q)import_cmd}"
}

# ─── Main ────────────────────────────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -z "$REPO_ROOT" ]] && fail "Nicht in einem Git-Repository. Bitte im mailpilot-Projekt starten."
cd "$REPO_ROOT"

load_config

[[ -z "$cfg_repoUrl" ]] && fail "Repo URL ist erforderlich."
[[ -z "$cfg_remoteName" ]] && fail "Git-Remote-Name ist erforderlich."

show_config

while true; do
    write_step "MailPilot interactive menu"
    echo "${GRAY}  1) App pruefen + Push/Version${NC}"
    echo "${GRAY}  2) Aenderungen nach GitHub pushen + App auf Server deployen${NC}"
    echo "${GRAY}  3) SQL erzeugen + Push + Deploy + SQL copy/import + App restart${NC}"
    echo "${GRAY}  4) Deploy-Konfiguration anzeigen/aendern${NC}"
    echo "${GRAY}  5) Beenden${NC}"
    echo "${GRAY}  6) Nur Nginx-Konfiguration auf Server (bei Bedarf)${NC}"
    choice="$(ask_text "Auswahl" "5")"

    case "$choice" in
        1)
            run_local_checks
            handle_push_and_version
            ;;
        2)
            handle_push_and_version
            invoke_server_deploy "false"
            ;;
        3)
            write_step "Schritt 1/5: SQL lokal erzeugen"
            create_local_db_dump
            write_step "Schritt 2/5: App nach GitHub (Commit/Push)"
            handle_push_and_version
            write_step "Schritt 3/5: App auf Server deployen"
            invoke_server_deploy "false"
            write_step "Schritt 4/5: SQL auf Server kopieren und einspielen"
            copy_and_import_db "$DB_DUMP_FILE"
            write_step "Schritt 5/5: App auf Server neu starten"
            restart_server_app
            write_ok "Punkt 3 abgeschlossen (alle 5 Schritte erfolgreich)."
            ;;
        4)
            edit_config
            show_config
            ;;
        5)
            break
            ;;
        6)
            install_nginx_config
            ;;
        *)
            write_warn "Ungueltige Auswahl."
            ;;
    esac
done

write_step "Fertig."
