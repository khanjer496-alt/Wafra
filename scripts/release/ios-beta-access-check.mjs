import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Read-only release access check. Never serialize credentials, raw API errors,
// provisioning material, financial messages, or downloaded application URLs.
const out = 'ios-release-evidence';
mkdirSync(out, { recursive: true });
const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const appId = String(eas.submit?.production?.ios?.ascAppId ?? '');
const report = {
  checkedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA ?? null,
  appId, bundleId: app.ios?.bundleIdentifier,
  projectId: app.extra?.eas?.projectId,
  action: 'read-only; no build, upload, or tester notification',
  expo: { tokenConfigured: Boolean(process.env.EXPO_TOKEN), status: 'not-checked' },
  apple: { apiKeyConfigured: false, status: 'not-checked' },
};
try {
  if (process.env.EXPO_TOKEN) {
    const cli = spawnSync('npx', ['--yes', 'eas-cli@22.4.0', 'build:list', '--platform', 'ios', '--limit', '5', '--json', '--non-interactive'], {
      encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    });
    if (cli.status === 0 && !cli.error) {
      try {
        const builds = JSON.parse(cli.stdout);
        if (!Array.isArray(builds)) throw new Error('invalid-shape');
        report.expo.status = 'authenticated';
        report.expo.builds = builds.map((b) => ({ id: b.id, status: b.status,
          buildNumber: b.appBuildVersion, version: b.appVersion, commit: b.gitCommitHash,
          createdAt: b.createdAt, completedAt: b.completedAt }));
      } catch { report.expo.status = 'unexpected-response'; }
    } else { report.expo.status = 'command-failed'; report.expo.exitCode = cli.status; }
  } else report.expo.status = 'missing-EXPO_TOKEN';

  const raw = process.env.EXPO_ASC_API_KEY_P8 ?? '';
  const kid = process.env.EXPO_ASC_KEY_ID ?? '';
  const iss = process.env.EXPO_ASC_ISSUER_ID ?? '';
  report.apple.apiKeyConfigured = Boolean(raw && kid && iss);
  if (!report.apple.apiKeyConfigured) {
    report.apple.status = raw || kid || iss ? 'incomplete-GitHub-API-key' : 'no-GitHub-API-key-EAS-may-store-its-own';
  } else {
    const pem = raw.includes('BEGIN PRIVATE KEY') ? raw : Buffer.from(raw.replace(/\s/g, ''), 'base64').toString('utf8');
    const key = createPrivateKey(pem);
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = `${b64({ alg: 'ES256', kid, typ: 'JWT' })}.${b64({ iss, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
    const signature = sign('sha256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const token = `${payload}.${signature}`;
    async function get(path) {
      const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { const err = new Error('apple-http-error'); err.status = res.status; throw err; }
      return res.json();
    }
    const builds = await get(`builds?filter[app]=${encodeURIComponent(appId)}&sort=-uploadedDate&limit=5&include=buildBetaDetail`);
    const included = new Map((builds.included ?? []).map((x) => [x.id, x.attributes]));
    report.apple.status = 'authenticated';
    report.apple.builds = builds.data.map((b) => ({ id: b.id, buildNumber: b.attributes.version,
      processingState: b.attributes.processingState, uploadedDate: b.attributes.uploadedDate,
      expired: b.attributes.expired, beta: included.get(b.relationships?.buildBetaDetail?.data?.id) ?? null }));
    const groups = await get(`apps/${appId}/betaGroups?limit=100`);
    report.apple.groups = groups.data.map((g) => ({ id: g.id, name: g.attributes.name,
      internal: g.attributes.isInternalGroup, publicLinkEnabled: g.attributes.publicLinkEnabled,
      publicLink: g.attributes.publicLink ?? null }));
    report.apple.groupsComplete = !groups.links?.next;
    const group = groups.data.find((g) => g.attributes.publicLink === 'https://testflight.apple.com/join/jbwzCgZ6');
    if (group) {
      const members = await get(`betaGroups/${group.id}/builds?limit=100`);
      report.apple.publicBetaBuilds = members.data.map((b) => ({ id: b.id, buildNumber: b.attributes.version, processingState: b.attributes.processingState, expired: b.attributes.expired }));
      report.apple.publicBetaBuildsComplete = !members.links?.next;
    }
  }
} catch (error) {
  report.apple.status = 'check-failed';
  if (Number.isInteger(error.status)) report.apple.httpStatus = error.status;
} finally {
  writeFileSync(`${out}/access.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
