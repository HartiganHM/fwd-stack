// `gh api --paginate` concatenates one JSON document per page rather than merging them, and
// this `gh` has no `--slurp`. Each page is parsed on its own and the arrays joined, so a list
// endpoint and an object endpoint both come back as an array and callers need not care which
// they asked for. Kept out of pr-gate.mjs so a test can import it (the gate runs on import).

export function parsePages(text) {
  const raw = (text ?? '').trim();
  const pages = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) pages.push(JSON.parse(raw.slice(start, i + 1)));
    }
  }
  return pages.flatMap((page) => (Array.isArray(page) ? page : [page]));
}
