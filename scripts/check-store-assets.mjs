import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

const sets = [
  {
    label: 'App Store English 6.9-inch',
    directory: 'docs/store-assets/appstore',
    prefix: 'appstore-6.9-dark-en-',
    count: 8,
    width: 1320,
    height: 2868,
  },
  {
    label: 'App Store Arabic 6.9-inch',
    directory: 'docs/store-assets/appstore',
    prefix: 'appstore-6.9-dark-ar-',
    count: 8,
    width: 1320,
    height: 2868,
  },
  {
    label: 'Google Play Gulf English',
    directory: 'docs/store-assets/play/gulf-en',
    prefix: '',
    count: 8,
    width: 1080,
    height: 1920,
  },
  {
    label: 'Google Play Gulf Arabic',
    directory: 'docs/store-assets/play/gulf-ar',
    prefix: '',
    count: 8,
    width: 1080,
    height: 1920,
  },
];

const errors = [];
const orderedSetHashes = new Map();

const pngInfo = (data) => {
  const signature = data.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || data.length < 26) return null;
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
  };
};

for (const set of sets) {
  const directory = new URL(`${set.directory}/`, root);
  let names = [];
  try {
    names = (await readdir(directory))
      .filter((name) => name.startsWith(set.prefix) && name.endsWith('.png'))
      .sort();
  } catch {
    errors.push(`${set.label}: missing directory ${set.directory}`);
    continue;
  }
  if (names.length !== set.count) {
    errors.push(`${set.label}: expected ${set.count} PNGs, found ${names.length}`);
  }
  const hashes = new Map();
  const orderedHashes = [];
  for (const name of names) {
    const data = await readFile(new URL(name, directory));
    const info = pngInfo(data);
    if (!info) {
      errors.push(`${set.label}/${name}: not a valid PNG`);
      continue;
    }
    if (info.width !== set.width || info.height !== set.height) {
      errors.push(
        `${set.label}/${name}: expected ${set.width}x${set.height}, found ${info.width}x${info.height}`,
      );
    }
    // PNG colour types 4 and 6 contain alpha; App Store and Play launch
    // assets are required to be opaque. Type 2 is true-colour RGB.
    if (info.colorType !== 2) {
      errors.push(`${set.label}/${name}: expected opaque RGB PNG (type 2), found type ${info.colorType}`);
    }
    const hash = createHash('sha256').update(data).digest('hex');
    orderedHashes.push({ name, hash });
    const matches = hashes.get(hash) ?? [];
    matches.push(name);
    hashes.set(hash, matches);
  }
  for (const matches of hashes.values()) {
    if (matches.length > 1) {
      errors.push(`${set.label}: duplicate frames ${matches.join(', ')}`);
    }
  }
  orderedSetHashes.set(set.label, orderedHashes);
}

for (const [englishLabel, arabicLabel] of [
  ['App Store English 6.9-inch', 'App Store Arabic 6.9-inch'],
  ['Google Play Gulf English', 'Google Play Gulf Arabic'],
]) {
  const english = orderedSetHashes.get(englishLabel) ?? [];
  const arabic = orderedSetHashes.get(arabicLabel) ?? [];
  if (english.length !== 8 || arabic.length !== 8) continue;
  english.forEach((frame, index) => {
    if (frame.hash === arabic[index]?.hash) {
      errors.push(
        `${englishLabel}/${frame.name} is byte-identical to ${arabicLabel}/${arabic[index].name}; localized frames must be captured after the language switch`,
      );
    }
  });
}

const graphics = [
  {
    label: 'Google Play Gulf English feature graphic',
    path: 'docs/store-assets/play/gulf-en-feature-graphic.png',
  },
  {
    label: 'Google Play Gulf Arabic feature graphic',
    path: 'docs/store-assets/play/gulf-ar-feature-graphic.png',
  },
];
const graphicHashes = new Map();
for (const graphic of graphics) {
  let data;
  try {
    data = await readFile(new URL(graphic.path, root));
  } catch {
    errors.push(`${graphic.label}: missing ${graphic.path}`);
    continue;
  }
  const info = pngInfo(data);
  if (!info) {
    errors.push(`${graphic.label}: not a valid PNG`);
    continue;
  }
  if (info.width !== 1024 || info.height !== 500) {
    errors.push(`${graphic.label}: expected 1024x500, found ${info.width}x${info.height}`);
  }
  if (info.colorType !== 2) {
    errors.push(`${graphic.label}: expected opaque RGB PNG (type 2), found type ${info.colorType}`);
  }
  const hash = createHash('sha256').update(data).digest('hex');
  const previous = graphicHashes.get(hash);
  if (previous) {
    errors.push(`${graphic.label} is byte-identical to ${previous}; localized graphics must differ`);
  } else {
    graphicHashes.set(hash, graphic.label);
  }
}

if (errors.length > 0) {
  console.error('Store assets are not upload-ready:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Store screenshots and Gulf feature graphics have the required count, dimensions, RGB format, and localized unique assets.');
