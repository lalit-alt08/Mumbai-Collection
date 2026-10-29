#!/usr/bin/env bash
# Run as the WordPress service user. BACKUP_ROOT must be outside the web root.
set -euo pipefail
umask 077
: "${WP_ROOT:?Set WP_ROOT to the WordPress installation}"
: "${BACKUP_ROOT:?Set BACKUP_ROOT to a private backup directory}"
wp_root="$(realpath "$WP_ROOT")"
mkdir -p "$BACKUP_ROOT"
backup_root="$(realpath "$BACKUP_ROOT")"
case "$backup_root/" in "$wp_root/"*) echo 'Backups must be outside the web root' >&2; exit 1;; esac
backup_exit() {
  local result=$?
  if [ "$result" -ne 0 ]; then
    date -u +%s > "$backup_root/.last-failure-$$"
    mv "$backup_root/.last-failure-$$" "$backup_root/last-failure"
  fi
  exit "$result"
}
trap backup_exit EXIT
command -v wp >/dev/null
command -v flock >/dev/null
exec 9>"$backup_root/backup.lock"
flock -n 9 || exit 0
backup_dir="$(mktemp -d "$backup_root/snapshot-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
wp --path="$wp_root" db export "$backup_dir/database.sql" --single-transaction --quick --skip-lock-tables
gzip "$backup_dir/database.sql"
tar -C "$wp_root" -czf "$backup_dir/wp-content.tar.gz" wp-content
wp --path="$wp_root" core version > "$backup_dir/wordpress-version.txt"
wp --path="$wp_root" plugin list --format=json > "$backup_dir/plugins.json"
(
  cd "$backup_dir"
  sha256sum database.sql.gz wp-content.tar.gz wordpress-version.txt plugins.json > SHA256SUMS
  sha256sum -c SHA256SUMS
)
# The monitor only accepts completed, checksum-verified backups, never partial directories.
date -u +%s > "$backup_dir/completed-at"
cp "$backup_dir/completed-at" "$backup_root/.last-success-$$"
mv "$backup_root/.last-success-$$" "$backup_root/last-success"
printf '%s\n' "Backup created: $backup_dir"
# Copy this snapshot to encrypted off-server storage using the operator's
# configured provider. No credentials or destination are embedded here.
