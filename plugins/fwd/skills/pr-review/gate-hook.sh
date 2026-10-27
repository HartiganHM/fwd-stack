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
gate="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-gate.mjs"
payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

action=""
pr=""
if printf '%s' "$cmd" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+merge\b'; then
  action=merge
  pr=$(printf '%s' "$cmd" | grep -oE '\bgh[[:space:]]+pr[[:space:]]+merge[[:space:]]+[0-9]+' | grep -oE '[0-9]+$')
elif printf '%s' "$cmd" | grep -qE 'pulls/[0-9]+/merge\b'; then
  # The REST form of a merge (`gh api -X PUT repos/O/R/pulls/N/merge`) never
  # spells `gh pr merge`, and it is how orchestrated lanes merge.
  action=merge
  pr=$(printf '%s' "$cmd" | grep -oE 'pulls/[0-9]+/merge' | head -1 | grep -oE '[0-9]+')
elif printf '%s' "$cmd" | grep -qE 'requested_reviewers|request-copilot-review'; then
  action=rerequest
  # Two shapes reach this branch. The raw API call carries the PR in its path.
  # A project wrapper hides that call inside a script, so the hook only ever
  # sees the script name and its arguments — one project mandates
  # `scripts/request-copilot-review.sh <pr>`, which took the re-request gate
  # out of play entirely until this second pattern existed.
  pr=$(printf '%s' "$cmd" | grep -oE 'pulls/[0-9]+/requested_reviewers' | grep -oE '[0-9]+')
  [ -z "$pr" ] && pr=$(printf '%s' "$cmd" |
    grep -oE 'request-copilot-review[^[:space:]]*[[:space:]]+[0-9]+' | grep -oE '[0-9]+$')
fi

# Not a gated command, or no PR number to check (e.g. `gh pr merge` on the
# current branch): allow rather than guess. A gate that blocks what it cannot
# read teaches people to disable it.
[ -z "$action" ] && exit 0
[ -z "$pr" ] && exit 0

# Which repository the command is acting on. The hook runs in the SESSION's
# working directory, which is not always the checkout the command `cd`s into —
# a session rooted in one repo fixing a PR in another had the gate resolve the
# wrong `owner/name` and deny every re-request with a 404 that read like a
# refusal. The command itself usually says: an API path carries `repos/O/R/`,
# and `gh` takes `-R`/`--repo`/`GH_REPO=`. Fall through to pr-gate's own
# `gh repo view` when it says nothing.
repo=$(printf '%s' "$cmd" | grep -oE 'repos/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pulls/' |
  head -1 | sed -E 's#^repos/##; s#/pulls/$##')
[ -z "$repo" ] && repo=$(printf '%s' "$cmd" |
  grep -oE '(^|[[:space:]])(-R|--repo)[[:space:]]+[A-Za-z0-9._-]+/[A-Za-z0-9._-]+' |
  head -1 | grep -oE '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')
[ -z "$repo" ] && repo=$(printf '%s' "$cmd" |
  grep -oE 'GH_REPO=[A-Za-z0-9._-]+/[A-Za-z0-9._-]+' | head -1 | sed -E 's#^GH_REPO=##')

if [ -n "$repo" ]; then
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
