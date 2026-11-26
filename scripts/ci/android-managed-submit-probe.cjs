#!/usr/bin/env node
'use strict';
// Approval-only probe plan: fixed query on the existing GitHub runner.
// No login, mutation, credential download, permission change or submission.
const QUERY = `query WafraAndroidManagedSubmissionPresence($appId: String!) {
  meActor { id }
  app { byId(appId: $appId) {
    id
    androidAppCredentials(filter: { applicationIdentifier: "app.wafra.android" }) {
      applicationIdentifier
      googleServiceAccountKeyForSubmissions { id }
    }
  } }
}`;
const PROJECT = 'fa920e7b-c661-4517-917d-26e8b4878721';
async function probe(token, request = fetch) {
  const result = {tokenConfigured: Boolean(token), httpOk: false, authenticated: false,
    projectMatches: false, applicationMatches: false, submissionCredentialAssigned: false,
    trackPermissionsProven: false, mutationAttempted: false};
  if (!token) return result;
  try {
    const response = await request('https://api.expo.dev/graphql', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({query: QUERY, variables: {appId: PROJECT}}),
    });
    result.httpOk = response.ok;
    if (!response.ok) return result;
    // Bounded metadata response, no credential-material fields are requested.
    let text = ''; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16384) return result;
      text += Buffer.from(chunk).toString('utf8');
    }
    const body = JSON.parse(text);
    if (body.errors?.length) return result;
    result.authenticated = Boolean(body.data?.meActor?.id);
    const app = body.data?.app?.byId;
    result.projectMatches = result.authenticated && app?.id === PROJECT;
    const rows = Array.isArray(app?.androidAppCredentials) ? app.androidAppCredentials : [];
    const selected = rows.filter(row => row.applicationIdentifier === 'app.wafra.android');
    result.applicationMatches = result.projectMatches && selected.length === 1;
    result.submissionCredentialAssigned = result.applicationMatches && Boolean(selected[0].googleServiceAccountKeyForSubmissions?.id);
  } catch {} // Never emit provider bodies, errors, token, ids, emails or key material.
  return result;
}
if (require.main === module) probe(process.env.EXPO_TOKEN).then(r => console.log(JSON.stringify(r)));
module.exports = {QUERY, PROJECT, probe};
