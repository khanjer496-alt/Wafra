// Configure the Cloudflare Pages project that serves the website, for the
// "Deploy website" workflow. It finds the project by its pages.dev hostname,
// adds the SITE_EVENTS Analytics Engine binding and sets Functions to fail
// open, then prints `project=` and `branch=` lines for the deploy step.
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/pages-site-config.mjs https://wafra-app-azg.pages.dev
//
// Cloudflare does not document whether PATCH merges or replaces
// deployment_configs.production, so the patch re-sends every existing
// production setting with the two changes added, and refuses to run when a
// secret is present (its value cannot be read back to re-send).
import { pathToFileURL } from 'node:url';

import { SITE_EVENTS_DATASET } from '../src/marketing/site-events.mjs';

export const SITE_EVENTS_BINDING = 'SITE_EVENTS';
// Used only when the project has no compatibility date of its own. It must be
// one the deployed runtime supports; Functions need a date to run.
const FALLBACK_COMPATIBILITY_DATE = '2026-08-01';

/** Build the production deployment config to send, or throw if unsafe. */
export const productionPatch = (production = {}) => {
  const envVars = production.env_vars ?? {};
  const secrets = Object.entries(envVars).filter(([, value]) => value?.type === 'secret_text').map(([name]) => name);
  if (secrets.length) {
    throw new Error(`Production has secret variables (${secrets.join(', ')}); add the binding in the dashboard instead.`);
  }
  const existing = production.analytics_engine_datasets?.[SITE_EVENTS_BINDING]?.dataset;
  if (existing && existing !== SITE_EVENTS_DATASET) {
    throw new Error(`${SITE_EVENTS_BINDING} is already bound to dataset ${existing}; refusing to change it.`);
  }
  return {
    ...production,
    compatibility_date: production.compatibility_date || FALLBACK_COMPATIBILITY_DATE,
    analytics_engine_datasets: {
      ...production.analytics_engine_datasets,
      [SITE_EVENTS_BINDING]: { dataset: SITE_EVENTS_DATASET },
    },
    fail_open: true,
  };
};

/** Names of every production setting and binding, to compare before and after. */
export const settingNames = (production = {}) => Object.entries(production).flatMap(([key, value]) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? [key, ...Object.keys(value).map((name) => `${key}.${name}`)]
    : [key]).sort();

const api = async (path, init = {}) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`,
    { ...init, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' } },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const errors = (body.errors ?? []).map((error) => `${error.code}: ${error.message}`).join('; ');
    const hint = response.status === 403 ? ' The API token needs "Cloudflare Pages: Edit".' : '';
    throw new Error(`Cloudflare API ${init.method ?? 'GET'} ${path} failed: HTTP ${response.status} ${errors}.${hint}`);
  }
  return body.result;
};

const main = async () => {
  const host = new URL(process.argv[2] ?? '').hostname;
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  }
  const projects = await api('/pages/projects');
  const matches = projects.filter((project) =>
    project.subdomain === host || (project.domains ?? []).includes(host));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Pages project serving ${host}; found ${matches.length}.`);
  }
  const project = await api(`/pages/projects/${encodeURIComponent(matches[0].name)}`);
  const production = project.deployment_configs?.production ?? {};
  const before = settingNames(production);
  console.error(`Pages project ${project.name}; production branch ${project.production_branch}.`);
  console.error(`Production settings before: ${before.join(', ') || '(none)'}`);

  await api(`/pages/projects/${encodeURIComponent(project.name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ deployment_configs: { production: productionPatch(production) } }),
  });

  const updated = (await api(`/pages/projects/${encodeURIComponent(project.name)}`)).deployment_configs?.production ?? {};
  const after = settingNames(updated);
  const lost = before.filter((name) => !after.includes(name));
  console.error(`Production settings after: ${after.join(', ')}`);
  if (lost.length) throw new Error(`Settings disappeared after the update: ${lost.join(', ')}. Restore them in the dashboard.`);
  if (updated.analytics_engine_datasets?.[SITE_EVENTS_BINDING]?.dataset !== SITE_EVENTS_DATASET || updated.fail_open !== true) {
    throw new Error('The binding or fail-open setting did not apply.');
  }
  console.log(`project=${project.name}`);
  console.log(`branch=${project.production_branch}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
