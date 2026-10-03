#!/usr/bin/env bash
# ForgeCoach launcher -- start the Forge engine and open ForgeCoach, in one click.
# Copyright (C) 2026 ForgeCoach contributors.
# SPDX-License-Identifier: GPL-3.0-or-later
# forgecoach-launcher: 1
#
# Install once (this adds "ForgeCoach" to your app menu):
#
#   curl -fsSL https://jalirkan.github.io/ForgeCoach/forgecoach.sh | bash -s install
#
# Then click ForgeCoach in the app menu.  Right-click it for "ForgeCoach (phone)",
# "ForgeCoach (away from home)" and "Stop ForgeCoach" (all menu entries of their own).
#
# Commands (`forgecoach <command>`; ~/.local/bin/forgecoach after install):
#
#   start [play.sh flags]  (the default) find or fetch mtg-table, update it, check
#                          what it needs, start the engine in the background
#                          (./scripts/play.sh --engine-only) and open
#                          https://jalirkan.github.io/ForgeCoach/?play=1.  If the
#                          engine is already running, only opens the page.
#                          Flags go to play.sh: --lan (phone), --deck <path>,
#                          --ai-deck <path>, --ai-profile <name>, --mirror,
#                          --port <n>, --no-coach, ...
#   remote [flags]         play from your phone when you are AWAY from home, over
#                          Tailscale (a free private network between your own
#                          devices).  Starts the engine like --lan, shows the phone
#                          link with your Tailscale address, and keeps this PC from
#                          sleeping while the engine runs.  The PC must stay on.
#   remote-setup           one-time help: install Tailscale, log in, set up the phone
#   stop                   stop the engine this launcher started
#   status                 is it running, where is everything
#   install                put this script in ~/.local/bin/forgecoach and add the
#                          app-menu entries (safe to re-run)
#   update                 re-download this script and re-install it
#   setup                  find/fetch mtg-table and check what it needs; no start
#   get-forge              download Forge 2.0.14 (about 300 MB) into ~/forge
#   launch [flags]         what the menu icon runs: `start` in a terminal window
#
# Launcher flags: --remote (same as the remote command), --no-open (do not open the browser), --no-pull (do not update
# mtg-table), --window (pause before the window closes), --notify (desktop pop-up).
#
# Environment: FORGECOACH_MTG=<mtg-table checkout>, FORGE_JAR=<Forge jar>,
# FORGECOACH_NO_UPDATE=1 (do not self-update), FORGECOACH_NO_KDECONNECT=1,
# FORGECOACH_NO_INHIBIT=1 (do not hold off sleep during `remote`).
#
# What it touches: ~/.local/bin/forgecoach, ~/.local/share/applications/
# forgecoach*.desktop, ~/.local/share/icons/forgecoach.png, ~/.config/forgecoach/,
# ~/.cache/forgecoach/ (engine log), a fresh clone in ~/mtg-table when there is
# no checkout, and with `get-forge` a fresh ~/forge.  It never uses sudo on its own
# (it prints the command for you; `remote-setup` runs one only after you say yes at
# a terminal prompt) and never deletes your files.

set -euo pipefail

# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------

FC_SITE="${FORGECOACH_URL:-https://jalirkan.github.io/ForgeCoach/}"
FC_SITE="${FC_SITE%/}/"
FC_DOWNLOAD="${FORGECOACH_DOWNLOAD_URL:-$FC_SITE}"
FC_DOWNLOAD="${FC_DOWNLOAD%/}/"
ONE_LINER="curl -fsSL https://jalirkan.github.io/ForgeCoach/forgecoach.sh | bash -s install"

MTG_REPO="jalirkan/mtg-table"
MTG_GIT_URL="https://github.com/jalirkan/mtg-table.git"

FORGE_JAR_NAME="forge-gui-desktop-2.0.14-jar-with-dependencies.jar"
FORGE_JAR_SHA256="3c0a7c385b9207e593fe149255e00d1cd7e556809f138568d07e3828b78e5dd9"
FORGE_ASSET_URL="${FORGECOACH_FORGE_URL:-https://github.com/Card-Forge/forge/releases/download/forge-2.0.14/forge-installer-2.0.14.tar.bz2}"
FORGE_ASSET_SHA256="e71749376945177d603d52a21a089bc1574330cf34599544b6bae1a04c83da41"
JAVA_MIN=21
NODE_MIN=22

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/forgecoach"
CONFIG_FILE="$CONFIG_DIR/config"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/forgecoach"
ENGINE_LOG="$CACHE_DIR/engine.log"
PID_FILE="$CACHE_DIR/engine.pid"
MODE_FILE="$CACHE_DIR/engine.mode"
PORT_FILE="$CACHE_DIR/engine.port"
PHONE_FILE="$CACHE_DIR/phone-url"
INHIBIT_FILE="$CACHE_DIR/inhibit.pid"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/forgecoach"
APPS_DIR="$DATA_DIR/applications"
ICON="$DATA_DIR/icons/forgecoach.png"

# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else B=""; G=""; Y=""; R=""; N=""; fi

say()  { printf '\n%s%s%s\n' "$B" "$*" "$N"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s[ok]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s[!!]%s %s\n' "$Y" "$N" "$*"; }
bad()  { printf '  %s[no]%s %s\n' "$R" "$N" "$*"; }
fix()  { printf '       %s%s%s\n' "$B" "$*" "$N"; }

NOTIFY=0
notify() { printf '%s\n' "$*"; popup "$*"; }   # the terminal, and a pop-up when asked for
popup() {   # popup <message> -- a desktop notification, only with --notify
  [ "$NOTIFY" = "1" ] || return 0
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a ForgeCoach -i "$ICON" ForgeCoach "$1" >/dev/null 2>&1 </dev/null || true
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --title ForgeCoach --passivepopup "$1" 10 >/dev/null 2>&1 </dev/null &
  fi
}

has_tty() { [ -t 1 ] && { : </dev/tty; } 2>/dev/null; }

# ask <question> <default y|n> -- reads the terminal, never stdin (stdin is this
# script itself when it was piped from curl).  No terminal: the default.
ask() {
  local q="$1" def="$2" ans="" hint="[y/N]"
  [ "$def" = "y" ] && hint="[Y/n]"
  has_tty || { [ "$def" = "y" ]; return; }
  printf '%s %s ' "$q" "$hint" >/dev/tty
  read -r ans </dev/tty || ans=""
  ans="${ans:-$def}"
  case "$ans" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

conf_get() { [ -f "$CONFIG_FILE" ] && sed -n "s/^$1=//p" "$CONFIG_FILE" | tail -n 1 || true; }
conf_set() {
  local key="$1" val="$2" tmp
  mkdir -p "$CONFIG_DIR"
  tmp="$(mktemp "$CONFIG_DIR/.config.XXXXXX")"
  { [ -f "$CONFIG_FILE" ] && grep -v "^$key=" "$CONFIG_FILE" || true; printf '%s=%s\n' "$key" "$val"; } >"$tmp"
  mv -f "$tmp" "$CONFIG_FILE"
}

# json_str <file> <key> -- a top-level "key": "value" or "key": 123 of a simple
# JSON file (mtg-table's config.json), with no node/python/jq needed.
json_str() {
  sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",]*\)\"\{0,1\}[[:space:]]*,\{0,1\}[[:space:]]*$/\1/p" "$1" 2>/dev/null | head -n 1
}

# A menu launch does not read ~/.bashrc, so tools installed per user (nvm's
# node, Claude Code in ~/.local/bin) are not on PATH.  Add the usual places.
augment_path() {
  local d nvm=""
  for d in "$HOME/.local/bin" "$HOME/bin" "$HOME/.npm-global/bin" "$HOME/.volta/bin" \
           "$HOME/.bun/bin" "$HOME/.claude/local" "/usr/local/bin" "/snap/bin"; do
    [ -d "$d" ] || continue
    case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d" ;; esac
  done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    nvm="$(find "$HOME/.nvm/versions/node" -mindepth 1 -maxdepth 1 -type d -name 'v*' 2>/dev/null | sort -V | tail -n 1)"
  fi
  if [ -z "$nvm" ] && [ -d "$HOME/.local/share/fnm/aliases/default" ]; then nvm="$HOME/.local/share/fnm/aliases/default"; fi
  if [ -n "$nvm" ] && [ -x "$nvm/bin/node" ]; then
    # nvm's node wins over a missing or too-old system one
    if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt "$NODE_MIN" ]; then PATH="$nvm/bin:$PATH"; fi
  fi
  export PATH
}

node_major() { node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p' | head -n 1 | grep . || echo 0; }
java_major() {
  java -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\)\.\{0,1\}\([0-9]*\).*/\1 \2/p' | head -n 1 |
    { read -r a b || true; if [ "${a:-0}" = "1" ]; then echo "${b:-0}"; else echo "${a:-0}"; fi; }
}

health() {   # health <port> -- the engine's GET /health answers "ok"
  local body
  body="$(curl -fsS --max-time 2 "http://127.0.0.1:$1/health" 2>/dev/null || true)"
  case "$body" in ok*) return 0 ;; *) return 1 ;; esac
}

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
# the distro and its install commands
# ---------------------------------------------------------------------------

PM=""
DISTRO="Linux"
detect_pm() {
  local id="" like="" name=""
  if [ -r /etc/os-release ]; then
    id="$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"' | head -n 1)"
    like="$(sed -n 's/^ID_LIKE=//p' /etc/os-release | tr -d '"' | head -n 1)"
    name="$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"' | head -n 1)"
  fi
  [ -n "$name" ] && DISTRO="$name"
  case " $id $like " in
    *" ubuntu "*|*" debian "*|*" neon "*|*" linuxmint "*|*" pop "*) PM=apt ;;
    *" fedora "*|*" rhel "*|*" centos "*|*" nobara "*)             PM=dnf ;;
    *" arch "*|*" manjaro "*|*" endeavouros "*|*" cachyos "*)       PM=pacman ;;
    *" opensuse"*|*" suse "*|*" sles "*)                             PM=zypper ;;
  esac
  if [ -z "$PM" ]; then
    for p in apt-get dnf pacman zypper; do
      if command -v "$p" >/dev/null 2>&1; then PM="${p%-get}"; break; fi
    done
  fi
}

# install_cmd <what> -- the command for this distro, for the user to run
install_cmd() {
  case "$PM:$1" in
    apt:java)    echo "sudo apt install openjdk-21-jdk-headless" ;;
    dnf:java)    echo "sudo dnf install java-21-openjdk-devel" ;;
    pacman:java) echo "sudo pacman -S --needed jdk21-openjdk" ;;
    zypper:java) echo "sudo zypper install java-21-openjdk-devel" ;;
    apt:node)    echo "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install nodejs" ;;
    dnf:node)    echo "sudo dnf install nodejs" ;;
    pacman:node) echo "sudo pacman -S --needed nodejs npm" ;;
    zypper:node) echo "sudo zypper install nodejs22" ;;
    apt:*)       echo "sudo apt install $1" ;;
    dnf:*)       echo "sudo dnf install $1" ;;
    pacman:*)    echo "sudo pacman -S --needed $1" ;;
    zypper:*)    echo "sudo zypper install $1" ;;
    *:java)      echo "install Java 21 (a JDK) from your software centre, or https://adoptium.net" ;;
    *:node)      echo "install Node.js 24 from https://nodejs.org" ;;
    *)           echo "install the '$1' package from your software centre" ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. the mtg-table checkout
# ---------------------------------------------------------------------------

MTG=""
is_mtg() {
  [ -n "${1:-}" ] && [ -f "$1/scripts/play.sh" ] && [ -f "$1/tools/check-forge.sh" ] \
    && [ -f "$1/bridge/build.sh" ] && [ -f "$1/config.json" ]
}

# Newest first: by the time git last touched it (a pull or checkout writes .git/index).
search_mtg() {
  local roots=() r f d
  for r in "$HOME/Projects" "$HOME/projects" "$HOME/code" "$HOME/Code" "$HOME/src" "$HOME/git" \
           "$HOME/dev" "$HOME/Documents" "$HOME/Desktop" "$HOME/Downloads"; do
    [ -d "$r" ] && roots+=("$r")
  done
  {
    for d in "$HOME/mtg-table" "$HOME"/mtg-table*; do is_mtg "$d" && printf '%s\n' "$d"; done
    if [ "${#roots[@]}" -gt 0 ]; then
      find "${roots[@]}" -maxdepth 6 \
        \( -name node_modules -o -name .git -o -name var -o -name 'forge-home' -o -name '.?*' \) -prune \
        -o -type f -path '*/scripts/play.sh' -print 2>/dev/null |
        while IFS= read -r f; do d="$(dirname "$(dirname "$f")")"; is_mtg "$d" && printf '%s\n' "$d"; done
    fi
  } | awk '!seen[$0]++' | while IFS= read -r d; do
    f="$d/.git/index"; [ -e "$f" ] || f="$d/scripts/play.sh"
    printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$d"
  done | sort -rn | cut -f2-
}

clone_mtg() {
  local target="$HOME/mtg-table"
  if [ -e "$target" ]; then
    bad "$target already exists but is not an mtg-table checkout, so nothing was cloned."
    fix "Move it aside, or tell ForgeCoach where mtg-table is: FORGECOACH_MTG=/path/to/mtg-table forgecoach"
    return 1
  fi
  say "Getting mtg-table (the engine) into $target"
  info "It is a private GitHub repository, so GitHub needs to know it's you."
  if command -v gh >/dev/null 2>&1; then
    if ! gh auth status >/dev/null 2>&1 </dev/null; then
      if has_tty; then
        info "Logging in to GitHub: choose 'GitHub.com', 'HTTPS', 'Login with a web browser'."
        gh auth login --hostname github.com --git-protocol https --web </dev/tty || true
      fi
    fi
    if gh auth status >/dev/null 2>&1 </dev/null && gh repo clone "$MTG_REPO" "$target" </dev/null; then
      gh auth setup-git >/dev/null 2>&1 </dev/null || true   # so `git pull` works later
      return 0
    fi
  fi
  if command -v git >/dev/null 2>&1; then
    if has_tty; then
      info "git will ask for your GitHub username and, as the password, a personal access token"
      info "(github.com > Settings > Developer settings > Personal access tokens)."
      git clone "$MTG_GIT_URL" "$target" </dev/tty && return 0
    else
      GIT_TERMINAL_PROMPT=0 git clone "$MTG_GIT_URL" "$target" </dev/null && return 0
    fi
  fi
  bad "Could not download mtg-table from GitHub."
  if ! command -v gh >/dev/null 2>&1; then
    info "The easiest fix is GitHub's own tool, which logs in through your browser:"
    fix "$(install_cmd gh)"
    info "then run ForgeCoach again (the app-menu icon)."
  else
    info "Make sure the GitHub account you log in with can see $MTG_REPO, then try again:"
    fix "gh auth login"
  fi
  command -v git >/dev/null 2>&1 || fix "$(install_cmd git)"
  info "Or, if you have mtg-table somewhere already: FORGECOACH_MTG=/path/to/mtg-table forgecoach"
  return 1
}

find_mtg() {
  local d remembered
  if [ -n "${FORGECOACH_MTG:-}" ]; then
    d="${FORGECOACH_MTG%/}"
    if is_mtg "$d"; then MTG="$(cd "$d" && pwd)"; conf_set MTG_DIR "$MTG"; ok "mtg-table: $MTG (FORGECOACH_MTG)"; return 0; fi
    bad "FORGECOACH_MTG=$d is not an mtg-table checkout (no scripts/play.sh there)."
    return 1
  fi
  remembered="$(conf_get MTG_DIR)"
  if is_mtg "$remembered"; then MTG="$remembered"; ok "mtg-table: $MTG"; return 0; fi
  info "Looking for your mtg-table folder..."
  d="$(search_mtg | head -n 1 || true)"
  if [ -n "$d" ]; then
    MTG="$(cd "$d" && pwd)"; conf_set MTG_DIR "$MTG"
    ok "mtg-table: $MTG (found; remembered in $CONFIG_FILE)"
    return 0
  fi
  info "No mtg-table folder found in your home folder."
  clone_mtg || return 1
  MTG="$HOME/mtg-table"; conf_set MTG_DIR "$MTG"
  ok "mtg-table: $MTG (downloaded)"
}

# ---------------------------------------------------------------------------
# 2. update it
# ---------------------------------------------------------------------------

update_mtg() {
  [ -d "$MTG/.git" ] || { info "($MTG is not a git checkout, so it is not updated)"; return 0; }
  command -v git >/dev/null 2>&1 || { warn "git is not installed, so mtg-table was not updated."; return 0; }
  local before after out dirty
  before="$(git -C "$MTG" rev-parse --short HEAD 2>/dev/null || echo '?')"
  dirty="$(git -C "$MTG" status --porcelain --untracked-files=no 2>/dev/null || true)"
  # No password pop-ups (KDE's ksshaskpass) or prompts: an update needs saved
  # credentials, and without them we just play with the copy that is here.
  if out="$(GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="" SSH_ASKPASS="" GIT_SSH_COMMAND="ssh -o BatchMode=yes" \
            timeout 60 git -C "$MTG" pull --ff-only 2>&1 </dev/null)"; then
    after="$(git -C "$MTG" rev-parse --short HEAD 2>/dev/null || echo '?')"
    if [ "$before" = "$after" ]; then ok "mtg-table is up to date ($after)"
    else ok "mtg-table updated ($before -> $after)"; fi
  else
    if [ -n "$dirty" ]; then
      warn "mtg-table was not updated: it has changes of yours that an update would overwrite."
      info "Carrying on with the copy you have.  (Changed files: $(printf '%s\n' "$dirty" | awk '{print $2}' | head -n 5 | tr '\n' ' '))"
    elif printf '%s' "$out" | grep -qiE 'could not resolve|unable to access|timed out|network'; then
      warn "mtg-table was not updated (no internet?).  Carrying on with the copy you have."
    elif printf '%s' "$out" | grep -qiE 'authentication|could not read username|permission denied|terminal prompts disabled'; then
      warn "mtg-table was not updated: GitHub wants a login.  Carrying on with the copy you have."
      if command -v gh >/dev/null 2>&1; then fix "To fix it once: gh auth login && gh auth setup-git"
      else fix "To fix it once: $(install_cmd gh), then: gh auth login && gh auth setup-git"; fi
    else
      warn "mtg-table was not updated ($(printf '%s' "$out" | tail -n 1)).  Carrying on with the copy you have."
    fi
  fi
}

# ---------------------------------------------------------------------------
# 3. what it needs
# ---------------------------------------------------------------------------

JAR=""
jar_ok() { [ -n "${1:-}" ] && [ -f "$1" ] && [ -d "$(dirname "$1")/res" ]; }

search_jar() {
  local r
  for r in "$HOME/forge" "$HOME/forge-2.0.14" "$HOME/Forge" "$HOME/Games" "$HOME/games" "$HOME/Applications" \
           "$HOME/opt" "$HOME/.local/share/forge" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME"; do
    [ -d "$r" ] || continue
    find "$r" -maxdepth 4 \( -name node_modules -o -name .git -o -name '.?*' \) -prune \
      -o -type f -name "$FORGE_JAR_NAME" -print 2>/dev/null
  done | while IFS= read -r j; do jar_ok "$j" && printf '%s\n' "$j"; done | head -n 1
}

resolve_jar() {
  local cfg remembered
  cfg="$(json_str "$MTG/config.json" forgeJar)"
  remembered="$(conf_get FORGE_JAR)"
  if [ -n "${FORGE_JAR:-}" ] && jar_ok "$FORGE_JAR"; then JAR="$FORGE_JAR"
  elif jar_ok "$cfg"; then JAR="$cfg"
  elif jar_ok "$remembered"; then JAR="$remembered"
  else JAR="$(search_jar || true)"
  fi
  [ -n "$JAR" ] || return 1
  # mtg-table reads $FORGE_JAR before its config.json, so a jar somewhere else
  # needs no edit to config.json (which would block every later `git pull`).
  if [ "$JAR" != "$cfg" ]; then export FORGE_JAR="$JAR"; conf_set FORGE_JAR "$JAR"; fi
  return 0
}

get_forge() {
  local dest="$HOME/forge" arc="$CACHE_DIR/forge-installer-2.0.14.tar.bz2" free sum
  if [ -f "$dest/$FORGE_JAR_NAME" ]; then ok "Forge is already in $dest"; JAR="$dest/$FORGE_JAR_NAME"; return 0; fi
  if [ -e "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then dest="$HOME/forge-2.0.14"; fi
  if [ -e "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
    if [ -f "$dest/$FORGE_JAR_NAME" ]; then JAR="$dest/$FORGE_JAR_NAME"; return 0; fi
    bad "$HOME/forge and $dest both exist and are not empty, so Forge was not unpacked there."
    return 1
  fi
  for t in curl tar bzip2 sha256sum; do
    command -v "$t" >/dev/null 2>&1 || { bad "'$t' is needed to download Forge."; fix "$(install_cmd "$t")"; return 1; }
  done
  mkdir -p "$CACHE_DIR"
  free="$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
  if [ "${free:-0}" -lt 1500000 ]; then bad "Not enough free disk space (Forge needs about 1.5 GB)."; return 1; fi
  say "Downloading Forge 2.0.14 (about 300 MB) from Forge's official GitHub release"
  info "$FORGE_ASSET_URL"
  curl -fL --retry 3 -C - --progress-bar -o "$arc.part" "$FORGE_ASSET_URL" </dev/null \
    || { bad "The download failed.  Run ForgeCoach again to resume it."; return 1; }
  sum="$(sha256sum "$arc.part" | cut -d' ' -f1)"
  if [ "$sum" != "$FORGE_ASSET_SHA256" ]; then
    bad "The download is not the file Forge published (checksum mismatch); it was not used."
    mv -f "$arc.part" "$arc.bad"
    return 1
  fi
  mv -f "$arc.part" "$arc"
  info "Unpacking into $dest (a minute or two)..."
  mkdir -p "$dest"
  tar -xjf "$arc" -C "$dest" </dev/null || { bad "Could not unpack $arc"; return 1; }
  [ -f "$dest/$FORGE_JAR_NAME" ] || { bad "$FORGE_JAR_NAME is not in the download."; return 1; }
  rm -f "$arc"   # our own download, not needed once unpacked
  JAR="$dest/$FORGE_JAR_NAME"
  ok "Forge 2.0.14 is in $dest"
}

LAN=0
check_prereqs() {
  local jm nm missing=0
  detect_pm
  say "Checking what ForgeCoach needs ($DISTRO)"

  if command -v curl >/dev/null 2>&1; then ok "curl"
  else bad "curl is missing (needed to talk to the engine)."; fix "$(install_cmd curl)"; missing=1; fi

  if command -v java >/dev/null 2>&1; then
    jm="$(java_major)"
    if [ "$jm" -lt "$JAVA_MIN" ]; then
      bad "Java $jm is too old: mtg-table needs Java $JAVA_MIN."; fix "$(install_cmd java)"; missing=1
    elif ! grep -q '^jdk.compiler@' <<<"$(java --list-modules 2>/dev/null || true)"; then
      bad "Java $jm is there but without its compiler (mtg-table builds itself with it)."; fix "$(install_cmd java)"; missing=1
    else
      ok "Java $jm"
      [ "$jm" -gt "$JAVA_MIN" ] && info "     (mtg-table is tested on Java $JAVA_MIN; if the engine will not start, install it: $(install_cmd java))"
    fi
  else
    bad "Java is not installed (Forge runs on it)."; fix "$(install_cmd java)"; missing=1
  fi

  if command -v node >/dev/null 2>&1; then
    nm="$(node_major)"
    if [ "$nm" -lt "$NODE_MIN" ]; then
      warn "Node.js $nm is old: the no-key coach needs Node $NODE_MIN or newer (games still work)."; fix "$(install_cmd node)"
    else ok "Node.js $nm"; fi
  else
    bad "Node.js is not installed (mtg-table reads its match settings and runs the coach with it)."
    fix "$(install_cmd node)"; missing=1
  fi

  if resolve_jar; then
    ok "Forge 2.0.14: $JAR"
    if command -v sha256sum >/dev/null 2>&1 && [ "$(sha256sum "$JAR" | cut -d' ' -f1)" != "$FORGE_JAR_SHA256" ]; then
      warn "That jar is not the exact Forge 2.0.14 build mtg-table is tested with; it may still work."
    fi
  else
    bad "Forge 2.0.14 was not found (looked for $FORGE_JAR_NAME with its res folder beside it)."
    if ask "  Download Forge 2.0.14 from its official release now (about 300 MB)?" y && has_tty && get_forge; then
      export FORGE_JAR="$JAR"; conf_set FORGE_JAR "$JAR"
    else
      if [ -x "$BIN" ]; then fix "$BIN get-forge      (downloads it into ~/forge)"
      else fix "curl -fsSL ${FC_SITE}forgecoach.sh | bash -s get-forge      (downloads it into ~/forge)"; fi
      info "     or point ForgeCoach at your own copy: FORGE_JAR=/path/to/$FORGE_JAR_NAME forgecoach"
      missing=1
    fi
  fi

  if command -v claude >/dev/null 2>&1; then
    ok "Claude Code (the coach works without an API key)"
  else
    warn "Claude Code is not installed: optional.  The coach then needs an API key in ForgeCoach's"
    info "     Settings, and 'Copy prompt' always works.  To coach with your Claude login instead:"
    fix "curl -fsSL https://claude.ai/install.sh | bash      (then run 'claude' once to log in)"
  fi

  if [ "$LAN" = "1" ] && ! command -v unzip >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    bad "Phone play needs unzip (to unpack ForgeCoach for the phone)."; fix "$(install_cmd unzip)"; missing=1
  fi

  if [ "$missing" = "1" ]; then
    say "ForgeCoach can't start yet: install what is marked [no] above, then click the ForgeCoach icon again."
    info "(Copy a command into a terminal, press Enter and type your password.  Nothing else changed.)"
    return 1
  fi
  return 0
}

# Forge's profile goes into the checkout's var/ (tools/make-forge-home.sh); a
# fresh clone, or a jar that moved, needs it (re)made.  It is idempotent.
forge_home() {
  local want_res have_res props="$MTG/forge-home/forge.profile.properties"
  want_res="$(cd "$(dirname "$JAR")" && pwd)/res"
  have_res="$(readlink -f "$MTG/forge-home/res" 2>/dev/null || true)"
  if [ "$have_res" != "$(readlink -f "$want_res")" ] || ! grep -qF "userDir=$MTG/var/forge/" "$props" 2>/dev/null; then
    info "Setting up Forge's home folder inside mtg-table (once)..."
    (cd "$MTG" && FORGE_JAR="$JAR" ./tools/make-forge-home.sh >/dev/null </dev/null) \
      || { bad "tools/make-forge-home.sh failed; run it in $MTG to see why."; return 1; }
  fi
}

# ---------------------------------------------------------------------------
# 4. the engine
# ---------------------------------------------------------------------------

PORT=8642
OPEN=1
PULL=1
WINDOW=0
REMOTE=0
PASS=()

parse_flags() {
  local a
  PASS=()
  while [ $# -gt 0 ]; do
    a="$1"
    case "$a" in
      --no-open) OPEN=0 ;;
      --no-pull) PULL=0 ;;
      --window)  WINDOW=1 ;;
      --notify)  NOTIFY=1 ;;
      --engine-only) ;;                       # always added
      --lan)     LAN=1; PASS+=("$a") ;;
      --remote)  LAN=1; REMOTE=1 ;;
      --port)    [ $# -ge 2 ] || { echo "--port needs a number" >&2; exit 2; }
                 PORT="$2"; PASS+=("$a" "$2"); shift ;;
      *)         PASS+=("$a") ;;
    esac
    shift
  done
  # Away-from-home play is the bridge's --lan mode (once, even if both were given).
  if [ "$REMOTE" = "1" ]; then
    case " ${PASS[*]+${PASS[*]}} " in *" --lan "*) ;; *) PASS+=(--lan) ;; esac
  fi
}

engine_pid() { local p; p="$(cat "$PID_FILE" 2>/dev/null || true)"; pid_alive "$p" && echo "$p" || true; }

app_url() {
  local u="${FC_SITE}?play=1"
  [ "$PORT" = "8642" ] || u="$u&seat=ws://127.0.0.1:$PORT/ws"
  echo "$u"
}

open_url() {
  if [ "$OPEN" = "1" ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then
    info "Opening $1"
    (setsid xdg-open "$1" >/dev/null 2>&1 </dev/null &) || true
  else
    info "Open this in your browser: $1"
  fi
}

# Friendly names for play.sh's "== step" lines, while we wait.
step_text() {
  case "$1" in
    "match"*)               echo "Setting up the match" ;;
    "ForgeCoach's site"*)   echo "Getting ForgeCoach for the phone" ;;
    "check-forge"*)         echo "Checking the Forge engine" ;;
    "build"*)               echo "Building the engine's bridge (the first time takes a minute or two)" ;;
    "bridge"*)              echo "Starting Forge" ;;
    "waiting for GET"*)     echo "Waiting for Forge to load its cards (10-60 seconds)" ;;
    "coach"*)               echo "Starting the coach" ;;
    "engine"*)              echo "Engine ready" ;;
    *)                      echo "$1" ;;
  esac
}

wait_ready() {   # wait_ready <pid> -- until /health, or the engine gives up
  local pid="$1" seen=0 lines line i
  for i in $(seq 1 600); do        # 600 x 0.5 s = 5 minutes; a cold first build + boot is ~2
    if health "$PORT"; then return 0; fi
    pid_alive "$pid" || { health "$PORT" && return 0; return 1; }
    mapfile -t lines < <(sed 's/\x1b\[[0-9;]*m//g' "$ENGINE_LOG" 2>/dev/null | sed -n 's/^== //p')
    while [ "$seen" -lt "${#lines[@]}" ]; do
      line="${lines[$seen]}"; seen=$((seen + 1))
      info "... $(step_text "$line")"
    done
    sleep 0.5
    [ $((i % 60)) -eq 0 ] && info "    (still working... $((i / 2)) s)"
  done
  return 1
}

explain_failure() {
  local tail
  tail="$(sed 's/\x1b\[[0-9;]*m//g' "$ENGINE_LOG" 2>/dev/null | tail -n 25)"
  say "The engine did not start.  Its last lines:"
  printf '%s\n' "$tail" | sed 's/^/    /'
  case "$tail" in
    *"Address already in use"*|*BindException*)
      info "Something else is using port $PORT.  If it is an old engine: forgecoach stop, then try again." ;;
    *"FORGE_JAR not found"*|*"check-forge.sh failed"*|*"MISSING CLASS"*)
      info "Forge itself is the problem.  Run: forgecoach get-forge" ;;
    *"does not exist (--deck"*|*"does not exist (--ai-deck"*)
      info "A deck file was not found.  Deck paths are inside $MTG (e.g. decks/pacho-shield.dck)." ;;
    *"could not download"*)
      info "Phone play needs ForgeCoach's site from the internet the first time." ;;
  esac
  info "Full log: $ENGINE_LOG"
}

engine_mode() { cat "$MODE_FILE" 2>/dev/null || echo unknown; }

phone_urls() {   # the bridge's own "WS LAN PAGE  http://<ip>:<port>/?token=..." lines
  sed -n 's/^WS LAN PAGE  //p' "$MTG/var/play/server.log" 2>/dev/null || true
}

# This PC's Tailscale IPv4 address (100.x.y.z), or nothing when Tailscale is not
# installed, not logged in or not connected.
tailscale_ip() {
  local ip=""
  if command -v tailscale >/dev/null 2>&1; then
    ip="$(tailscale ip -4 2>/dev/null </dev/null | head -n 1 || true)"
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then   # the interface, when the CLI will not answer
    ip="$(ip -4 -o addr show dev tailscale0 2>/dev/null </dev/null | sed -n 's/.* inet \([0-9.]*\)\/.*/\1/p' | head -n 1 || true)"
  fi
  case "$ip" in *[!0-9.]*|"") ip="" ;; esac
  printf '%s' "$ip"
}

tailscale_install_cmd() {
  case "$PM" in
    pacman) echo "sudo pacman -S --needed tailscale && sudo systemctl enable --now tailscaled" ;;
    *)      echo "curl -fsSL https://tailscale.com/install.sh | sh" ;;
  esac
}

# URLs with the Tailscale address, built from the bridge's own links (same port
# and token; only the host differs).  Tailscale's own address first.
remote_urls() {   # remote_urls <tailscale ip>
  local u first=""
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    [ -n "$first" ] || first="$u"
    case "$u" in "http://$1:"*) printf '%s\n' "$u"; return 0 ;; esac
  done < <(phone_urls)
  [ -n "$first" ] || return 0
  printf 'http://%s:%s\n' "$1" "${first#http://*:}"
}

remote_warn() {   # Tailscale is not usable: say what to do
  warn "Tailscale is not connected on this PC, so the phone cannot reach it from outside your home."
  if ! command -v tailscale >/dev/null 2>&1; then
    info "Tailscale is not installed.  Run once:  forgecoach remote-setup"
  else
    info "Connect it, then run 'forgecoach remote' again (the game keeps running):"
    fix "sudo tailscale up      (or, once set up: tailscale up)"
    info "First time?  Run:  forgecoach remote-setup"
  fi
}

# Keep this PC awake while the engine answers on $PORT: a systemd sleep+idle
# inhibitor held by a small watcher that ends (releasing it) when the engine is gone.
keep_awake() {
  local pid
  if [ -n "${FORGECOACH_NO_INHIBIT:-}" ]; then info "(Sleep is not held off: FORGECOACH_NO_INHIBIT is set.)"; return 0; fi
  pid="$(cat "$INHIBIT_FILE" 2>/dev/null || true)"
  if pid_alive "$pid"; then ok "This PC is kept awake while ForgeCoach runs."; return 0; fi
  if ! command -v systemd-inhibit >/dev/null 2>&1 || ! systemd-inhibit --what=sleep:idle --who=ForgeCoach --why=probe --mode=block true >/dev/null 2>&1 </dev/null; then
    warn "Could not stop this PC from sleeping automatically: turn off sleep yourself while you are away"
    info "     (System Settings > Power Management > Energy Saving: no suspend).  A sleeping PC is unreachable."
    return 0
  fi
  mkdir -p "$CACHE_DIR"
  (
    exec setsid nohup systemd-inhibit --what=sleep:idle --who=ForgeCoach \
      --why="ForgeCoach is serving your phone" --mode=block \
      bash -c 'f=0; while [ "$f" -lt 3 ]; do if curl -fsS --max-time 3 "http://127.0.0.1:$1/health" >/dev/null 2>&1; then f=0; else f=$((f + 1)); fi; sleep 20; done' _ "$PORT" \
      >/dev/null 2>&1 </dev/null
  ) &
  echo "$!" >"$INHIBIT_FILE"
  ok "This PC will not sleep while ForgeCoach runs (it can sleep again once you stop it)."
}

show_phone() {
  local urls first html ts="" mode_note
  if [ "$REMOTE" = "1" ]; then
    ts="$(tailscale_ip)"
    if [ -n "$ts" ]; then
      mapfile -t urls < <(remote_urls "$ts")
    else
      remote_warn
      mapfile -t urls < <(phone_urls)
      [ "${#urls[@]}" -gt 0 ] && info "(Until Tailscale is connected, the links below only work on your home Wi-Fi.)"
    fi
    keep_awake
  else
    mapfile -t urls < <(phone_urls)
  fi
  if [ "${#urls[@]}" -eq 0 ]; then
    warn "No phone address found: is this PC on a network?  (log: $ENGINE_LOG)"
    return 0
  fi
  first="${urls[0]}"
  (umask 077; printf '%s\n' "$first" >"$PHONE_FILE")
  if [ -n "$ts" ]; then
    say "On your phone (with the Tailscale app turned on), open:"
    mode_note="Phone: the Tailscale app on and logged in to the same account. Works on any network."
  else
    say "On your phone (same Wi-Fi), open:"
    mode_note="Phone on the same Wi-Fi as this PC."
  fi
  printf '\n    %s%s%s\n\n' "$B" "$first" "$N"
  [ "${#urls[@]}" -gt 1 ] && info "If that does not load, try: ${urls[*]:1}"
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 -m 2 "$first" || true; fi
  if [ -n "$ts" ]; then
    info "Only your own Tailscale devices can reach this link, and it also needs its secret token."
    info "Keep this PC on and connected to the internet while you are away."
  else
    info "Anyone on your Wi-Fi with this link can take the seat; the next start makes a new link."
  fi

  # KDE Connect: send the link straight to the phone.
  if [ -z "${FORGECOACH_NO_KDECONNECT:-}" ] && command -v kdeconnect-cli >/dev/null 2>&1; then
    local dev name
    dev="$(kdeconnect-cli -a --id-only 2>/dev/null </dev/null | head -n 1 || true)"
    if [ -n "$dev" ]; then
      name="$(kdeconnect-cli -a --name-only 2>/dev/null </dev/null | head -n 1 || true)"
      if kdeconnect-cli -d "$dev" --share "$first" >/dev/null 2>&1 </dev/null; then
        ok "Sent the link to ${name:-your phone} with KDE Connect: it should open there."
      fi
    else
      info "(KDE Connect: no phone connected right now, so the link was not sent to it.)"
    fi
  fi

  # A page on this PC with the link and a QR code to scan.  NOT the game itself:
  # this PC taking the seat would lock the phone out.
  html="$CACHE_DIR/phone.html"
  (
    umask 077
    {
      printf '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ForgeCoach on your phone</title>\n'
      printf '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
      printf '<style>body{font:18px/1.5 system-ui,sans-serif;margin:0;padding:40px 16px;text-align:center;background:#14161a;color:#e8e6e1}'
      printf 'a{color:#e8b85c;word-break:break-all;font-size:20px}#qr svg,#qr img{width:280px;height:280px;background:#fff;padding:12px;border-radius:8px}</style></head><body>\n'
      printf '<h1>Play ForgeCoach on your phone</h1><p>%s Scan the code with the camera, or open:</p>\n' "$mode_note"
      printf '<p><a href="%s">%s</a></p><div id="qr">' "$first" "$first"
      if command -v qrencode >/dev/null 2>&1; then qrencode -t SVG -m 2 -o - "$first" 2>/dev/null || true; fi
      printf '</div>\n<p style="opacity:.7">Then tap Play. Keep this PC on%s. To stop: app menu &rsaquo; Stop ForgeCoach.</p>\n' "$([ -n "$ts" ] && echo " and awake while you are away")"
      printf '<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script>\n'
      printf '<script>(function(){var q=document.getElementById("qr");if(q.innerHTML.trim()||typeof qrcode==="undefined")return;'
      printf 'var c=qrcode(0,"M");c.addData(%s);c.make();q.innerHTML=c.createSvgTag({scalable:true});})();</script>\n' "\"$first\""
      printf '</body></html>\n'
    } >"$html"
  )
  open_url "file://$html"
  NOTIFY_MSG="ForgeCoach (phone) is ready: $first"
  if [ "$REMOTE" = "1" ]; then
    NOTIFY_MSG="ForgeCoach (away from home) is ready: $first"
    [ -n "$ts" ] || NOTIFY_MSG="ForgeCoach is running, but Tailscale is not connected: the phone cannot reach it away from home."
  fi
}

start_engine() {
  local pid
  mkdir -p "$CACHE_DIR"
  chmod 700 "$CACHE_DIR" 2>/dev/null || true   # the log carries the phone's pairing link
  : >"$ENGINE_LOG"
  rm -f "$PHONE_FILE"
  say "Starting the Forge engine"
  # setsid: its own session, so closing this window does not stop it.
  (
    cd "$MTG"
    exec setsid nohup ./scripts/play.sh --engine-only "${PASS[@]+"${PASS[@]}"}" >>"$ENGINE_LOG" 2>&1 </dev/null
  ) &
  pid=$!
  echo "$pid" >"$PID_FILE"
  [ "$LAN" = "1" ] && echo lan >"$MODE_FILE" || echo desktop >"$MODE_FILE"
  echo "$PORT" >"$PORT_FILE"
  if ! wait_ready "$pid"; then
    explain_failure
    if pid_alive "$pid"; then stop_engine quiet; fi
    rm -f "$PID_FILE" "$MODE_FILE"
    return 1
  fi
  # /health turns ok a moment before play.sh starts the coach and prints its
  # "Engine ready" and "Coach:" lines.
  local coach i
  for i in $(seq 1 60); do
    grep -q '^Engine ready on' "$ENGINE_LOG" 2>/dev/null && break
    pid_alive "$pid" || break
    sleep 0.5
  done
  sleep 0.3
  coach="$(sed -n 's/^\(Coach: .*\)$/\1/p' "$ENGINE_LOG" | tail -n 1)"
  ok "Engine ready on ws://127.0.0.1:$PORT/ws"
  [ -n "$coach" ] && info "$coach"
  return 0
}

stop_engine() {   # stop_engine [quiet]
  local pid i jvm stopped=0
  pid="$(engine_pid)"
  if [ -n "$pid" ]; then
    [ "${1:-}" = "quiet" ] || info "Stopping the engine (pid $pid)..."
    kill -TERM "$pid" 2>/dev/null || true          # play.sh stops the JVM and the coach itself
    for i in $(seq 1 40); do pid_alive "$pid" || break; sleep 0.5; done
    if pid_alive "$pid"; then
      kill -TERM -- "-$pid" 2>/dev/null || true    # its whole session (setsid made it a group)
      sleep 3
      kill -KILL -- "-$pid" 2>/dev/null || true
    fi
    stopped=1
  fi
  # An engine this launcher did not start (play.sh typed in a terminal): its JVM.
  local port; port="$(cat "$PORT_FILE" 2>/dev/null || echo "$PORT")"
  if health "$port" && command -v pgrep >/dev/null 2>&1; then
    jvm="$(pgrep -f "mtgtable.MtgTable --transport ws --port $port" || true)"
    if [ -n "$jvm" ]; then
      # shellcheck disable=SC2086
      kill -TERM $jvm 2>/dev/null || true
      for i in $(seq 1 30); do health "$port" || break; sleep 0.5; done
      stopped=1
    fi
  fi
  local ipid; ipid="$(cat "$INHIBIT_FILE" 2>/dev/null || true)"
  if pid_alive "$ipid"; then kill -TERM -- "-$ipid" 2>/dev/null || kill -TERM "$ipid" 2>/dev/null || true; fi
  rm -f "$PID_FILE" "$MODE_FILE" "$PHONE_FILE" "$INHIBIT_FILE"
  [ "${1:-}" = "quiet" ] && return 0
  if health "$port"; then
    notify "Could not stop the engine on port $port.  If you started it in a terminal, press Ctrl-C there."
    return 1
  elif [ "$stopped" = "1" ]; then notify "ForgeCoach's engine is stopped."
  else notify "ForgeCoach's engine was not running."; fi
}

# ---------------------------------------------------------------------------
# install / update
# ---------------------------------------------------------------------------

self_file() {   # this script as a file, when it is one (not when piped from curl)
  local s="${BASH_SOURCE[0]:-}"
  if [ -n "$s" ] && [ -f "$s" ] && grep -q '^# forgecoach-launcher: 1' "$s" 2>/dev/null; then readlink -f "$s"; fi
}

valid_script() { [ -s "$1" ] && head -n 1 "$1" | grep -q '^#!/usr/bin/env bash' && grep -q '^# forgecoach-launcher: 1' "$1" && bash -n "$1" 2>/dev/null; }

download() {   # download <url> <dest>
  curl -fsSL --retry 2 --max-time 120 -o "$2" "$1" </dev/null
}

write_desktop() {   # write_desktop <file> <name> <comment> <args> [actions]
  local f="$APPS_DIR/$1" icon="$ICON" exe="$BIN"
  [ -f "$icon" ] || icon="applications-games"
  case "$exe" in *" "*) exe="\"$exe\"" ;; esac
  {
    printf '[Desktop Entry]\nType=Application\nVersion=1.0\n'
    printf 'Name=%s\nComment=%s\n' "$2" "$3"
    printf 'Exec=%s %s\nIcon=%s\nTerminal=false\n' "$exe" "$4" "$icon"
    printf 'Categories=Game;CardGame;\nKeywords=Magic;MTG;Forge;mtg-table;coach;\nStartupNotify=false\n'
    if [ -n "${5:-}" ]; then
      printf 'Actions=Phone;Remote;Stop;\n\n'
      printf '[Desktop Action Phone]\nName=ForgeCoach (phone)\nExec=%s launch --lan\nIcon=%s\n\n' "$exe" "$icon"
      printf '[Desktop Action Remote]\nName=ForgeCoach (away from home)\nExec=%s launch --remote\nIcon=%s\n\n' "$exe" "$icon"
      printf '[Desktop Action Stop]\nName=Stop ForgeCoach\nExec=%s stop --notify\nIcon=%s\n' "$exe" "$icon"
    fi
  } >"$f.tmp"
  chmod 755 "$f.tmp"
  mv -f "$f.tmp" "$f"
}

install_desktop() {
  mkdir -p "$APPS_DIR" "$(dirname "$ICON")"
  local src sibling
  src="$(self_file)"
  sibling="${src:+$(dirname "$src")/icons/icon-512.png}"
  if [ -n "$sibling" ] && [ -f "$sibling" ]; then cp -f "$sibling" "$ICON.tmp"
  else download "${FC_DOWNLOAD}icons/icon-512.png" "$ICON.tmp" 2>/dev/null || rm -f "$ICON.tmp"; fi
  if [ -f "$ICON.tmp" ] && [ "$(head -c 4 "$ICON.tmp" | od -An -c | tr -d ' ')" = "211PNG" ]; then mv -f "$ICON.tmp" "$ICON"
  else rm -f "$ICON.tmp"; [ -f "$ICON" ] || warn "Could not get the icon; the menu entry uses a generic one."; fi

  write_desktop forgecoach.desktop "ForgeCoach" "Play Magic against the Forge AI, with a coach" "launch" actions
  write_desktop forgecoach-phone.desktop "ForgeCoach (phone)" "Play ForgeCoach on your phone (same Wi-Fi)" "launch --lan"
  write_desktop forgecoach-remote.desktop "ForgeCoach (away from home)" "Play ForgeCoach on your phone from anywhere, over Tailscale (keep this PC on)" "launch --remote"
  write_desktop forgecoach-stop.desktop "Stop ForgeCoach" "Stop ForgeCoach's Forge engine" "stop --notify"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  for k in kbuildsycoca6 kbuildsycoca5; do
    if command -v "$k" >/dev/null 2>&1; then "$k" >/dev/null 2>&1 </dev/null || true; break; fi
  done
}

install_self() {   # install_self [force-download]
  local src tmp
  mkdir -p "$BIN_DIR"
  src="$(self_file)"
  tmp="$(mktemp "$BIN_DIR/.forgecoach.XXXXXX")"
  if [ -z "${1:-}" ] && [ -n "$src" ]; then
    if [ "$src" = "$(readlink -f "$BIN" 2>/dev/null || true)" ]; then rm -f "$tmp"; tmp=""
    else cp -f "$src" "$tmp"; fi
  else
    # Piped from curl (or `update`): fetch the published copy of this script.
    download "${FC_DOWNLOAD}forgecoach.sh" "$tmp" || { rm -f "$tmp"; bad "Could not download ${FC_DOWNLOAD}forgecoach.sh"; return 1; }
  fi
  if [ -n "$tmp" ]; then
    valid_script "$tmp" || { rm -f "$tmp"; bad "The downloaded launcher looks broken; nothing was changed."; return 1; }
    chmod 755 "$tmp"
    mv -f "$tmp" "$BIN"
  fi
  install_desktop
  mkdir -p "$CACHE_DIR" && date +%s >"$CACHE_DIR/update.stamp"
}

# The installed launcher refreshes itself once a day, so fixes reach the menu
# icon without anyone typing anything.  A broken download is never installed.
maybe_self_update() {
  [ -z "${FORGECOACH_NO_UPDATE:-}" ] || return 0
  [ "$(self_file)" = "$(readlink -f "$BIN" 2>/dev/null || echo none)" ] || return 0
  local stamp now tmp
  mkdir -p "$CACHE_DIR"
  stamp="$(cat "$CACHE_DIR/update.stamp" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  [ $((now - ${stamp:-0})) -gt 86400 ] || return 0
  echo "$now" >"$CACHE_DIR/update.stamp"
  tmp="$(mktemp "$BIN_DIR/.forgecoach.XXXXXX")"
  if download "${FC_DOWNLOAD}forgecoach.sh" "$tmp" 2>/dev/null && valid_script "$tmp" && ! cmp -s "$tmp" "$BIN"; then
    chmod 755 "$tmp"; mv -f "$tmp" "$BIN"
    info "(The ForgeCoach launcher was updated; the new version runs next time.)"
  else
    rm -f "$tmp"
  fi
}

# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

setup() {   # find, update, check -- shared by start, setup and install
  augment_path
  say "ForgeCoach"
  find_mtg || return 1
  [ "$PULL" = "1" ] && update_mtg
  local p; p="$(json_str "$MTG/config.json" wsPort)"
  case " ${PASS[*]+${PASS[*]}} " in *" --port "*) ;; *) [ -n "$p" ] && PORT="$p" ;; esac
  check_prereqs || return 1
  forge_home || return 1
}

finish() {   # finish <rc> -- what a terminal window opened from the menu does at the end
  local rc="$1"
  if [ "$WINDOW" = "1" ] && has_tty; then
    if [ "$rc" != "0" ]; then
      printf '\nPress Enter to close this window.' >/dev/tty; read -r _ </dev/tty || true
    elif [ "$LAN" = "1" ]; then
      printf '\nForgeCoach keeps running for the phone%s.  Press Enter to close this window.' "$([ "$REMOTE" = "1" ] && echo " (keep this PC on)")" >/dev/tty; read -r _ </dev/tty || true
    else
      printf '\nThis window closes in 20 seconds; ForgeCoach keeps running.  (Enter closes it now.)' >/dev/tty
      read -r -t 20 _ </dev/tty || true
    fi
  fi
  return "$rc"
}

NOTIFY_MSG=""
cmd_start() {
  local running mode
  parse_flags "$@"
  maybe_self_update || true
  augment_path
  # Already running?  Then there is nothing to build: open the page.
  running=0
  MTG="$(conf_get MTG_DIR)"
  local saved_port; saved_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
  case " ${PASS[*]+${PASS[*]}} " in *" --port "*) ;; *) [ -n "$saved_port" ] && PORT="$saved_port" ;; esac
  if health "$PORT"; then running=1
  elif [ -n "$(engine_pid)" ]; then
    say "ForgeCoach's engine is still starting; waiting for it..."
    wait_ready "$(engine_pid)" && running=1
  fi
  if [ "$running" = "1" ]; then
    mode="$(engine_mode)"
    if [ "$LAN" = "1" ] && [ "$mode" != "lan" ] && [ -z "$(phone_urls 2>/dev/null)" ]; then
      say "ForgeCoach is already running, but for this PC only (not the phone)."
      if ask "Restart it for the phone?  (This ends a game in progress.)" n; then
        stop_engine quiet; running=0
      else
        info "Left as it is.  For the phone: app menu > Stop ForgeCoach, then ForgeCoach (phone) or (away from home)."
        finish 1; return 1
      fi
    fi
  fi
  if [ "$running" = "1" ]; then
    say "ForgeCoach is already running (port $PORT)."
    if [ "$LAN" = "1" ]; then show_phone
    else
      [ "$(engine_mode)" = "lan" ] && info "(It was started for the phone: if the phone has the seat, this PC will be told so.)"
      open_url "$(app_url)"
      NOTIFY_MSG="ForgeCoach is running."
    fi
    [ -n "$NOTIFY_MSG" ] && popup "$NOTIFY_MSG"
    finish 0; return 0
  fi

  if ! setup; then
    popup "ForgeCoach can't start yet: see the window for what to install."
    finish 1; return 1
  fi
  if ! start_engine; then
    popup "ForgeCoach's engine did not start. Log: $ENGINE_LOG"
    finish 1; return 1
  fi
  if [ "$LAN" = "1" ]; then show_phone
  else
    open_url "$(app_url)"
    NOTIFY_MSG="ForgeCoach is ready."
  fi
  say "ForgeCoach is running in the background."
  info "To stop it: app menu > Stop ForgeCoach  (or: forgecoach stop).  Log: $ENGINE_LOG"
  [ -n "$NOTIFY_MSG" ] && popup "$NOTIFY_MSG"
  finish 0
}

cmd_launch() {   # the menu icon: `start` in a terminal window, so he can see what happens
  local self t
  self="$(self_file)"; [ -n "$self" ] || self="$BIN"
  if [ -t 1 ]; then cmd_start --window "$@"; return; fi
  for t in konsole x-terminal-emulator gnome-terminal xfce4-terminal kitty alacritty xterm; do
    command -v "$t" >/dev/null 2>&1 || continue
    case "$t" in
      konsole)        exec konsole --hide-menubar -p tabtitle=ForgeCoach -e "$self" start --window "$@" ;;
      gnome-terminal) exec gnome-terminal --title=ForgeCoach -- "$self" start --window "$@" ;;
      xfce4-terminal) exec xfce4-terminal --title=ForgeCoach -x "$self" start --window "$@" ;;
      kitty)          exec kitty --title ForgeCoach "$self" start --window "$@" ;;
      *)              exec "$t" -e "$self" start --window "$@" ;;
    esac
  done
  # No terminal program: run without a window and say how it went in pop-ups.
  mkdir -p "$CACHE_DIR"
  cmd_start --notify "$@" >"$CACHE_DIR/launch.log" 2>&1
}

cmd_remote() {   # play away from home: the phone mode over Tailscale
  cmd_start --remote "$@"
}

# Run a command the person has been shown, only after a yes at a terminal.
# Never without a terminal: then the command is only printed.
run_after_asking() {   # run_after_asking <question> <shown command> <command...>
  local q="$1" shown="$2"; shift 2
  fix "$shown"
  has_tty || { info "(No terminal here, so it was not run: paste the line above into a terminal.)"; return 1; }
  ask "$q" y || return 1
  "$@" </dev/tty
}

cmd_remote_setup() {
  local ts opk me
  parse_flags "$@"
  augment_path; detect_pm
  say "Away-from-home play: set up Tailscale (free; a private network between your own devices)"
  info "Nothing is opened to the internet: only devices logged in to YOUR Tailscale account can reach this PC."

  if command -v tailscale >/dev/null 2>&1; then
    ok "Tailscale is installed ($(tailscale version 2>/dev/null </dev/null | head -n 1 || echo '?'))"
  else
    bad "Tailscale is not installed on this PC ($DISTRO)."
    info "Install it with this command (it asks for your password; it is Tailscale's official installer):"
    if run_after_asking "  Run it now?" "$(tailscale_install_cmd)" bash -c "$(tailscale_install_cmd)"; then
      augment_path; hash -r
    fi
    if ! command -v tailscale >/dev/null 2>&1; then
      info "Copy the line above into a terminal, press Enter and type your password, then run:  forgecoach remote-setup"
      return 1
    fi
    ok "Tailscale is installed."
  fi

  if command -v systemctl >/dev/null 2>&1 && ! systemctl is-active --quiet tailscaled 2>/dev/null; then
    warn "The Tailscale background service (tailscaled) is not running."
    run_after_asking "  Start it now (and at every boot)?" "sudo systemctl enable --now tailscaled" sudo systemctl enable --now tailscaled || true
  fi

  ts="$(tailscale_ip)"
  if [ -n "$ts" ]; then
    ok "Tailscale is connected: this PC is $ts"
  else
    warn "Tailscale is not logged in / connected on this PC."
    info "Log in (it prints a web address to open in your browser; log in with the account you will also use on your phone):"
    if run_after_asking "  Run it now?" "sudo tailscale up" sudo tailscale up; then ts="$(tailscale_ip)"; fi
    if [ -n "$ts" ]; then ok "Connected: this PC is $ts"
    else info "When you have run it, run:  forgecoach remote-setup   (again; it is safe to repeat)"; fi
  fi

  if [ -n "$ts" ] && [ "$(conf_get TS_OPERATOR)" != "1" ]; then
    info "Optional: let your normal user run tailscale commands, so later ones need no password."
    me="${USER:-$(id -un)}"
    opk="sudo tailscale set --operator=$me"
    if run_after_asking "  Do that now?" "$opk" sudo tailscale set "--operator=$me"; then conf_set TS_OPERATOR 1; fi
  fi

  say "On your phone (once)"
  info "1. Install the Tailscale app: Android (Google Play) or iPhone (App Store), or https://tailscale.com/download"
  info "2. Open it and log in with the SAME account as on this PC.  Leave it on (it can run in the background)."
  info "3. Both devices should now show up in the Tailscale app."
  say "Each time you want to play away from home"
  info "1. Leave this PC on, awake and online (ForgeCoach stops it sleeping while it runs)."
  info "2. Start it from the PC, or ask someone at home: app menu > ForgeCoach (away from home)  (or: forgecoach remote)."
  info "   It sends the link to your phone with KDE Connect if that is connected, and shows a QR code."
  info "3. On the phone, with Tailscale on, open the link.  Stop it later with: app menu > Stop ForgeCoach."
  [ -n "$ts" ] || return 1
}

cmd_status() {
  local pid port mtg
  augment_path
  port="$(cat "$PORT_FILE" 2>/dev/null || echo 8642)"
  pid="$(engine_pid)"
  mtg="$(conf_get MTG_DIR)"
  say "ForgeCoach"
  if health "$port"; then
    ok "Engine running on ws://127.0.0.1:$port/ws (${pid:+pid $pid, }$(engine_mode))"
    [ -s "$PHONE_FILE" ] && info "Phone: $(cat "$PHONE_FILE")"
    info "Play: $(PORT=$port app_url)"
  elif [ -n "$pid" ]; then
    warn "Engine starting (pid $pid); log: $ENGINE_LOG"
  else
    info "Engine: not running"
  fi
  info "mtg-table: ${mtg:-(not found yet)}"
  info "Forge jar: $(conf_get FORGE_JAR | grep . || echo "(from mtg-table's config.json)")"
  info "Launcher:  $( [ -x "$BIN" ] && echo "$BIN" || echo "not installed ($ONE_LINER)")"
  info "Log:       $ENGINE_LOG"
}

cmd_install() {
  parse_flags "$@"
  say "Installing ForgeCoach"
  install_self || return 1
  ok "Launcher: $BIN"
  ok "App menu: ForgeCoach, ForgeCoach (phone), ForgeCoach (away from home), Stop ForgeCoach"
  # Do the slow, interactive part now, while there is a terminal to answer in.
  if setup; then
    say "All set."
    info "Start ForgeCoach from your app menu: search for ForgeCoach."
    if has_tty && ask "Start ForgeCoach now?" y; then cmd_start --no-pull; return; fi
  else
    info "When that is fixed, start ForgeCoach from your app menu (search for ForgeCoach)."
  fi
}

cmd_help() {
  local f; f="$(self_file)"
  if [ -n "$f" ]; then sed -n '2,/^set -euo pipefail/p' "$f" | sed '$d' | sed 's/^# \{0,1\}//'
  else echo "ForgeCoach launcher.  Install: $ONE_LINER"; fi
}

main() {
  local cmd="${1:-start}"
  case "$cmd" in --*) cmd=start ;; *) [ $# -gt 0 ] && shift ;; esac
  case "$cmd" in
    start)     cmd_start "$@" ;;
    launch)    cmd_launch "$@" ;;
    stop)      parse_flags "$@"; stop_engine ;;
    remote)    cmd_remote "$@" ;;
    remote-setup) cmd_remote_setup "$@" ;;
    status)    cmd_status ;;
    install)   cmd_install "$@" ;;
    update)    install_self force-download && ok "ForgeCoach launcher updated: $BIN" ;;
    setup)     parse_flags "$@"; setup ;;
    get-forge) augment_path; detect_pm; get_forge && conf_set FORGE_JAR "$JAR" ;;
    help|-h)   cmd_help ;;
    *)         echo "forgecoach: unknown command '$cmd' (try: forgecoach help)" >&2; return 2 ;;
  esac
}

# Everything above is only definitions, so a script piped into bash has been
# read in full before anything runs.
main "$@"; exit $?
