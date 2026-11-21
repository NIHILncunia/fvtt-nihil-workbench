import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('module manifest targets the approved Foundry and D&D5e versions', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'module.json'), 'utf8'),
  );

  // v14 판은 저장소 폴더(nihil-workbench)와 모듈 ID가 다르다. 설치는 GitHub 릴리스 zip으로 한다.
  assert.equal(manifest.id, 'nihil-compendium-module');
  assert.deepEqual(manifest.compatibility, {
    minimum: '14',
    verified: '14.370',
  });
  const repository = 'https://github.com/NIHILncunia/fvtt-nihil-workbench';
  assert.equal(manifest.url, repository);
  assert.equal(manifest.manifest, `${repository}/releases/latest/download/module.json`);
  assert.equal(manifest.download, `${repository}/releases/download/v${manifest.version}/module.zip`);
  assert.equal('system' in manifest, false);
  assert.deepEqual(manifest.esmodules, ['scripts/module.mjs']);
  assert.deepEqual(manifest.relationships.systems, [{
    id: 'dnd5e',
    type: 'system',
    compatibility: {
      minimum: '6.1.0',
      verified: '6.1.1',
      maximum: '6',
    },
  }]);
  assert.deepEqual(manifest.packs, [
    {
      name: 'common-monsters',
      label: 'BaseActor',
      path: 'packs/common-monsters',
      type: 'Actor',
      system: 'dnd5e',
      ownership: {
        PLAYER: 'NONE',
        ASSISTANT: 'OWNER',
      },
    },
  ]);
  assert.deepEqual(manifest.packFolders, [{
    name: 'NCM',
    sorting: 'a',
    packs: ['common-monsters'],
    folders: [],
  }]);
});
