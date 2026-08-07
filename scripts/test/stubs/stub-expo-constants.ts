/**
 * App config. `expo.extra.relayUrl` is what `configuredRelayUrl()` reads, and
 * a test needs to be able to unset it — a build that has never been pointed at
 * a deployment must refuse to pair rather than guess a hostname.
 */
const Constants: { expoConfig: { extra: Record<string, unknown> } | null } = {
  expoConfig: { extra: { relayUrl: 'https://relay.test' } },
};

export default Constants;
