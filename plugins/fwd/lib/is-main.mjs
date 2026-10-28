// Whether a module is the script node was asked to run. Comparing `import.meta.url` with
// `process.argv[1]` directly fails when either path runs through a symlink (an install linked
// into place, such as ~/.claude/fwd): the module then skips its own entry point and prints
// nothing, and a hook reading that silence as "nothing to check" fails open.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
