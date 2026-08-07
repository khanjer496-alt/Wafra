import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const databaseId = config.match(/^\s*database_id\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? '';

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)) {
  console.error(
    'Refusing to touch Cloudflare: set [[d1_databases]].database_id in wrangler.toml ' +
      'to the UUID returned by `wrangler d1 create wafra`.',
  );
  process.exit(1);
}
