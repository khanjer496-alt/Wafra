// Report homepage views and download clicks. Reads the Analytics Engine dataset that the Pages
// Functions write (see src/marketing/site-events.mjs and
// docs/seo-geo-audit.md#measuring-visits-and-downloads).
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/site-funnel.mjs [days]
//
// The token needs only "Account Analytics: Read". TestFlight installs are not
// visible here; App Store Connect reports them for the public link.
import { pathToFileURL } from 'node:url';

import { SITE_EVENTS_DATASET } from '../src/marketing/site-events.mjs';

export const funnelQuery = (days) => `SELECT blob1 AS event, blob2 AS target, blob3 AS country,
  blob4 AS referrer, blob5 AS campaign, blob6 AS client, SUM(_sample_interval) AS hits
FROM ${SITE_EVENTS_DATASET}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
GROUP BY event, target, country, referrer, campaign, client
FORMAT JSON`;

const top = (counts, limit = 5) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
const add = (map, key, hits) => map.set(key || '(none)', (map.get(key || '(none)') ?? 0) + hits);

/** Aggregate Analytics Engine rows into the funnel. Automated clients are excluded. */
export const summarizeFunnel = (rows) => {
  const result = { views: 0, iphone: 0, googlePlay: 0, legacyAndroid: 0, automated: 0, campaigns: new Map(), comparisonClicks: new Map(), referrers: new Map(), countries: new Map() };
  for (const row of rows) {
    const hits = Number(row.hits) || 0;
    if (row.client !== 'browser') { result.automated += hits; continue; }
    if (row.event === 'view') {
      result.views += hits;
      add(result.referrers, row.referrer, hits);
      add(result.countries, row.country?.toUpperCase(), hits);
    } else if (row.event === 'download') {
      if (row.target === 'iphone') result.iphone += hits;
      else if (row.target === 'android') result.legacyAndroid += hits;
      else if (row.target === 'google-play') {
        result.googlePlay += hits;
        if (row.campaign?.startsWith('compare-')) add(result.comparisonClicks, row.campaign, hits);
      } else continue;
    } else {
      continue;
    }
    add(result.campaigns, row.campaign, hits);
  }
  return result;
};

export const renderFunnel = (summary, days) => {
  const clicks = summary.iphone + summary.googlePlay;
  const lines = [
    `Wafra website, last ${days} days (browsers only; ${summary.automated} automated requests excluded)`,
    '',
    `  Landing views        ${summary.views}`,
    `  Download clicks      ${clicks}`,
    `    iPhone/TestFlight  ${summary.iphone}`,
    `    Android/Google Play ${summary.googlePlay}`,
    `  Comparison pages (Google Play clicks): ${top(summary.comparisonClicks).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    '',
    `  Top sources (campaign tag, views + clicks): ${top(summary.campaigns).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `  Top referring sites (views): ${top(summary.referrers).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `  Top countries (views): ${top(summary.countries).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    ...(summary.legacyAndroid ? [`  Legacy Android download clicks: ${summary.legacyAndroid}`] : []),
    '',
    '  Install counts: Google Play Console and App Store Connect.',
  ];
  return lines.join('\n');
};

const main = async () => {
  const days = Number(process.argv[2] ?? 30);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('days must be a whole number from 1 to 90.');
  if (!account || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read).');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: funnelQuery(days),
  });
  if (!response.ok) throw new Error(`Analytics Engine query failed: HTTP ${response.status} ${await response.text()}`);
  const { data = [] } = await response.json();
  console.log(renderFunnel(summarizeFunnel(data), days));
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
