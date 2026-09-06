import { mkdirSync, writeFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

// Owner-authorized TestFlight distribution only. Never submit an App Store
// version, change legal declarations, expire old builds, or expose credentials.
const APP = '6799171482';
const BUNDLE = 'app.wafra.ios';
const GROUP = 'c0ee30af-8b26-408c-8ebf-aaa5530fcac7';
const PUBLIC_LINK = 'https://testflight.apple.com/join/jbwzCgZ6';
const version = process.env.WAFRA_BETA_VERSION;
const buildNumber = process.env.WAFRA_BETA_BUILD_NUMBER;
const expectedSource = process.env.WAFRA_BETA_SOURCE_SHA;
const publish = process.argv.includes('--publish');
if (version !== '1.0.0' || !/^\d+$/.test(buildNumber ?? '') || Number(buildNumber) <= 51 || !/^[a-f0-9]{40}$/.test(expectedSource ?? '')) {
  throw new Error('Expected an explicitly identified new Wafra beta build, never latest/old builds');
}
const rawKey = process.env.EXPO_ASC_API_KEY_P8 ?? '';
const kid = process.env.EXPO_ASC_KEY_ID;
const iss = process.env.EXPO_ASC_ISSUER_ID;
if (!rawKey || !kid || !iss) throw new Error('App Store Connect credentials are missing');
const privateKey = createPrivateKey(rawKey.includes('BEGIN PRIVATE KEY') ? rawKey : Buffer.from(rawKey.replace(/\s/g, ''), 'base64').toString('utf8'));
const b64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const report = { checkedAt: new Date().toISOString(), expectedSource, appId: APP, version, buildNumber, requestedPublish: publish, actions: [] };
const dir = 'ios-release-evidence'; mkdirSync(dir, { recursive: true });
const save = () => writeFileSync(`${dir}/public-beta.json`, JSON.stringify(report, null, 2) + '\n');
async function request(path, method = 'GET', body) {
  if (method !== 'GET' && !publish) throw new Error('Write refused in inspect mode');
  const now = Math.floor(Date.now() / 1000);
  const signed = `${b64({ alg: 'ES256', kid, typ: 'JWT' })}.${b64({ iss, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const jwt = `${signed}.${sign('sha256', Buffer.from(signed), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const err = new Error('apple-request-failed'); err.httpStatus = response.status;
    const data = await response.json().catch(() => ({}));
    err.codes = (data.errors ?? []).map((entry) => entry.code).filter((code) => typeof code === 'string');
    throw err;
  }
  return response.status === 204 ? null : response.json();
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function readBuild() {
  const result = await request(`builds?filter[app]=${APP}&filter[version]=${encodeURIComponent(buildNumber)}&include=preReleaseVersion,buildBetaDetail&limit=100`);
  const included = new Map((result.included ?? []).map((entry) => [`${entry.type}:${entry.id}`, entry]));
  const matches = result.data.filter((entry) => {
    const ref = entry.relationships?.preReleaseVersion?.data;
    return ref && included.get(`${ref.type}:${ref.id}`)?.attributes.version === version;
  });
  if (matches.length > 1) throw new Error('ambiguous-build');
  if (!matches.length) return null;
  const build = matches[0];
  const ref = build.relationships?.buildBetaDetail?.data;
  const detail = ref ? included.get(`${ref.type}:${ref.id}`) : null;
  return { build, detail };
}
const notes = `Wafra iOS beta refresh.\n\nPlease test the revised Home and transaction layout, reporting periods, imports, duplicate handling and app responsiveness.\n\nFuture bank SMS: use the Wafra Local Capture Shortcut with a personal Message automation for the bank senders you select. Choose Run Immediately. Wafra keeps the captured message locally and processes the queue when the app opens; setup confirmation is not proof that a real bank alert was captured.\n\nHistory: the included Wafra History Import Shortcut checks two bounded 1,500-message halves and requires their GUID boundaries to overlap. It is intended for up to 2,999 retained messages, not unlimited inbox access. Keep the phone unlocked and Shortcuts open. Larger date-window history experiments are not included.\n\nPlease verify captured amounts/accounts and report missed or duplicated alerts through in-app feedback. Real locked-phone delivery, force-quit/reboot behavior and large-inbox speed still need tester verification. Do not erase existing data to troubleshoot this beta.`;
try {
  const app = await request(`apps/${APP}?fields[apps]=bundleId`);
  if (app.data.attributes.bundleId !== BUNDLE) throw new Error('app-identity-mismatch');
  const group = await request(`betaGroups/${GROUP}?include=app`);
  if (group.data.relationships?.app?.data?.id !== APP || group.data.attributes.isInternalGroup ||
    group.data.attributes.publicLink !== PUBLIC_LINK || !group.data.attributes.publicLinkEnabled) throw new Error('public-group-identity-mismatch');
  report.publicLink = PUBLIC_LINK;
  let found = null;
  for (let attempt = 0; attempt < 46; attempt += 1) {
    found = await readBuild();
    report.build = found ? { id: found.build.id, processingState: found.build.attributes.processingState,
      expired: found.build.attributes.expired, beta: found.detail?.attributes ?? null } : null;
    save();
    if (found?.build.attributes.processingState === 'VALID') break;
    if (found?.build.attributes.processingState === 'INVALID' || found?.build.attributes.processingState === 'FAILED') throw new Error('apple-processing-failed');
    if (!publish || attempt === 45) break;
    await wait(20000);
  }
  if (!found || found.build.attributes.processingState !== 'VALID') {
    report.outcome = 'waiting-for-apple-processing';
  } else if (found.build.attributes.expired) throw new Error('build-expired');
  else if (!publish) report.outcome = 'inspected-only';
  else {
    const id = found.build.id;
    const localizations = await request(`builds/${id}/betaBuildLocalizations?limit=200`);
    if (localizations.links?.next) throw new Error('unexpected-localization-pagination');
    const english = localizations.data.find((entry) => entry.attributes.locale === 'en-US');
    if (english) {
      if (english.attributes.whatsNew !== notes) await request(`betaBuildLocalizations/${english.id}`, 'PATCH', {
        data: { type: 'betaBuildLocalizations', id: english.id, attributes: { whatsNew: notes } },
      });
    } else await request('betaBuildLocalizations', 'POST', {
      data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: notes }, relationships: { build: { data: { type: 'builds', id } } } },
    });
    report.actions.push('set-accurate-test-notes'); save();
    const currentGroups = await request(`builds/${id}/betaGroups?limit=200`);
    if (currentGroups.links?.next) throw new Error('unexpected-group-pagination');
    if (!currentGroups.data.some((entry) => entry.id === GROUP)) {
      await request(`betaGroups/${GROUP}/relationships/builds`, 'POST', { data: [{ type: 'builds', id }] });
      report.actions.push('associated-existing-public-Beta-group'); save();
    }
    const current = await readBuild();
    const external = current.detail?.attributes.externalBuildState;
    if (current.detail && !current.detail.attributes.autoNotifyEnabled) {
      await request(`buildBetaDetails/${current.detail.id}`, 'PATCH', {
        data: { type: 'buildBetaDetails', id: current.detail.id, attributes: { autoNotifyEnabled: true } },
      });
      report.actions.push('enable-testflight-auto-notify'); save();
    }
    if (external === 'READY_FOR_BETA_SUBMISSION') {
      await request('betaAppReviewSubmissions', 'POST', {
        data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id } } } },
      });
      report.actions.push('submitted-for-Beta-App-Review'); save();
    }
    const final = await readBuild();
    const finalGroups = await request(`builds/${id}/betaGroups?limit=200`);
    report.finalExternalState = final.detail?.attributes.externalBuildState ?? null;
    report.inPublicGroup = finalGroups.data.some((entry) => entry.id === GROUP);
    report.outcome = report.inPublicGroup && report.finalExternalState === 'IN_BETA_TESTING'
      ? 'public-beta-testing' : 'associated-awaiting-apple-or-release-state';
  }
} catch (error) {
  report.outcome = 'blocked'; report.failure = error.message;
  if (error.httpStatus) report.httpStatus = error.httpStatus;
  if (error.codes) report.appleErrorCodes = error.codes;
  process.exitCode = 1;
} finally { save(); console.log(JSON.stringify(report, null, 2)); }
