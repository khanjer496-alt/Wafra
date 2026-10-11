// Website measurement for Cloudflare Pages Functions. The landing page ships
// no JavaScript and sets no cookies, so counting happens on the server: the
// home page and the download path write one aggregate data point each to
// a Workers Analytics Engine dataset bound as SITE_EVENTS.
//
// A data point holds only coarse labels: the event, its target, the country
// Cloudflare already derives, the referring site's hostname, a campaign tag
// and whether the client looks automated. No IP address, user agent, cookie,
// full URL or other identifier is written. A missing binding records nothing
// and never changes the response.

// Single source for the download destinations behind /get/<platform>. The
// finalizer writes the same map into _redirects for a static-only deploy.
// Android has no public download while the source repository is private, so
// /get/android falls through to the site's 404 page.
export const DOWNLOAD_DESTINATIONS = Object.freeze({
  iphone: 'https://testflight.apple.com/join/jbwzCgZ6',
});

export const SITE_EVENTS_DATASET = 'wafra_site_events';

const AUTOMATED_CLIENT =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|headless|lighthouse|pingdom|uptime|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|httpclient/i;

const label = (value, max) => String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, max);

const campaignOf = (url) => url.searchParams.get('utm_source') ?? url.searchParams.get('ref');

const isPrefetch = (headers) =>
  /prefetch|prerender/i.test(`${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''}`);

export const describeVisit = (request, event, target) => {
  const url = new URL(request.url);
  const userAgent = request.headers.get('user-agent') ?? '';
  let referrer = '';
  let campaign = campaignOf(url);
  try {
    const from = new URL(request.headers.get('referer') ?? '');
    // A download click's referrer is the landing page itself; carry its
    // campaign tag forward instead of recording our own hostname.
    if (from.host === url.host) campaign ??= campaignOf(from);
    else referrer = from.hostname.replace(/^www\./, '');
  } catch {
    // No referrer, or not a URL.
  }
  return {
    event,
    target,
    country: label(request.cf?.country, 2),
    referrer: label(referrer, 64),
    campaign: label(campaign, 40),
    client: !userAgent || AUTOMATED_CLIENT.test(userAgent) ? 'automated' : 'browser',
  };
};

export const recordSiteEvent = (env, request, event, target) => {
  const dataset = env?.SITE_EVENTS;
  if (!dataset || request.method !== 'GET' || isPrefetch(request.headers)) return;
  const visit = describeVisit(request, event, target);
  try {
    dataset.writeDataPoint({
      indexes: [visit.event],
      blobs: [visit.event, visit.target, visit.country, visit.referrer, visit.campaign, visit.client],
      doubles: [1],
    });
  } catch {
    // Measurement must never break the page or a download.
  }
};

/** Redirect a known platform to its download, or return null for next(). */
export const downloadResponse = (env, request, platform) => {
  if (!Object.hasOwn(DOWNLOAD_DESTINATIONS, platform)) return null;
  recordSiteEvent(env, request, 'download', platform);
  return new Response(null, {
    status: 302,
    headers: {
      Location: DOWNLOAD_DESTINATIONS[platform],
      'Cache-Control': 'no-store',
      // Do not pass the landing URL (and any campaign tag) on to the store.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  });
};
