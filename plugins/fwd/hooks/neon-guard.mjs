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
// get_connection_string writes a live password into the transcript; never on a protected branch.
const READ_EXCEPTIONS = new Set(['get_connection_string']);

const WRITE_SQL =
  /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|vacuum|reindex|cluster|call|do|lock|refresh|comment|security|reset|discard|set\s+(?!local\s+statement_timeout))\b/i;

const TAKES_BRANCH = new Set([
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

  const text = JSON.stringify(args);
  let target = null;
  for (const [id, label] of Object.entries(protectedIds))
    if (text.includes(id)) target = label;
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
    const sql = String(args.sql ?? '')
      .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:''|[^'])*'/g, "''")
      .trim();
    const single = !sql.replace(/;\s*$/, '').includes(';');
    if (
      single &&
      /^(select|with|show|explain(?!\s+analyze)|values|table)\b/i.test(sql) &&
      !WRITE_SQL.test(sql)
    )
      return null;
    return `run_sql on ${target} allows one read statement only.`;
  }
  return `${tool} on ${target} is not a read.`;
}
