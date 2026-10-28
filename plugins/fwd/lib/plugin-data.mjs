// The plugin's persistent data folder, where state that must survive an update lives.
//
// Claude Code exports CLAUDE_PLUGIN_DATA to hooks, but not to commands Claude runs through Bash,
// so the folder is also derived from its documented name: `<config>/plugins/data/<id>`, where
// <id> is `fwd@fwd-stack` with every character outside [A-Za-z0-9_-] replaced by `-` and
// <config> is CLAUDE_CONFIG_DIR when set, else `~/.claude`. Both sides must agree, or state
// written from Bash is invisible to a hook.
import { homedir } from 'node:os';
import { join } from 'node:path';

export function pluginDataDir(env = process.env, home = homedir()) {
  const config = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  return (
    env.CLAUDE_PLUGIN_DATA || join(config, 'plugins', 'data', 'fwd-fwd-stack')
  );
}
