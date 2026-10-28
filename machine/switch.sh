#!/usr/bin/env bash
# Install the fwd plugin on this machine, and retire any user-scope copies of its skills and hooks.
# Works on a fresh machine (nothing to retire), on one that ran the skills from ~/.claude/skills,
# and on one already switched (it updates the plugin and re-links).
#
#   machine/switch.sh --dry-run   print every step, change nothing
#   machine/switch.sh             back up, apply, verify; any failure after the backup rolls back
#
# Run it when no session is mid-review or mid-merge: a running session can drop its user-scope hooks
# when settings.json changes, but loads the plugin's only when it restarts. Restart sessions after.
# -E: the ERR trap below also fires for a failure inside `run`, not only at the top level.
set -Eeuo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$CFG/backups/fwd-switchover-$STAMP"
DATA="$CFG/plugins/data/fwd-fwd-stack"
LINK="$CFG/fwd" # stable path for Bash commands and docs: <config>/fwd/skills/..., <config>/fwd/hooks/...
# Every skill the plugin ships, read from this checkout, so a new skill is retired too.
FWD_SKILLS=()
for d in "$HERE/../plugins/fwd/skills"/*/; do FWD_SKILLS+=("$(basename "$d")"); done
# CLAUDE.md is edited where it really lives, so a dotfiles symlink stays a symlink.
CLAUDE_MD="$CFG/CLAUDE.md"
[ -L "$CLAUDE_MD" ] && CLAUDE_MD="$(cd "$(dirname "$CLAUDE_MD")" && cd "$(dirname "$(readlink "$CLAUDE_MD")")" && pwd)/$(basename "$(readlink "$CLAUDE_MD")")"
# How CLAUDE.md names the config folder: `~/.claude` by default, else its absolute path.
if [ "$CFG" = "$HOME/.claude" ]; then SHOWN='~/.claude'; else SHOWN="$CFG"; fi

run() {
  echo "+ $*"
  [ $DRY -eq 1 ] || eval "$@"
}
installed_path() {
  claude plugin list --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.id==="fwd@fwd-stack");process.stdout.write(p?p.installPath:"")}catch{}})'
}

echo "== fwd switchover ($([ $DRY -eq 1 ] && echo DRY RUN || echo APPLY)), backup: $BACKUP"

# 1. Back up everything this touches, and record what was there before, so a rollback restores it.
run "mkdir -p '$BACKUP/skills'"
for f in settings.json; do
  [ -f "$CFG/$f" ] && run "cp -p '$CFG/$f' '$BACKUP/$f'"
done
[ -f "$CLAUDE_MD" ] && run "cp -p '$CLAUDE_MD' '$BACKUP/CLAUDE.md'"
for s in "${FWD_SKILLS[@]}"; do
  [ -e "$CFG/skills/$s" ] && run "cp -Rp '$CFG/skills/$s' '$BACKUP/skills/$s'"
done
[ -d "$CFG/hooks" ] && run "cp -Rp '$CFG/hooks' '$BACKUP/hooks'"
[ -d "$CFG/lib" ] && run "cp -Rp '$CFG/lib' '$BACKUP/lib'"
WAS_INSTALLED=$([ -n "$(installed_path)" ] && echo 1 || echo 0)
WAS_LINK=$([ -L "$LINK" ] && readlink "$LINK" || echo "")
if [ $DRY -eq 0 ]; then
  printf 'WAS_INSTALLED=%s\nWAS_LINK=%q\nCLAUDE_MD=%q\n' "$WAS_INSTALLED" "$WAS_LINK" "$CLAUDE_MD" >"$BACKUP/state"
  echo "$BACKUP" >"$CFG/backups/fwd-switchover-last"
  # From here, any failure rolls back to this backup.
  trap 'echo "!! step failed: rolling back from $BACKUP"; "$HERE/rollback.sh" "$BACKUP"; exit 1' ERR
fi

# 2. Install the plugin from its GitHub marketplace, or bring an existing install up to date.
if ! claude plugin marketplace list 2>/dev/null | grep -q 'fwd-stack'; then
  run "claude plugin marketplace add HartiganHM/fwd-stack"
else
  run "claude plugin marketplace update fwd-stack"
fi
if [ "$WAS_INSTALLED" = 1 ]; then
  run "claude plugin update fwd@fwd-stack --scope user"
else
  run "claude plugin install fwd@fwd-stack --scope user"
fi

# 3. Carry state into the plugin's data folder: the pre-open pass ledger.
run "mkdir -p '$DATA'"
if [ -f "$CFG/skills/pr-review/precheck-ledger.json" ] && [ ! -f "$DATA/precheck-ledger.json" ]; then
  run "cp -p '$CFG/skills/pr-review/precheck-ledger.json' '$DATA/precheck-ledger.json'"
fi

# 4. Stable path to the copy Claude Code actually runs (the install cache), for commands outside hooks.
if [ $DRY -eq 1 ]; then
  echo "+ ln -sfn <installed plugin path> '$LINK'"
else
  INSTALLED="$(installed_path)"
  [ -n "$INSTALLED" ] || { echo "plugin not reported as installed"; false; }
  run "ln -sfn '$INSTALLED' '$LINK'"
fi

# 5. Remove the user-scope hook entries the plugin now provides (gate, Neon guard, autonomous guard).
[ -f "$CFG/settings.json" ] && run "python3 '$HERE/strip-hooks.py' '$CFG/settings.json'"

# 6. Retire the duplicate user-scope skills (the plugin ships them), and the old hook copies.
for s in "${FWD_SKILLS[@]}"; do
  [ -e "$CFG/skills/$s" ] && run "rm -rf '$CFG/skills/$s'"
done
for f in autonomous-guard.mjs neon-guard.mjs neon-prod-guard.mjs session-budget.mjs; do
  [ -e "$CFG/hooks/$f" ] && run "rm -f '$CFG/hooks/$f'"
done
[ -e "$CFG/lib/fwd-config.mjs" ] && run "rm -f '$CFG/lib/fwd-config.mjs'"

# 7. Point the user CLAUDE.md at the stable path.
# Both spellings of the old paths, `~/.claude/...` and the config folder's absolute path, are rewritten.
for OLD in '~/.claude' "$CFG"; do
  [ -f "$CLAUDE_MD" ] && run "perl -pi -e 's#\\Q$OLD\\E/skills/pr-review/#$SHOWN/fwd/skills/pr-review/#g; s#\\Q$OLD\\E/hooks/autonomous-guard\\.mjs#$SHOWN/fwd/hooks/autonomous-guard.mjs#g' '$CLAUDE_MD'"
done

[ $DRY -eq 1 ] && { echo "== dry run complete: nothing changed"; exit 0; }

# 8. Verify; roll back on any failure.
trap - ERR
if ! "$HERE/verify.sh"; then
  echo "!! verification failed: rolling back from $BACKUP"
  "$HERE/rollback.sh" "$BACKUP"
  exit 1
fi
echo "== switchover complete. Restart Claude sessions to load the plugin's hooks."
