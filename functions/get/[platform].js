// Cloudflare Pages Function behind the landing page's download buttons:
// count the click, then redirect to the TestFlight link or the APK.
import { downloadResponse } from '../../src/marketing/site-events.mjs';

export const onRequest = (context) => {
  const { request, env, params } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();
  return downloadResponse(env, request, params.platform) ?? context.next();
};
