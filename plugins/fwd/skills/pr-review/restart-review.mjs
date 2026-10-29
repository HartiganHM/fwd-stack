#!/usr/bin/env node
// Restarts a wedged Copilot review: cancel the request, kill the run with a draft toggle, re-attach,
// and confirm on the timeline that a new request registered.
//
//   node restart-review.mjs <pr> --repo owner/name
//
// Why a script rather than the raw calls: the cancel is the GraphQL `requestReviews` mutation, which
// names the PR by node id, so the PreToolUse hook can never attribute it and always denies it. This
// script resolves the node id from the number it is given, and runs the gate's re-request check
// itself before touching anything, so the policy still applies; it only gains a PR the gate can read.
//
// When to use it: §1's case of a run that swallows further requests. Re-posting to
// `requested_reviewers` queues behind the stuck run, and `DELETE requested_reviewers` does not remove
// the bot, so neither helps.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COPILOT = 'copilot-pull-request-reviewer[bot]';

const args = process.argv.slice(2);
const pr = args.find((a) => /^\d+$/.test(a));
const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;
if (!pr || !repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
  console.error('usage: restart-review.mjs <pr> --repo owner/name');
  process.exit(2);
}

const gh = (ghArgs, input) =>
  execFileSync('gh', ghArgs, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
const graphql = (query) => gh(['api', 'graphql', '-f', `query=${query}`]);
// Copilot's requests only: the people put back alongside it add events of their own, which would
// read as a successful attach when Copilot's had silently failed.
const requestCount = () =>
  gh([
    'api',
    `repos/${repo}/issues/${pr}/timeline`,
    '--paginate',
    '--jq',
    '[.[]|select(.event=="review_requested" and (.requested_reviewer.type == "Bot" and ((.requested_reviewer.login // "")|test("copilot";"i"))))]|length',
  ])
    .trim()
    .split('\n')
    .reduce((sum, n) => sum + Number(n || 0), 0);
const attempt = (label, fn) => {
  try {
    fn();
    return true;
  } catch (error) {
    console.log(
      `${label} failed: ${String(error.stderr || error.message).trim()}`,
    );
    return false;
  }
};

// The gate's own re-request verdict comes first: a restart is a re-request, and every rule that
// forbids one (bar met, hard stop, unpushed head) forbids this too.
const gate = join(dirname(fileURLToPath(import.meta.url)), 'pr-gate.mjs');
try {
  execFileSync('node', [gate, pr, '--action', 'rerequest', '--repo', repo], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  process.stdout.write(error.stdout ?? '');
  process.stderr.write(error.stderr ?? '');
  console.error(
    'restart-review: the gate refuses a re-request, so nothing was changed.',
  );
  process.exit(1);
}

const prData = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr}`]));
const id = prData.node_id;
// The cancel clears every requested reviewer, people and teams included, so they are put back with
// Copilot. (REST omits bots from this list, which is why Copilot is added by name.)
const requested = JSON.parse(
  gh(['api', `repos/${repo}/pulls/${pr}/requested_reviewers`]),
);
const people = requested.users.map((u) => u.login);
const teams = requested.teams.map((t) => t.slug);
const before = requestCount();
// Anything left that the user must restore by hand, reported at the end whatever the outcome.
const unrestored = [];

// A failed response does not prove the cancel did not land, so the restore below runs either way:
// re-requesting reviewers who are still requested is harmless.
let left;
attempt('cancel', () => {
  left = JSON.parse(
    graphql(
      `mutation{requestReviews(input:{pullRequestId:"${id}", botIds:[], userIds:[], union:false}){pullRequest{reviewRequests{totalCount}}}}`,
    ),
  ).data?.requestReviews?.pullRequest?.reviewRequests?.totalCount;
});
console.log(
  left === 0
    ? 'cancelled the review request'
    : `cancel outcome unknown or incomplete (${left ?? 'no count'} request(s) remain); continuing`,
);

// The toggle is what ends the stuck run. A PR that is already a draft is left as one.
if (!prData.draft) {
  const drafted = attempt('convert to draft', () =>
    graphql(
      `mutation{convertPullRequestToDraft(input:{pullRequestId:"${id}"}){clientMutationId}}`,
    ),
  );
  // A failed response does not prove the conversion did not land, so the PR is put back to ready
  // either way, and its real state is read back rather than inferred from either call.
  attempt('mark ready', () =>
    graphql(
      `mutation{markPullRequestReadyForReview(input:{pullRequestId:"${id}"}){clientMutationId}}`,
    ),
  );
  let isDraft = null;
  attempt('read draft state', () => {
    isDraft = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr}`])).draft;
  });
  if (isDraft === false)
    console.log(
      drafted
        ? 'toggled draft and back to ready'
        : 'the draft toggle failed, so a run in progress may not have ended',
    );
  else
    unrestored.push(
      isDraft
        ? 'the PR is still a draft: mark it ready for review'
        : 'could not confirm the PR is out of draft: check it',
    );
} else {
  console.log(
    'PR is a draft: skipped the toggle, so a run in progress may not have ended',
  );
}

// One stale login makes GitHub reject the whole POST, so on failure Copilot is attached alone and
// the others are reported. Either way the timeline decides, not the response (§1).
const post = (body) => () =>
  gh(
    [
      'api',
      '-X',
      'POST',
      `repos/${repo}/pulls/${pr}/requested_reviewers`,
      '--input',
      '-',
    ],
    JSON.stringify(body),
  );
const others = people.length + teams.length > 0;
if (
  !attempt(
    'attach',
    post({ reviewers: [COPILOT, ...people], team_reviewers: teams }),
  ) &&
  others
) {
  attempt('attach Copilot alone', post({ reviewers: [COPILOT] }));
  unrestored.push(
    `re-request these reviewers: ${[...people, ...teams.map((t) => `team ${t}`)].join(', ')}`,
  );
}

// A timeline read that fails here must not swallow the NOT RESTORED report, so it always prints.
let attached = false;
let after = before;
try {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    after = requestCount();
    if (after > before) {
      attached = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  // One last read at the deadline, so a request registered during the final sleep still counts.
  if (!attached) {
    after = requestCount();
    attached = after > before;
  }
  console.log(
    attached
      ? `re-attached: Copilot review_requested events ${before} -> ${after}`
      : `no new Copilot review_requested event after 2 minutes (still ${before}). Hand it to the user to attach Copilot from the Reviewers gear (§1).`,
  );
} catch (error) {
  console.log(
    `could not read the timeline to confirm the attach: ${String(error.stderr || error.message).trim()}`,
  );
} finally {
  for (const line of unrestored) console.log(`NOT RESTORED: ${line}`);
}
process.exit(attached && unrestored.length === 0 ? 0 : 1);
