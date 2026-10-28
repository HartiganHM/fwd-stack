#!/usr/bin/env bash
# Install the fwd plugin on this machine, and retire any user-scope copies of its skills and hooks.
# Works on a fresh machine (nothing to retire) and on one that ran the skills from ~/.claude/skills.
#
#   machine/switch.sh --dry-run   print every step, change nothing
#   machine/switch.sh             back up, apply, verify; on any failed check, roll back automatically
#
# Run it when no session is mid-review or mid-merge: a running session can drop its user-scope hooks
# when settings.json changes, but loads the plugin's only when it restarts. Restart sessions after.
set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$CFG/backups/fwd-switchover-$STAMP"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FWD_SKILLS=(pr-review backlog-audit complete-and-ship copy-review css-layout-triage design-review
  design-status epic-run feature-acceptance feature-run-report infra-setup prose-pass ui-audit)
DATA="$CFG/plugins/data/fwd-fwd-stack"
MARKET="$CFG/plugins/marketplaces/fwd-stack/plugins/fwd"
LINK="$CFG/fwd"   # stable path for Bash commands and docs: ~/.claude/fwd/skills/..., ~/.claude/fwd/hooks/...

run() {
  echo "+ $*"
  [ $DRY -eq 1 ] || eval "$@"
}

echo "== fwd switchover ($([ $DRY -eq 1 ] && echo DRY RUN || echo APPLY)), backup: $BACKUP"

# 1. Back up everything this touches.
run "mkdir -p '$BACKUP/skills'"
for f in settings.json CLAUDE.md; do
  [ -f "$CFG/$f" ] && run "cp -p '$CFG/$f' '$BACKUP/$f'"
done
for s in "${FWD_SKILLS[@]}"; do
  [ -e "$CFG/skills/$s" ] && run "cp -Rp '$CFG/skills/$s' '$BACKUP/skills/$s'"
done
[ -d "$CFG/hooks" ] && run "cp -Rp '$CFG/hooks' '$BACKUP/hooks'"
[ -d "$CFG/lib" ] && run "cp -Rp '$CFG/lib' '$BACKUP/lib'"
[ $DRY -eq 1 ] || echo "$BACKUP" > "$CFG/backups/fwd-switchover-last"

# 2. Install the plugin from its GitHub marketplace.
if ! claude plugin marketplace list 2>/dev/null | grep -q 'fwd-stack'; then
  run "claude plugin marketplace add HartiganHM/fwd-stack"
else
  run "claude plugin marketplace update fwd-stack"
fi
run "claude plugin install fwd@fwd-stack --scope user"

# 3. Carry state into the plugin's data folder: the pre-open pass ledger.
run "mkdir -p '$DATA'"
if [ -f "$CFG/skills/pr-review/precheck-ledger.json" ] && [ ! -f "$DATA/precheck-ledger.json" ]; then
  run "cp -p '$CFG/skills/pr-review/precheck-ledger.json' '$DATA/precheck-ledger.json'"
fi

# 4. Stable path for commands outside hooks (Bash does not get CLAUDE_PLUGIN_ROOT).
run "ln -sfn '$MARKET' '$LINK'"

# 5. Remove the user-scope hook entries the plugin now provides (gate, Neon guard, autonomous guard).
[ -f "$CFG/settings.json" ] && run "python3 '$HERE/strip-hooks.py' '$CFG/settings.json'"

# 6. Retire the duplicate user-scope skills (the plugin ships them), and the old hook copies.
for s in "${FWD_SKILLS[@]}"; do
  [ -e "$CFG/skills/$s" ] && run "rm -rf '$CFG/skills/$s'"
done
for f in autonomous-guard.mjs neon-guard.mjs neon-prod-guard.mjs; do
  [ -e "$CFG/hooks/$f" ] && run "rm -f '$CFG/hooks/$f'"
done
[ -e "$CFG/lib/fwd-config.mjs" ] && run "rm -f '$CFG/lib/fwd-config.mjs'"

# 7. Point the user CLAUDE.md at the stable path.
[ -f "$CFG/CLAUDE.md" ] && run "perl -pi -e 's#~/\.claude/skills/pr-review/#~/.claude/fwd/skills/pr-review/#g; s#~/\.claude/hooks/autonomous-guard\.mjs#~/.claude/fwd/hooks/autonomous-guard.mjs#g' '$CFG/CLAUDE.md'"

[ $DRY -eq 1 ] && { echo "== dry run complete: nothing changed"; exit 0; }

# 8. Verify; roll back on any failure.
if ! "$HERE/verify.sh"; then
  echo "!! verification failed: rolling back from $BACKUP"
  "$HERE/rollback.sh" "$BACKUP"
  exit 1
fi
echo "== switchover complete. Restart Claude sessions to load the plugin's hooks."
