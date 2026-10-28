#!/usr/bin/env bash
# Restore the state from before a switch.sh run (default: the last run).
#   machine/rollback.sh [backup-dir]
# Backups live in <config>/backups/fwd-switchover-<time>/. Rolling back the last run undoes that run
# only; to return to how the machine was before the FIRST switch, pass that run's folder.
set -euo pipefail
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
BACKUP="${1:-$(cat "$CFG/backups/fwd-switchover-last" 2>/dev/null || true)}"
[ -n "$BACKUP" ] && [ -d "$BACKUP" ] || { echo "no backup found (looked for ${BACKUP:-<none recorded>})"; exit 1; }
# switch.sh writes the state file last, so a backup without one was interrupted and is incomplete.
[ -f "$BACKUP/state" ] || { echo "$BACKUP has no state file (an interrupted backup); refusing to use it. Nothing changed."; exit 1; }
echo "== rolling back from $BACKUP"
PREV_PATH=""
LEDGER_EXISTED=1
# shellcheck disable=SC1091
. "$BACKUP/state"

[ -f "$BACKUP/settings.json" ] && cp -p "$BACKUP/settings.json" "$CFG/settings.json"
# Written through any symlink: `cp` onto a link writes its target, so a dotfiles link survives.
[ -f "$BACKUP/CLAUDE.md" ] && cp "$BACKUP/CLAUDE.md" "$CLAUDE_MD"
for d in "$BACKUP"/skills/*; do
  # -L too: a relative skill symlink dangles inside the backup but resolves once restored.
  [ -e "$d" ] || [ -L "$d" ] || continue
  rm -rf "$CFG/skills/$(basename "$d")"
  mkdir -p "$CFG/skills"
  cp -Rp "$d" "$CFG/skills/"
done
[ -d "$BACKUP/hooks" ] && { mkdir -p "$CFG/hooks"; cp -Rp "$BACKUP/hooks/." "$CFG/hooks/"; }
[ -d "$BACKUP/lib" ] && { mkdir -p "$CFG/lib"; cp -Rp "$BACKUP/lib/." "$CFG/lib/"; }

# A ledger this run carried into the data folder goes; the restored legacy ledger is the record again.
[ "$LEDGER_EXISTED" = 0 ] && rm -f "$CFG/plugins/data/fwd-fwd-stack/precheck-ledger.json"

# The plugin and the link go back to how they were: kept if they were there before this run.
if [ -n "$WAS_LINK" ]; then ln -sfn "$WAS_LINK" "$CFG/fwd"; else rm -f "$CFG/fwd"; fi
if [ "$WAS_INSTALLED" != 1 ]; then
  claude plugin uninstall fwd@fwd-stack --scope user >/dev/null 2>&1 || true
  # Absent already is success; still listed is a real failure, reported rather than hidden.
  if claude plugin list --json 2>/dev/null | grep -q '"fwd@fwd-stack"'; then
    echo "!! rollback restored your files, but 'claude plugin uninstall fwd@fwd-stack' failed: the plugin is still installed. Remove it by hand."
    exit 1
  fi
  echo "== rolled back; the plugin is uninstalled (it was not installed before)."
else
  # Put the previous install back exactly: its cached copy and the install record that points at it.
  if [ -n "$PREV_PATH" ] && [ -d "$BACKUP/plugin-copy" ] && [ -f "$BACKUP/installed_plugins.json" ]; then
    rm -rf "$PREV_PATH"
    mkdir -p "$(dirname "$PREV_PATH")"
    cp -Rp "$BACKUP/plugin-copy" "$PREV_PATH"
    cp -p "$BACKUP/installed_plugins.json" "$CFG/plugins/installed_plugins.json"
  fi
  echo "== rolled back; the previous plugin install is restored."
fi
