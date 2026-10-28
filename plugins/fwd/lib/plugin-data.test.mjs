// node --test plugin-data.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pluginDataDir } from './plugin-data.mjs';

test('the data folder follows CLAUDE_PLUGIN_DATA, then CLAUDE_CONFIG_DIR, then home', () => {
  assert.equal(pluginDataDir({ CLAUDE_PLUGIN_DATA: '/d' }, '/h'), '/d');
  assert.equal(
    pluginDataDir({ CLAUDE_CONFIG_DIR: '/c' }, '/h'),
    '/c/plugins/data/fwd-fwd-stack',
  );
  assert.equal(
    pluginDataDir({}, '/h'),
    '/h/.claude/plugins/data/fwd-fwd-stack',
  );
});
