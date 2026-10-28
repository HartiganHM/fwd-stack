#!/usr/bin/env bash
# Restore the state from before a switch.sh run (default: the last run).
#   machine/rollback.sh [backup-dir]
# Backups live in <config>/backups/fwd-switchover-<time>/. Rolling back the last run undoes that run
# only; to return to how the machine was before the FIRST switch, pass that run's folder.
set -euo pipefail
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
BACKUP="${1:-$(cat "$CFG/backups/fwd-switchover-last" 2>/dev/null || true)}"
[ -n "$BACKUP" ] && [ -d "$BACKUP" ] || { echo "no backup found (looked for ${BACKUP:-<none recorded>})"; exit 1; }
echo "== rolling back from $BACKUP"
WAS_INSTALLED=0
WAS_LINK=""
CLAUDE_MD="$CFG/CLAUDE.md"
# shellcheck disable=SC1091
[ -f "$BACKUP/state" ] && . "$BACKUP/state"

[ -f "$BACKUP/settings.json" ] && cp -p "$BACKUP/settings.json" "$CFG/settings.json"
# Written through any symlink: `cp` onto a link writes its target, so a dotfiles link survives.
[ -f "$BACKUP/CLAUDE.md" ] && cp "$BACKUP/CLAUDE.md" "$CLAUDE_MD"
for d in "$BACKUP"/skills/*; do
  [ -e "$d" ] || continue
  rm -rf "$CFG/skills/$(basename "$d")"
  mkdir -p "$CFG/skills"
  cp -Rp "$d" "$CFG/skills/"
done
[ -d "$BACKUP/hooks" ] && { mkdir -p "$CFG/hooks"; cp -Rp "$BACKUP/hooks/." "$CFG/hooks/"; }
[ -d "$BACKUP/lib" ] && { mkdir -p "$CFG/lib"; cp -Rp "$BACKUP/lib/." "$CFG/lib/"; }

# The plugin and the link go back to how they were: kept if they were there before this run.
if [ -n "$WAS_LINK" ]; then ln -sfn "$WAS_LINK" "$CFG/fwd"; else rm -f "$CFG/fwd"; fi
if [ "$WAS_INSTALLED" != 1 ]; then
  claude plugin uninstall fwd@fwd-stack --scope user >/dev/null 2>&1 || true
  echo "== rolled back; the plugin is uninstalled (it was not installed before)."
else
  echo "== rolled back; the plugin stays installed (it was installed before)."
fi
