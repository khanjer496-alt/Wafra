/**
 * expo-crypto's one job in the relay: 32 bytes of real entropy for the device
 * key. Node's WebCrypto is the same primitive, so this is the real thing rather
 * than a fake — a deterministic stub here would make every "the key is
 * reused / the key is different" assertion meaningless.
 */
export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  return globalThis.crypto.getRandomValues(array as unknown as Uint8Array) as unknown as T;
}
