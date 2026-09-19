/** Runs only in a fresh privileged job, from the exact trusted baseline.
 * Candidate contents are JSON data passed to GitHub's tree API. They are never
 * checked out, imported, installed, applied, or executed on this runner.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateManifest, readManifest, manifestDigest } from './feedback-candidate.mjs';
import { assertNoVerbatim } from './feedback-no-verbatim.mjs';
import { fetchFeedbackItem, validateFeedbackItem } from './feedback-input.mjs';

export async function publishCandidate(value, item, options) {
  const { root, baseSha, feedbackId, runId, attempt, request } = options;
  validateManifest(value, { root, baseSha, feedbackId });
  await validateFeedbackItem(item, feedbackId);
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt)) throw new Error('Invalid run identity.');
  assertNoVerbatim(item, [value.summary, ...value.files.map(file => file.content)].join('\n'));
  const current = await request('GET', '/git/ref/heads/main');
  if (current.object?.sha !== baseSha) throw new Error('Main changed; rerun against the current baseline.');
  const base = await request('GET', `/git/commits/${baseSha}`);
  if (!/^[a-f0-9]{40}$/.test(base.tree?.sha ?? '')) throw new Error('Invalid base tree.');
  const tree = await request('POST', '/git/trees', {
    base_tree: base.tree.sha,
    tree: value.files.map(file => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
  });
  const commit = await request('POST', '/git/commits', {
    message: `fix: parser feedback ${feedbackId}\n\nDraft generated change; requires human review.`,
    tree: tree.sha, parents: [baseSha],
  });
  const branch = `feedback/${feedbackId}-${runId}-${attempt}`;
  // Unique per attempt. Never update or force-push an existing remote branch.
  await request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
  const body = `Parser research from ${item.platform} ${item.appVersion}, locale ${item.locale || 'unknown'}.

Feedback id: ${feedbackId}. The consented diagnostic remains in the relay for its original 14-day retention period.

${value.summary}

### Automated checks

- The proposed test change failed against the baseline; the full change passed the suite in a separate offline container.
- The candidate was restricted to existing source and test files. Workflow, dependency, and test-runner changes were rejected.
- The trusted copy scanner detected no matching report or diagnostic template text. This is a best-effort text check, not a guarantee against paraphrasing or encoding.

### Human review required

Review the reproduction, the test assertions, and every source change. A failing/passing suite alone cannot establish that agent-written tests are honest or that the change is correct. This draft is never merged automatically.

Created with GITHUB_TOKEN: CI may require a human close/reopen or push to start.
`;
  try {
    const result = await request('POST', '/pulls', {
      title: `Feedback: ${item.platform} ${item.appVersion} parser issue`,
      body, head: branch, base: 'main', draft: true,
    });
    return { url: result.html_url, branch };
  } catch {
    // No candidate prose or API response body goes into a public failure log.
    throw new Error(`Draft PR creation failed; the checked branch remains at ${branch}.`);
  }
}

export function githubRequest({ repository, token, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository ?? '') || !token) {
    throw new Error('Invalid publication configuration.');
  }
  return async (method, route, body) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${route}`, {
      method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
        'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
    return response.json();
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = { root: process.cwd(), baseSha: process.env.GITHUB_SHA, feedbackId: process.env.FEEDBACK_ID };
    const value = readManifest(process.argv[2], options);
    if (!/^[a-f0-9]{64}$/.test(process.env.VALIDATED_DIGEST ?? '') ||
        await manifestDigest(value) !== process.env.VALIDATED_DIGEST) throw new Error('Candidate differs from validated input.');
    // Re-fetch on this clean runner. The generator never supplies the input
    // against which its own changes will be scanned.
    const item = await fetchFeedbackItem({ relayUrl: process.env.RELAY_URL,
      token: process.env.FEEDBACK_READ_TOKEN, feedbackId: options.feedbackId });
    const result = await publishCandidate(value, item, { ...options, runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      request: githubRequest({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }) });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Draft pull request: ${result.url}\n`);
  } catch (error) {
    // Only trusted static errors; no raw file/JSON/HTTP response errors.
    const safe = /^Draft PR creation failed; the checked branch remains at feedback\/[a-f0-9-]+-\d+-\d+\.$/.test(error.message)
      ? error.message : 'Feedback publication refused. Verify current main, the candidate checks, consent, relay access, and repository PR permissions.';
    console.error(`::error::${safe}`);
    process.exitCode = 1;
  }
}
