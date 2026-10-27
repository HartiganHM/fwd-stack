#!/usr/bin/env bash
# PreToolUse guard: run the pr-review gate before a merge or a re-request.
#
# The rules were prose in a skill, and the author of that skill broke three of
# them in one PR — not from disagreement, but from not knowing in the moment
# what round it was. This makes the harness ask instead of the model remember.
#
# Denies the tool call when pr-gate.mjs exits non-zero, and puts the gate's own
# reasoning in the denial so the next step is obvious rather than a mystery.
set -uo pipefail
# The gate sits beside this script, wherever the plugin is installed.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gate="$here/pr-gate.mjs"
payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

# Which gated action the command takes, on which PR and repository. The parsing lives in
# parse-command.mjs, where it is tested: a grep here once read only `gh pr merge <n>` and let
# `gh pr merge --squash <n>` through ungated.
#
# The repository matters too. The hook runs in the SESSION's working directory, which is not
# always the checkout the command `cd`s into, so the command's own `repos/O/R/`, `-R`, `--repo`,
# `GH_REPO=` or pull URL wins; pr-gate falls back to `gh repo view` when it names none.
read -r action pr repo <<<"$(node "$here/parse-command.mjs" "$cmd")"

# Not a gated command, or no PR number to check (e.g. `gh pr merge` on the current branch):
# allow rather than guess. A gate that blocks what it cannot read teaches people to disable it.
[ -z "${action:-}" ] && exit 0
[ -z "${pr:-}" ] && exit 0

if [ -n "${repo:-}" ]; then
  out=$(node "$gate" "$pr" --action "$action" --repo "$repo" 2>&1)
else
  out=$(node "$gate" "$pr" --action "$action" 2>&1)
fi
status=$?
[ $status -eq 0 ] && exit 0

jq -nc --arg reason "$out" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("pr-review gate:\n" + $reason)
  }
}'
exit 0
