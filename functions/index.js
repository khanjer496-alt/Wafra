// Cloudflare Pages Function for the landing page: count the view, then serve
// the static index.html unchanged. See src/marketing/site-events.mjs.
import { recordSiteEvent } from '../src/marketing/site-events.mjs';

export const onRequestGet = (context) => {
  recordSiteEvent(context.env, context.request, 'view', 'home');
  return context.next();
};
