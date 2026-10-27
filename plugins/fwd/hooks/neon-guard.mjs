// What the Neon guard decides about one Neon MCP call. Pure, so the rule is testable without a
// hook payload; neon-prod-guard.mjs feeds it the call and the protected list from fwd.json.
//
// On a protected branch or endpoint it allows reads only: list/get/describe tools and run_sql
// with a single read statement. A call that names no branch runs against the project's default
// branch, which is production, so a missing branch counts as protected.

// Tools that can swap, move or rewrite a branch whatever their arguments say.
const ALWAYS_BLOCKED = new Set([
  'restore_snapshot',
  'finalize_branch_restore',
  'set_default_branch',
  'delete_project',
]);

const READ_PREFIXES = [
  'list_',
  'get_',
  'describe_',
  'compare_',
  'search',
  'fetch',
  'inspect_',
  'query_logs',
];
// Reads that hand out a secret: a live password, or the secret Realtime tokens are issued with.
// They write it into the transcript, so never on a protected branch.
const READ_EXCEPTIONS = new Set([
  'get_connection_string',
  'get_realtime_secret',
]);

const WRITE_SQL =
  /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|vacuum|reindex|cluster|call|do|lock|refresh|comment|security|reset|discard|into|set\s+(?!local\s+statement_timeout))\b/i;
// A SELECT can still write or act through a function: sequences, settings, backends, large
// objects, files, other databases. Any of these makes the statement not a read.
const SIDE_EFFECT_FN =
  /\b(setval|nextval|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_promote|pg_advisory\w*|pg_try_advisory\w*|pg_read_\w*|pg_write_\w*|pg_file_\w*|lo_\w+|dblink\w*|pg_switch_wal|pg_create_\w*|pg_drop_\w*|pg_replication_\w*|txid_current)\s*\(/i;

// Tools whose branch is optional and defaults to the project's default branch.
const TAKES_BRANCH = new Set([
  'complete_query_tuning',
  'prepare_query_tuning',
  'explain_sql_statement',
  'get_connection_string',
  'describe_table_schema',
  'get_database_tables',
  'describe_branch',
]);

/** null to allow, or the reason to deny. `protectedIds` maps a branch or endpoint id to a label. */
export function neonDecision(tool, args = {}, protectedIds = {}) {
  if (ALWAYS_BLOCKED.has(tool))
    return `${tool} can move or replace a live branch.`;

  // Matched on the fields that name a branch or compute, by id or by name, so a branch passed
  // by name (`main`, `production`) is caught as surely as by its id.
  const named = Object.entries(args)
    .filter(
      ([k, v]) =>
        /branch|endpoint|compute|parent/i.test(k) && typeof v === 'string',
    )
    .map(([, v]) => v.toLowerCase());
  let target = null;
  for (const [id, label] of Object.entries(protectedIds))
    if (named.includes(id.toLowerCase())) target = label;
  const takesBranch =
    'branch_id' in args || tool.startsWith('run_sql') || TAKES_BRANCH.has(tool);
  if (!target && takesBranch && !args.branch_id && !args.endpoint_id)
    target = 'production (no branch named, so the default branch)';
  if (!target && tool === 'create_branch' && !args.parent_id)
    target = 'production (no parent named, so the default branch)';
  if (!target) return null;

  if (READ_EXCEPTIONS.has(tool))
    return `${tool} on ${target} exposes its password.`;
  if (READ_PREFIXES.some((p) => tool.startsWith(p))) return null;
  if (tool === 'explain_sql_statement')
    return args.analyze
      ? `EXPLAIN ANALYZE executes the statement on ${target}.`
      : null;
  if (tool === 'run_sql') {
    // Literals and comments in one pass, leftmost first: stripping comments before literals let
    // a `--` inside a string swallow the rest of the statement, `; drop table` included.
    const sql = String(args.sql ?? '')
      .replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) =>
        m.startsWith("'") ? "''" : ' ',
      )
      .trim();
    const single = !sql.replace(/;\s*$/, '').includes(';');
    if (
      single &&
      /^(select|with|show|explain(?!\s+analyze)|values|table)\b/i.test(sql) &&
      !WRITE_SQL.test(sql) &&
      !SIDE_EFFECT_FN.test(sql)
    )
      return null;
    return `run_sql on ${target} allows one read statement only.`;
  }
  return `${tool} on ${target} is not a read.`;
}
