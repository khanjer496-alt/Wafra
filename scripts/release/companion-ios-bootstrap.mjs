#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';

const IDENTIFIER = 'app.companion.productivity';
const BUNDLE_NAME = 'Companion';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outputDirectory = path.resolve(argument('--output-dir', 'ios-release-evidence'));
const csrPath = argument('--csr');
const createSigning = process.argv.includes('--create-signing');
const profileName = argument(
  '--profile-name',
  `Companion App Store ${process.env.GITHUB_RUN_ID || Date.now()}`,
);

const rawKey = process.env.EXPO_ASC_API_KEY_P8 || '';
const keyId = process.env.EXPO_ASC_KEY_ID || '';
const issuerId = process.env.EXPO_ASC_ISSUER_ID || '';
if (!rawKey || !keyId || !issuerId) {
  throw new Error('App Store Connect API credentials are incomplete');
}

const privateKeyPem = rawKey.includes('BEGIN PRIVATE KEY')
  ? rawKey
  : Buffer.from(rawKey.replace(/\s/g, ''), 'base64').toString('utf8');
const privateKey = createPrivateKey(privateKeyPem);
const base64UrlJson = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${base64UrlJson({
    iss: issuerId,
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function request(resource, { method = 'GET', body } = {}) {
  const url = resource.startsWith('https://')
    ? resource
    : `https://api.appstoreconnect.apple.com/v1/${resource}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${new URL(url).pathname}: ${response.status} ${text}`);
  }
  return payload;
}

async function collect(resource) {
  const rows = [];
  let next = resource;
  while (next) {
    const page = await request(next);
    rows.push(...(page?.data || []));
    next = page?.links?.next || null;
  }
  return rows;
}

async function ensureBundleId() {
  const listed = await request(
    `bundleIds?filter[identifier]=${encodeURIComponent(IDENTIFIER)}` +
      '&fields[bundleIds]=name,platform,identifier&limit=10',
  );
  if ((listed.data || []).length > 1) {
    throw new Error(`Apple returned duplicate bundle IDs for ${IDENTIFIER}`);
  }
  if (listed.data?.[0]) {
    return { bundle: listed.data[0], created: false };
  }
  const created = await request('bundleIds', {
    method: 'POST',
    body: {
      data: {
        type: 'bundleIds',
        attributes: {
          identifier: IDENTIFIER,
          name: BUNDLE_NAME,
          platform: 'IOS',
        },
      },
    },
  });
  return { bundle: created.data, created: true };
}

async function ensurePushNotifications(bundleId) {
  const listed = await request(
    `bundleIds/${encodeURIComponent(bundleId)}/bundleIdCapabilities?limit=200`,
  );
  const existing = (listed.data || []).find(
    (entry) => entry.attributes?.capabilityType === 'PUSH_NOTIFICATIONS',
  );
  if (existing) return { capability: existing, created: false };
  const created = await request('bundleIdCapabilities', {
    method: 'POST',
    body: {
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
        relationships: {
          bundleId: {
            data: { type: 'bundleIds', id: bundleId },
          },
        },
      },
    },
  });
  return { capability: created.data, created: true };
}

async function findAppRecord() {
  const apps = await collect(
    'apps?limit=200&fields[apps]=name,bundleId,sku,primaryLocale',
  );
  const matches = apps.filter((entry) => entry.attributes?.bundleId === IDENTIFIER);
  if (matches.length > 1) {
    throw new Error(`Apple returned duplicate app records for ${IDENTIFIER}`);
  }
  return matches[0] || null;
}

async function createCertificateAndProfile(bundleId) {
  if (!csrPath) throw new Error('--csr is required with --create-signing');
  const csrContent = fs.readFileSync(path.resolve(csrPath), 'utf8');
  let certificate = null;
  let profile = null;
  try {
    const certificateResponse = await request('certificates', {
      method: 'POST',
      body: {
        data: {
          type: 'certificates',
          attributes: {
            certificateType: 'IOS_DISTRIBUTION',
            csrContent,
          },
        },
      },
    });
    certificate = certificateResponse.data;
    if (!certificate?.attributes?.certificateContent) {
      throw new Error('Apple created the certificate without certificateContent');
    }

    const profileResponse = await request('profiles', {
      method: 'POST',
      body: {
        data: {
          type: 'profiles',
          attributes: {
            name: profileName,
            profileType: 'IOS_APP_STORE',
          },
          relationships: {
            bundleId: {
              data: { type: 'bundleIds', id: bundleId },
            },
            certificates: {
              data: [{ type: 'certificates', id: certificate.id }],
            },
          },
        },
      },
    });
    profile = profileResponse.data;
    if (!profile?.attributes?.profileContent) {
      throw new Error('Apple created the profile without profileContent');
    }

    fs.writeFileSync(
      path.join(outputDirectory, 'companion-distribution.cer'),
      Buffer.from(certificate.attributes.certificateContent, 'base64'),
    );
    fs.writeFileSync(
      path.join(outputDirectory, 'companion-app-store.mobileprovision'),
      Buffer.from(profile.attributes.profileContent, 'base64'),
    );
    return { certificate, profile };
  } catch (error) {
    if (profile?.id) {
      await request(`profiles/${encodeURIComponent(profile.id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    if (certificate?.id) {
      await request(`certificates/${encodeURIComponent(certificate.id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    throw error;
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
const { bundle, created: bundleCreated } = await ensureBundleId();
const { capability, created: capabilityCreated } = await ensurePushNotifications(
  bundle.id,
);
const appRecord = await findAppRecord();
const signing = createSigning
  ? await createCertificateAndProfile(bundle.id)
  : null;

const report = {
  checkedAt: new Date().toISOString(),
  identifier: IDENTIFIER,
  bundleIdExists: true,
  bundleIdCreated: bundleCreated,
  bundleIdResourceId: bundle.id,
  bundleName: bundle.attributes?.name || BUNDLE_NAME,
  bundlePlatform: bundle.attributes?.platform || 'IOS',
  pushNotificationsEnabled: true,
  pushNotificationsCreated: capabilityCreated,
  pushCapabilityId: capability.id,
  appRecordExists: Boolean(appRecord),
  appId: appRecord?.id || null,
  appName: appRecord?.attributes?.name || null,
  appSku: appRecord?.attributes?.sku || null,
  certificate: signing
    ? {
        id: signing.certificate.id,
        certificateType: signing.certificate.attributes?.certificateType || null,
        serialNumber: signing.certificate.attributes?.serialNumber || null,
        expirationDate: signing.certificate.attributes?.expirationDate || null,
        name: signing.certificate.attributes?.name || null,
      }
    : null,
  profile: signing
    ? {
        id: signing.profile.id,
        name: signing.profile.attributes?.name || profileName,
        profileType: signing.profile.attributes?.profileType || null,
        profileState: signing.profile.attributes?.profileState || null,
        uuid: signing.profile.attributes?.uuid || null,
        expirationDate: signing.profile.attributes?.expirationDate || null,
      }
    : null,
};

fs.writeFileSync(
  path.join(outputDirectory, 'companion-apple-resources.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
