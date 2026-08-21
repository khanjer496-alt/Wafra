import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const assertSafeSegment = (value, label) => {
  if (!value || value === '.' || value === '..' || path.basename(value) !== value) {
    throw new Error(`${label} is not a safe path segment: ${value}`);
  }
};

const writeJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const writeAppStoreConnectMetadata = async ({ output, metadata, version }) => {
  assertSafeSegment(version, 'App Store version');
  const root = path.join(output, 'apple', 'asc-metadata');

  for (const [locale, entry] of Object.entries(metadata.apple.locales)) {
    assertSafeSegment(locale, 'Apple locale');
    await Promise.all([
      writeJson(path.join(root, 'app-info', `${locale}.json`), {
        name: entry.name,
        subtitle: entry.subtitle,
      }),
      writeJson(path.join(root, 'version', version, `${locale}.json`), {
        description: entry.description,
        keywords: entry.keywords,
        promotionalText: entry.promotionalText,
      }),
    ]);
  }

  return root;
};
