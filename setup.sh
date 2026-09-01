#!/usr/bin/env bash
# Reproduce the dependency and runtime-account setup in a fresh debian:latest
# environment. This script never starts or stops the service or its container.

set -Eeuo pipefail
IFS=$'\n\t'
umask 022

readonly SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly RUNTIME_ROOT='/opt/storage-and-sharing-services'
readonly RUNTIME_HOME='/var/lib/storage-and-sharing-services'
readonly RUNTIME_USER='storage-service'
readonly RUNTIME_GROUP='storage-service'
readonly RUNTIME_UID='10001'
readonly RUNTIME_GID='10001'
readonly DEPENDENCY_STAMP="$RUNTIME_ROOT/.dependencies-ready"

die() {
  printf 'setup.sh: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '==> %s\n' "$*"
}

require_fresh_debian_environment() {
  (( EUID == 0 )) || die 'run this setup as root inside the fresh Debian environment'
  [[ -r /etc/os-release ]] || die '/etc/os-release is missing'

  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == 'debian' ]] ||
    die "expected Debian; found ${PRETTY_NAME:-an unknown environment}"

  [[ -r "$SOURCE_ROOT/package.json" ]] || die 'package.json is missing beside setup.sh'
  [[ -r "$SOURCE_ROOT/package-lock.json" ]] || die 'package-lock.json is missing beside setup.sh'
}

install_system_dependencies() {
  local -a packages=(ca-certificates curl nodejs npm passwd util-linux)
  local -a missing=()
  local package status

  for package in "${packages[@]}"; do
    status="$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)"
    [[ "$status" == 'install ok installed' ]] || missing+=("$package")
  done

  if (( ${#missing[@]} == 0 )); then
    note 'Reusing installed Debian system dependencies'
  else
    local -a apt_options=(
      -o APT::Get::AllowUnauthenticated=false
      -o Acquire::AllowInsecureRepositories=false
      -o Acquire::AllowDowngradeToInsecureRepositories=false
      -o Acquire::Check-Valid-Until=true
      -o APT::Install-Recommends=false
      -o APT::Install-Suggests=false
    )

    export DEBIAN_FRONTEND=noninteractive
    note 'Refreshing signed Debian package indexes'
    apt-get "${apt_options[@]}" update
    note "Installing Debian dependencies without recommends: ${missing[*]}"
    apt-get "${apt_options[@]}" install --yes --no-install-recommends "${missing[@]}"
    apt-get clean
  fi

  apt-get check
  [[ -z "$(dpkg --audit)" ]] || die 'dpkg reports an incomplete package state'
}

validate_node_runtime() {
  command -v node >/dev/null 2>&1 || die 'the Debian nodejs package did not provide node'
  command -v npm >/dev/null 2>&1 || die 'the Debian npm package did not provide npm'

  local version major
  version="$(node --version)"
  major="${version#v}"
  major="${major%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || die "cannot parse Node.js version: $version"
  (( major >= 20 )) || die "Node.js 20 or newer is required; Debian provided $version"
}

ensure_runtime_identity() {
  local existing passwd_entry actual_uid actual_gid actual_home actual_shell

  existing="$(getent group "$RUNTIME_GID" | cut -d: -f1 || true)"
  [[ -z "$existing" || "$existing" == "$RUNTIME_GROUP" ]] ||
    die "GID $RUNTIME_GID already belongs to group $existing"
  if ! getent group "$RUNTIME_GROUP" >/dev/null; then
    groupadd --system --gid "$RUNTIME_GID" "$RUNTIME_GROUP"
  fi
  [[ "$(getent group "$RUNTIME_GROUP" | cut -d: -f3)" == "$RUNTIME_GID" ]] ||
    die "$RUNTIME_GROUP exists with an unexpected GID"

  existing="$(getent passwd "$RUNTIME_UID" | cut -d: -f1 || true)"
  [[ -z "$existing" || "$existing" == "$RUNTIME_USER" ]] ||
    die "UID $RUNTIME_UID already belongs to user $existing"
  if ! id -u "$RUNTIME_USER" >/dev/null 2>&1; then
    useradd --system --uid "$RUNTIME_UID" --gid "$RUNTIME_GROUP" \
      --home-dir "$RUNTIME_HOME" --shell /usr/sbin/nologin --no-create-home \
      "$RUNTIME_USER"
  fi
  [[ "$(id -u "$RUNTIME_USER")" == "$RUNTIME_UID" ]] ||
    die "$RUNTIME_USER exists with an unexpected UID"

  passwd_entry="$(getent passwd "$RUNTIME_USER")"
  IFS=: read -r _ _ actual_uid actual_gid _ actual_home actual_shell <<< "$passwd_entry"
  [[ "$actual_uid" == "$RUNTIME_UID" && "$actual_gid" == "$RUNTIME_GID" ]] ||
    die "$RUNTIME_USER has an unexpected UID or primary GID"
  [[ "$actual_home" == "$RUNTIME_HOME" ]] ||
    die "$RUNTIME_USER has an unexpected home directory"
  [[ "$actual_shell" == '/usr/sbin/nologin' ]] ||
    die "$RUNTIME_USER has an unexpected login shell"

  install -d -m 0750 -o "$RUNTIME_UID" -g "$RUNTIME_GID" "$RUNTIME_HOME"
}

install_project_dependencies() {
  if [[ -f "$DEPENDENCY_STAMP" && -d "$RUNTIME_ROOT/node_modules" &&
        -f "$RUNTIME_ROOT/package.json" && -f "$RUNTIME_ROOT/package-lock.json" ]] &&
     cmp -s "$SOURCE_ROOT/package.json" "$RUNTIME_ROOT/package.json" &&
     cmp -s "$SOURCE_ROOT/package-lock.json" "$RUNTIME_ROOT/package-lock.json"; then
    note "Reusing locked npm dependencies in $RUNTIME_ROOT"
    return
  fi

  note "Installing locked npm dependencies into $RUNTIME_ROOT"
  install -d -m 0755 "$RUNTIME_ROOT"
  rm -f "$DEPENDENCY_STAMP"
  install -m 0644 "$SOURCE_ROOT/package.json" "$RUNTIME_ROOT/package.json"
  install -m 0644 "$SOURCE_ROOT/package-lock.json" "$RUNTIME_ROOT/package-lock.json"
  npm ci \
    --prefix "$RUNTIME_ROOT" \
    --cache /tmp/storage-and-sharing-services-npm-cache \
    --no-audit \
    --no-fund
  chown -R root:root "$RUNTIME_ROOT"
  chmod -R go-w "$RUNTIME_ROOT"
  touch "$DEPENDENCY_STAMP"
}

main() {
  require_fresh_debian_environment
  install_system_dependencies
  validate_node_runtime
  ensure_runtime_identity
  install_project_dependencies
  note 'Environment replication complete; the service has not been started'
}

main "$@"
