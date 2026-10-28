#!/usr/bin/env bash
# Restore the pre-switchover state from a backup folder (default: the last one switch.sh made).
#   rollback.sh [backup-dir]
set -euo pipefail
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
BACKUP="${1:-$(cat "$CFG/backups/fwd-switchover-last" 2>/dev/null)}"
[ -d "$BACKUP" ] || { echo "no backup at $BACKUP"; exit 1; }
echo "== rolling back from $BACKUP"
for f in settings.json CLAUDE.md; do
  [ -f "$BACKUP/$f" ] && cp -p "$BACKUP/$f" "$CFG/$f"
done
for d in "$BACKUP"/skills/*; do
  [ -e "$d" ] || continue
  rm -rf "$CFG/skills/$(basename "$d")"
  cp -Rp "$d" "$CFG/skills/"
done
[ -d "$BACKUP/hooks" ] && cp -Rp "$BACKUP/hooks/." "$CFG/hooks/"
[ -d "$BACKUP/lib" ] && { mkdir -p "$CFG/lib"; cp -Rp "$BACKUP/lib/." "$CFG/lib/"; }
rm -f "$CFG/fwd"
claude plugin uninstall fwd@fwd-stack --scope user >/dev/null 2>&1 || true
echo "== rolled back. The plugin is uninstalled; the marketplace entry is left in place."
