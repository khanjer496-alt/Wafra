const PATH = '/v1/access/complimentary';
const json = (body, status) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
async function matches(code, expected) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  let diff = 0;
  for (let i = 0; i < bytes.length; i++) diff |= bytes[i] ^ parseInt(expected.slice(i * 2, i * 2 + 2), 16);
  return diff === 0;
}
// At the HTTP boundary workerd can expose an empty POST as a non-null stream.
// Probe only for EOF: never buffer a body, and don't wait on a stalled sender.
async function isEmptyEntity(request) {
  const length = request.headers.get('content-length');
  if (length !== null && !/^0+$/.test(length)) return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let eof = false;
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); });
  try {
    for (let i = 0; i < 4; i++) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (!chunk) return false;
      if (chunk.done) { eof = true; return true; }
      if (chunk.value.byteLength > 0) return false;
    }
    return false;
  } finally {
    clearTimeout(timer);
    if (!eof) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return json({ error: 'not_found' }, 404);
    const denied = () => json({ error: 'access_denied' }, 403);
    if (url.protocol !== 'https:' || request.method !== 'POST' || url.search) return denied();
    if (!env.ACCESS_RATE_LIMITER) return denied();
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    const digest = env.COMPLIMENTARY_ACCESS_SHA256;
    try {
      const valid = !!token && typeof digest === 'string' && digest.length === 64 &&
        /^[a-f0-9]{64}$/.test(digest) && await matches(token, digest);
      // Two constant counters per location, with no visitor identity. Invalid attempts
      // cannot exhaust the capacity allocated to a holder of a valid credential.
      const limit = await env.ACCESS_RATE_LIMITER.limit({ key: PATH + (valid ? ':authorized' : ':anonymous') });
      if (limit.success !== true || !valid || !(await isEmptyEntity(request))) return denied();
      return json({ entitlement: 'pro', leaseSeconds: 900 }, 200);
    } catch { return denied(); }
  },
};
