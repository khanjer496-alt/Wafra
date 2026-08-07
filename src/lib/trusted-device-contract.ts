/**
 * Platform-free types and validation for the trusted-device relay surface.
 *
 * Invite links contain only a short-lived, one-use enrollment token and the
 * relay origin. They never contain a ledger row, bank identifier, account
 * number, long-lived device credential, or private key.
 */

export const MAX_TRUSTED_DEVICES = 8;
export const TRUSTED_DEVICE_INVITE_VERSION = 1;

export type TrustedDeviceRole = 'owner' | 'member';

export interface TrustedDevice {
  id: string;
  name: string | null;
  role: TrustedDeviceRole;
  isCurrent: boolean;
  joinedAt: number;
  lastSeenAt: number;
  emailForwardingEnabled: boolean;
}

export interface TrustedDeviceInvite {
  inviteToken: string;
  expiresIn: number;
}

export interface ParsedTrustedDeviceInvite {
  relayUrl: string;
  inviteToken: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,128}$/;

export function validTrustedDeviceName(value: string): boolean {
  const name = value.trim();
  const length = [...name].length;
  return length >= 1 && length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name);
}

export function parseTrustedDevices(value: unknown): TrustedDevice[] | null {
  if (typeof value !== 'object' || value === null || !('devices' in value)) return null;
  const devices = (value as { devices?: unknown }).devices;
  if (!Array.isArray(devices) || devices.length > MAX_TRUSTED_DEVICES) return null;

  const parsed: TrustedDevice[] = [];
  for (const device of devices) {
    if (typeof device !== 'object' || device === null) return null;
    const row = device as Partial<TrustedDevice>;
    if (
      typeof row.id !== 'string' ||
      !UUID_RE.test(row.id) ||
      (row.name !== null && row.name !== undefined &&
        (typeof row.name !== 'string' || !validTrustedDeviceName(row.name))) ||
      (row.role !== 'owner' && row.role !== 'member') ||
      typeof row.isCurrent !== 'boolean' ||
      typeof row.joinedAt !== 'number' ||
      !Number.isFinite(row.joinedAt) ||
      row.joinedAt < 0 ||
      typeof row.lastSeenAt !== 'number' ||
      !Number.isFinite(row.lastSeenAt) ||
      row.lastSeenAt < 0 ||
      typeof row.emailForwardingEnabled !== 'boolean'
    ) {
      return null;
    }
    parsed.push({
      id: row.id,
      name: row.name ?? null,
      role: row.role,
      isCurrent: row.isCurrent,
      joinedAt: row.joinedAt,
      lastSeenAt: row.lastSeenAt,
      emailForwardingEnabled: row.emailForwardingEnabled,
    });
  }
  return parsed;
}

/** A tap-ready enrollment link for the OS share sheet. */
export function trustedDeviceInviteLink(relayUrl: string, inviteToken: string): string {
  if (!TOKEN_RE.test(inviteToken)) throw new Error('Invalid trusted-device invite token');
  return `wafra://trusted-devices?relay=${encodeURIComponent(relayUrl)}&invite=${encodeURIComponent(inviteToken)}`;
}

/**
 * Accepts a Wafra invite link, a versioned JSON code, or a raw token when this
 * build already has a relay origin. Parsing does not trust the origin; the
 * network layer applies its HTTPS/localhost-only URL policy afterwards.
 */
export function parseTrustedDeviceInvite(
  value: string,
  fallbackRelayUrl: string | null,
): ParsedTrustedDeviceInvite | null {
  const input = value.trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    if (url.protocol === 'wafra:' && url.hostname === 'trusted-devices') {
      const relayUrl = url.searchParams.get('relay');
      const inviteToken = url.searchParams.get('invite');
      if (relayUrl && inviteToken && TOKEN_RE.test(inviteToken)) {
        return { relayUrl, inviteToken };
      }
      return null;
    }
  } catch {
    // Not a URL. The versioned JSON and raw-token forms follow.
  }

  try {
    const code = JSON.parse(input) as { v?: unknown; relay?: unknown; invite?: unknown };
    if (
      code?.v === TRUSTED_DEVICE_INVITE_VERSION &&
      typeof code.relay === 'string' &&
      typeof code.invite === 'string' &&
      TOKEN_RE.test(code.invite)
    ) {
      return { relayUrl: code.relay, inviteToken: code.invite };
    }
  } catch {
    // Plain one-use tokens are intentionally supported for nearby handoff.
  }

  if (fallbackRelayUrl && TOKEN_RE.test(input)) {
    return { relayUrl: fallbackRelayUrl, inviteToken: input };
  }
  return null;
}
