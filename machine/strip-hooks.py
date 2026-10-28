#!/usr/bin/env python3
"""Remove the user-scope hook entries that the fwd plugin now provides, leaving every other hook alone.

    strip-hooks.py <settings.json>           remove them
    strip-hooks.py --check <settings.json>   exit 1 if any remain, change nothing

Only hook command fields are read, so a permission rule naming one of these files is left alone.
"""
import json
import sys

# Matched without the config folder's name, which CLAUDE_CONFIG_DIR can change. The plugin's own
# hooks never appear in settings.json, so nothing of the plugin's can match.
PATTERNS = (
    "skills/pr-review/gate-hook.sh",
    "hooks/neon-prod-guard.mjs",
    "hooks/autonomous-guard.mjs",
    "hooks/session-budget.mjs",
)

check = sys.argv[1] == "--check"
path = sys.argv[2] if check else sys.argv[1]
settings = json.load(open(path))
if check:
    stale = [
        h.get("command", "")
        for entries in settings.get("hooks", {}).values()
        for entry in entries
        for h in entry.get("hooks", [])
        if any(p in h.get("command", "") for p in PATTERNS)
    ]
    for command in stale:
        print(f"stale: {command}")
    sys.exit(1 if stale else 0)
removed = 0
for event, entries in list(settings.get("hooks", {}).items()):
    kept_entries = []
    for entry in entries:
        hooks = [h for h in entry.get("hooks", []) if not any(p in h.get("command", "") for p in PATTERNS)]
        removed += len(entry.get("hooks", [])) - len(hooks)
        if hooks:
            kept_entries.append({**entry, "hooks": hooks})
    if kept_entries:
        settings["hooks"][event] = kept_entries
    else:
        del settings["hooks"][event]
json.dump(settings, open(path, "w"), indent=2)
open(path, "a").write("\n")
print(f"removed {removed} hook command(s) now provided by the fwd plugin")
