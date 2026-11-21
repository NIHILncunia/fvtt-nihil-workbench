import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('offline pack verifier reports only the registered BaseActor pack', async () => {
  const { stdout } = await executeFile(
    process.execPath,
    [path.join(repositoryRoot, 'scripts', 'verify-compendium-packs.mjs')],
    {
      cwd: repositoryRoot,
      env: { ...process.env, FOUNDRY_APP_PATH: '' },
    },
  );
  const summary = JSON.parse(stdout);

  assert.deepEqual(summary, {
    'common-monsters': {
      documentType: 'Actor',
      documents: 90,
      folders: ['보스', '엘리트', '일반'],
    },
  });
});
