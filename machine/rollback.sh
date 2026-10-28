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
# shellcheck disable=SC1091
. "$BACKUP/state"

LEGACY="$CFG/skills/pr-review/precheck-ledger.json"
LEDGER="$CFG/plugins/data/fwd-fwd-stack/precheck-ledger.json"
NOW=$(date +%Y%m%d-%H%M%S)
# Ledger entries are never lost: every ledger this rollback is about to replace or see deleted gets a
# recovery copy in the backup folder first (they survive a failed or repeated rollback), and the
# restored legacy ledger is the union of all of them, entries de-duplicated.
merge_ledgers() { # merge_ledgers <into> <from>...
  node -e '
    const fs = require("fs");
    const [into, ...from] = process.argv.slice(1);
    const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
    const seen = new Set(), entries = [];
    for (const p of [into, ...from]) for (const e of read(p)?.entries ?? []) {
      const k = JSON.stringify(e);
      if (!seen.has(k)) { seen.add(k); entries.push(e); }
    }
    fs.writeFileSync(into, JSON.stringify({ ...(read(into) ?? read(from[0]) ?? {}), entries }, null, 2) + "\n");
  ' "$@"
}
LIVE_COPY=""
if [ -f "$LEGACY" ]; then
  LIVE_COPY="$BACKUP/ledger-recovery-legacy-$NOW.json"
  cp -p "$LEGACY" "$LIVE_COPY"
fi

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
# A ledger already at the legacy path (from an earlier, failed rollback) holds the newest entries.
[ -n "$LIVE_COPY" ] && { mkdir -p "$(dirname "$LEGACY")"; [ -f "$LEGACY" ] && merge_ledgers "$LEGACY" "$LIVE_COPY" || cp -p "$LIVE_COPY" "$LEGACY"; }
[ -d "$BACKUP/hooks" ] && { mkdir -p "$CFG/hooks"; cp -Rp "$BACKUP/hooks/." "$CFG/hooks/"; }
[ -d "$BACKUP/lib" ] && { mkdir -p "$CFG/lib"; cp -Rp "$BACKUP/lib/." "$CFG/lib/"; }

# When the plugin goes, its data folder goes with it (`plugin uninstall` deletes it), whatever was
# there before the switch. Its ledger is merged into the legacy one the restored skill reads.
if [ "$WAS_INSTALLED" != 1 ] && [ -f "$LEDGER" ]; then
  cp -p "$LEDGER" "$BACKUP/ledger-recovery-data-$NOW.json"
  mkdir -p "$(dirname "$LEGACY")"
  if [ -f "$LEGACY" ]; then merge_ledgers "$LEGACY" "$LEDGER"; else cp -p "$LEDGER" "$LEGACY"; fi
fi

# The plugin and the link go back to how they were: kept if they were there before this run.
if [ -n "$WAS_LINK" ]; then ln -sfn "$WAS_LINK" "$CFG/fwd"; else rm -f "$CFG/fwd"; fi
if [ "$WAS_INSTALLED" != 1 ]; then
  claude plugin uninstall fwd@fwd-stack --scope user >/dev/null 2>&1 || true
  # Success only when a listing that could be read shows the plugin absent; anything else is reported.
  if ! LISTED=$(claude plugin list --json 2>/dev/null) ||
    ! node -e 'process.exit(JSON.parse(process.argv[1]).some(x=>x.id==="fwd@fwd-stack")?1:0)' "$LISTED" 2>/dev/null; then
    echo "!! rollback restored your files, but could not confirm fwd@fwd-stack is uninstalled. Check 'claude plugin list' and remove it by hand."
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
