#!/usr/bin/env bash
# Checks that the fwd plugin is installed and its guards answer as they should. Exit 0 only if all pass.
set -uo pipefail
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
LINK="$CFG/fwd"
fail=0
check() {
  if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

check "plugin fwd@fwd-stack installed" "claude plugin list 2>/dev/null | grep -q 'fwd@fwd-stack'"
check "settings.json is valid JSON" "python3 -c 'import json;json.load(open(\"$CFG/settings.json\"))'"
check "no user-scope copies of the plugin's hooks remain" "! grep -qE 'skills/pr-review/gate-hook|hooks/neon-prod-guard|hooks/autonomous-guard' '$CFG/settings.json'"
check "stable path resolves" "test -f '$LINK/skills/pr-review/pr-gate.mjs' && test -f '$LINK/hooks/autonomous-guard.mjs'"
# Only a machine that had a ledger beside the old skill has one to carry.
LAST=$(cat "$CFG/backups/fwd-switchover-last" 2>/dev/null)
check "pre-open ledger carried over (when there was one)" "! test -f '$LAST/skills/pr-review/precheck-ledger.json' || test -f '$CFG/plugins/data/fwd-fwd-stack/precheck-ledger.json'"
# The Neon guard denies a write to the first protected branch in fwd.json (or, with none, to a call
# that names no branch, which Neon runs on the default branch), through the plugin's own copy.
PROTECTED=$(node -e 'try{const c=require(process.argv[1]);process.stdout.write(Object.keys(c.neon?.protected??{})[0]??"")}catch{}' "$CFG/fwd.json" 2>/dev/null)
BRANCH_ARG=${PROTECTED:+\"branch_id\":\"$PROTECTED\",}
NEON_OUT=$(echo "{\"tool_name\":\"mcp__neon__run_sql\",\"tool_input\":{${BRANCH_ARG}\"sql\":\"delete from x\"}}" |
  CLAUDE_PROJECT_DIR= node "$LINK/hooks/neon-prod-guard.mjs" 2>&1)
check "Neon guard denies a production write" 'grep -q "\"deny\"" <<<"$NEON_OUT"'

# The merge gate denies a command it cannot attribute (a fail-closed parse; no network needed).
GATE_OUT=$(printf '%s' '{"tool_input":{"command":"gh pr merge $PR --squash"}}' | bash "$LINK/skills/pr-review/gate-hook.sh" 2>&1)
check "merge gate fails closed on an unreadable merge" 'grep -q deny <<<"$GATE_OUT"'

# The autonomous guard arms, blocks a stop, and disarms.
SID="verify-$$"
node "$LINK/hooks/autonomous-guard.mjs" arm verify --session="$SID" --minutes=1 --max=1 >/dev/null 2>&1
STOP_OUT=$(echo "{\"session_id\":\"$SID\"}" | node "$LINK/hooks/autonomous-guard.mjs" 2>&1)
node "$LINK/hooks/autonomous-guard.mjs" disarm --session="$SID" >/dev/null 2>&1
check "autonomous guard blocks a stop while armed" 'grep -q block <<<"$STOP_OUT"'

exit $fail
