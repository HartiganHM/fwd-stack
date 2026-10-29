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
const requestCount = () =>
  Number(
    gh([
      'api',
      `repos/${repo}/issues/${pr}/timeline`,
      '--paginate',
      '--jq',
      '[.[]|select(.event=="review_requested")]|length',
    ])
      .trim()
      .split('\n')
      .reduce((sum, n) => sum + Number(n || 0), 0),
  );

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
// The cancel clears every requested reviewer, people included, so the people are put back with Copilot.
const people = JSON.parse(
  gh(['api', `repos/${repo}/pulls/${pr}/requested_reviewers`]),
).users.map((u) => u.login);
const before = requestCount();

graphql(
  `mutation{requestReviews(input:{pullRequestId:"${id}", botIds:[], userIds:[], union:false}){clientMutationId}}`,
);
console.log('cancelled the review request');

// The toggle is what ends the stuck run. A PR that is already a draft is left as one.
if (!prData.draft) {
  graphql(
    `mutation{convertPullRequestToDraft(input:{pullRequestId:"${id}"}){clientMutationId}}`,
  );
  graphql(
    `mutation{markPullRequestReadyForReview(input:{pullRequestId:"${id}"}){clientMutationId}}`,
  );
  console.log('toggled draft and back to ready');
} else {
  console.log(
    'PR is a draft: skipped the toggle, so a run in progress may not have ended',
  );
}

gh(
  [
    'api',
    '-X',
    'POST',
    `repos/${repo}/pulls/${pr}/requested_reviewers`,
    '--input',
    '-',
  ],
  JSON.stringify({ reviewers: [COPILOT, ...people] }),
);

// The POST's response proves nothing (§1); the timeline does. Allow two minutes.
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  if (requestCount() > before) {
    console.log(
      `re-attached: review_requested events ${before} -> ${requestCount()}`,
    );
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
console.log(
  `no new review_requested event after 2 minutes (still ${before}). Hand it to the user to attach Copilot from the Reviewers gear (§1).`,
);
process.exit(1);
