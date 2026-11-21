import { createRequire } from 'node:module';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
async function resolveFoundryAppPath() {
  if (process.env.FOUNDRY_APP_PATH) return process.env.FOUNDRY_APP_PATH;
  const candidates = process.platform === 'win32'
    ? ['F:\\FVTT\\FVTT v13.351\\App\\resources\\app']
    : ['/mounts/fvtt/FVTT v13.351/App/resources/app'];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'node_modules', 'classic-level'));
      return candidate;
    } catch {
      // Try the next known runtime mount.
    }
  }
  throw new Error('Foundry application path could not be resolved. Set FOUNDRY_APP_PATH.');
}

let ClassicLevel;
try {
  ({ ClassicLevel } = require('classic-level'));
} catch {
  const foundryAppPath = await resolveFoundryAppPath();
  ({ ClassicLevel } = require(path.join(foundryAppPath, 'node_modules', 'classic-level')));
}

const documentKeyPrefixes = {
  Actor: '!actors!',
  Item: '!items!',
};

const manifest = JSON.parse(
  await readFile(path.join(repositoryRoot, 'module.json'), 'utf8'),
);
const summary = {};

for (const pack of manifest.packs) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ncm-pack-verify-'));
  const tempPackPath = path.join(tempRoot, pack.name);
  await cp(path.join(repositoryRoot, pack.path), tempPackPath, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'LOCK',
  });
  const database = new ClassicLevel(tempPackPath, {
    keyEncoding: 'utf8',
    valueEncoding: 'json',
  });
  const folders = [];
  let documents = 0;

  try {
    await database.open({ readOnly: true });
    for await (const [key, value] of database.iterator()) {
      if (key.startsWith(documentKeyPrefixes[pack.type])) documents += 1;
      if (key.startsWith('!folders!')) folders.push(value.name);
    }
    await database.close();
  } finally {
    if (database.status === 'open') await database.close();
    await rm(tempRoot, { recursive: true, force: true });
  }

  summary[pack.name] = {
    documentType: pack.type,
    documents,
    folders: folders.sort((left, right) => left.localeCompare(right, 'ko')),
  };
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
