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
// A SELECT can still write or act through a function: sequences, settings, notifications,
// backends, files, or any function an application defines. No list of bad functions is complete,
// so this is a list of good ones: every `name(` in the statement must be a read-only builtin or a
// keyword that takes parentheses. Anything else is denied, schema-qualified or not.
const READ_CALLS = new Set(
  // keywords followed by a parenthesis
  (
    'select with as from join on using where and or not in exists any all some values over ' +
    'filter within partition by lateral cast row array case when then else ' +
    // aggregates and window functions
    'count sum avg min max bool_and bool_or every array_agg string_agg json_agg jsonb_agg ' +
    'json_object_agg jsonb_object_agg percentile_cont percentile_disc mode stddev variance ' +
    'row_number rank dense_rank ntile lag lead first_value last_value nth_value ' +
    // scalar
    'coalesce nullif greatest least abs round ceil ceiling floor trunc mod power sqrt ' +
    'lower upper length char_length octet_length substring substr position trim btrim ltrim ' +
    'rtrim replace split_part concat concat_ws left right lpad rpad format to_char to_date ' +
    'to_timestamp to_number now current_date current_timestamp date_trunc date_part extract ' +
    'age interval make_interval generate_series unnest array_length cardinality ' +
    'json_build_object jsonb_build_object json_build_array jsonb_build_array to_json to_jsonb ' +
    'jsonb_array_length jsonb_typeof jsonb_extract_path_text pg_size_pretty ' +
    'pg_total_relation_size pg_relation_size pg_database_size pg_column_size ' +
    // session and recovery state
    'current_setting pg_is_in_recovery'
  ).split(' '),
);
// The whole identifier is checked, schema included: `app.lower(` is an application function that
// merely ends in a builtin's name. Only `pg_catalog.` may qualify a call. Any non-ASCII outside a
// literal is denied first, so `élower(` cannot pass as `lower(`.
const callsOnlyReads = (sql) =>
  !/[^\p{ASCII}]/u.test(sql) &&
  // `app . lower(` is `app.lower(` to PostgreSQL: close the gaps around a dot before reading names.
  [...sql.replace(/\s*\.\s*/g, '.').matchAll(/([\w.]+)\s*\(/g)].every(
    ([, name]) =>
      READ_CALLS.has(name.toLowerCase().replace(/^pg_catalog\./, '')),
  );

// Tools whose branch is optional and defaults to the project's default branch.
const TAKES_BRANCH = new Set([
  'complete_query_tuning',
  'prepare_query_tuning',
  'explain_sql_statement',
  'get_connection_string',
  'describe_table_schema',
  'get_database_tables',
  'describe_branch',
  'get_realtime_secret',
]);

/**
 * null to allow, or the reason to deny. `protectedIds` maps a branch or endpoint id to a label.
 * `readOnlyCompute` maps a protected branch id to a read-only compute (a read replica) on it.
 * run_sql on a mapped branch must name that branch and run on that compute: the text checks below
 * are strict, but only a compute that cannot write makes a read read-only in the database. (A
 * read-only role cannot do this on Neon: roles made through its API or MCP inherit
 * pg_write_all_data from neon_superuser.)
 */
export function neonDecision(
  tool,
  args = {},
  protectedIds = {},
  { readOnlyCompute = {} } = {},
) {
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
    // By key: a project mapping a machine's id to a falsy label must not switch its guard off.
    if (named.includes(id.toLowerCase()))
      target = typeof label === 'string' && label ? label : id;
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
    const computes = Object.entries(readOnlyCompute);
    if (computes.length) {
      const branch = String(args.branch_id ?? '').toLowerCase();
      const compute = computes.find(([b]) => b.toLowerCase() === branch)?.[1];
      // A call naming no branch runs on the default branch, which may be mapped: make it say so.
      if (!args.branch_id)
        return `run_sql on ${target} must name its branch_id, so its read-only compute can be checked.`;
      if (compute && args.compute_id !== compute)
        return `run_sql on ${target} must run on its read-only compute: pass compute_id "${compute}".`;
    }
    const raw = String(args.sql ?? '');
    // Fail closed on syntax this guard does not parse: a quoted identifier (`"setval"(…)` slips the
    // function list), a dollar-quoted body (`$$--$$` reads as a comment and hides what follows), a
    // block comment (they nest in PostgreSQL), or a backslash (E'' escapes). A read on a protected
    // branch never needs them, and a tokenizer for all of them is a second SQL parser.
    if (/["$\\]|\/\*/.test(raw))
      return `run_sql on ${target} uses quoting or comments the guard cannot read; write the read without them.`;
    // Literals and line comments in one pass, leftmost first: stripping comments before literals
    // let a `--` inside a string swallow the rest of the statement, `; drop table` included.
    const sql = raw
      // PostgreSQL ends a line comment at CR as well as LF.
      .replace(/'(?:''|[^'])*'|--[^\r\n]*/g, (m) =>
        m.startsWith("'") ? "''" : ' ',
      )
      .trim();
    const single = !sql.replace(/;\s*$/, '').includes(';');
    if (
      single &&
      /^(select|with|show|explain(?!\s+analyze)|values|table)\b/i.test(sql) &&
      // `FOR SHARE` / `FOR KEY SHARE` take row locks; `FOR UPDATE` is caught as a write already.
      !/\bshare\b/i.test(sql) &&
      !WRITE_SQL.test(sql) &&
      callsOnlyReads(sql)
    )
      return null;
    return `run_sql on ${target} allows one read statement only.`;
  }
  return `${tool} on ${target} is not a read.`;
}
