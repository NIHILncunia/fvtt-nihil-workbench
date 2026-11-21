import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const coreModulePath = path.join(
  repositoryRoot,
  'scripts',
  'statblock-importer',
  'core.mjs',
);

async function loadCore() {
  return import(pathToFileURL(coreModulePath).href);
}

async function loadService() {
  const servicePath = path.join(
    repositoryRoot,
    'scripts',
    'statblock-importer',
    'service.mjs',
  );
  const url = pathToFileURL(servicePath);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('module exposes the statblock importer entry module', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'module.json'), 'utf8'),
  );

  assert.deepEqual(manifest.esmodules, ['scripts/module.mjs']);
  await readFile(path.join(repositoryRoot, 'scripts', 'module.mjs'), 'utf8');
});

test(
  'SBI localization recovery reuses the already-created NPC and does not import again',
  async () => {
  const { importLocalizedStatblock, resumeStatblockLocalization } = await loadService();
  let imports = 0;
  let fail = true;
  const owner = {
    id: 'created-npc', type: 'npc', name: 'Bear', isOwner: true, folder: null, items: [],
    async update(update) {
      if (fail) throw new Error('일시적인 저장 실패');
      this.name = update.name ?? this.name;
      return this;
    },
  };
  const sbi = { api: {
    parse: () => ({ actor: { name: 'Bear' } }),
    import: async () => { imports++; return { actor5e: owner, importIssues: ['확인'] }; },
  } };
  let recovery;
  try {
    await importLocalizedStatblock(
      { rawPayload: '===STATBLOCK===\nBear\n===LOCALIZATION===\n{"actorName":"곰"}' },
      sbi
    );
    assert.fail('the failed localization must report recovery');
  } catch (error) {
    assert.equal(
      error.actor5e,
      owner
    );
    recovery = error.recovery;
  }
  const previousGame = globalThis.game;
  globalThis.game = { actors: new Map([[owner.id, owner]]) };
  try {
    fail = false;
    const result = await resumeStatblockLocalization(recovery);
    assert.equal(
      imports,
      1
    );
    assert.equal(
      result.actor5e.name,
      '곰'
    );
    assert.deepEqual(
      result.importIssues,
      ['확인']
    );
  } finally { globalThis.game = previousGame; }
}
);

test('parseImportPackage reads statblock and fenced localization JSON', async () => {
  const { parseImportPackage } = await loadCore();
  const result = parseImportPackage(`
===STATBLOCK===
Ash Drake
Medium dragon
===LOCALIZATION===
\`\`\`json
{
  "actorName": "재빛 드레이크",
  "items": {
    "Bite": {
      "name": "물기",
      "description": "대상을 물어뜯는다."
    }
  }
}
\`\`\`
`);

  assert.equal(result.statblock, 'Ash Drake\nMedium dragon');
  assert.equal(result.localization.actorName, '재빛 드레이크');
  assert.equal(result.localization.items.Bite.name, '물기');
});

test('parseImportPackage rejects malformed localization payloads', async () => {
  const { parseImportPackage } = await loadCore();

  assert.throws(
    () => parseImportPackage('===LOCALIZATION===\n{}'),
    /===STATBLOCK===/,
  );
  assert.throws(
    () => parseImportPackage('===STATBLOCK===\nX\n===LOCALIZATION===\n{"items": []}'),
    /LOCALIZATION\.items는 객체/,
  );
});

test('SBI service validates before creation and localizes only Actor and embedded Item names or descriptions', async () => {
  const { importLocalizedStatblock, validateStatblockImport } = await loadService();
  const calls = [];
  const item = {
    id: 'bite-id',
    name: 'Bite',
    system: { description: { value: 'Bites fiercely.' } },
  };
  const actor = {
    name: 'Ash Drake',
    folder: { id: 'npc-folder' },
    items: [item],
    async update(update) { calls.push(['actor.update', update]); return this; },
    async updateEmbeddedDocuments(type, updates) { calls.push(['embedded.update', type, updates]); return updates; },
  };
  const sbi = {
    api: {
      parse(statblock) {
        calls.push(['parse', statblock]);
        return { actor: { name: 'Ash Drake' } };
      },
      async import(statblock, folderId) {
        calls.push(['import', statblock, folderId]);
        return { actor5e: actor, importIssues: { warning: 'test warning' } };
      },
    },
  };
  const payload = `===STATBLOCK===\nAsh Drake\n===LOCALIZATION===\n{"actorName":"재빛 드레이크","items":{"Bite":{"name":"물기","description":"물어뜯는다."}}}`;

  const validation = validateStatblockImport(payload, sbi);
  assert.equal(validation.preview.name, 'Ash Drake');
  assert.deepEqual(calls, [['parse', 'Ash Drake']]);

  const result = await importLocalizedStatblock({ rawPayload: payload, folderId: 'npc-folder' }, sbi);
  assert.equal(result.actor5e, actor);
  assert.deepEqual(calls, [
    ['parse', 'Ash Drake'],
    ['parse', 'Ash Drake'],
    ['import', 'Ash Drake', 'npc-folder'],
    ['actor.update', { name: '재빛 드레이크', 'prototypeToken.name': '재빛 드레이크' }],
    ['embedded.update', 'Item', [{
      _id: 'bite-id',
      name: '물기',
      'system.description.value': '<p>물어뜯는다.</p>',
    }]],
  ]);
});

test('localization plan renames items, converts descriptions, and relinks item references', async () => {
  const { createLocalizationPlan } = await loadCore();
  const items = [
    {
      id: 'bite-id',
      name: 'Bite',
      system: { description: { value: 'See [[/item Fiery Blood]].' } },
    },
    {
      id: 'blood-id',
      name: 'Fiery Blood',
      system: { description: { value: '' } },
    },
  ];
  const localization = {
    items: {
      Bite: {
        name: '물기',
        description: '불타는 이빨로 공격한다.\n추가 효과가 있다.',
      },
      'Fiery Blood': {
        name: '타오르는 피',
        description: '<p>화염을 내뿜는다.</p>',
      },
      Missing: {
        name: '없는 특성',
        description: '매칭되지 않아야 한다.',
      },
    },
  };

  const result = createLocalizationPlan(items, localization);

  assert.deepEqual(result.itemUpdates, [
    {
      _id: 'bite-id',
      name: '물기',
      'system.description.value': '<p>불타는 이빨로 공격한다.<br>추가 효과가 있다.</p>',
    },
    {
      _id: 'blood-id',
      name: '타오르는 피',
      'system.description.value': '<p>화염을 내뿜는다.</p>',
    },
  ]);
  assert.deepEqual(result.unmatched, ['Missing']);
});

test('relinkItemReferences preserves Foundry item references after translation', async () => {
  const { relinkItemReferences } = await loadCore();
  const translations = new Map([
    ['Fiery Blood', { name: '타오르는 피', description: null }],
  ]);

  assert.equal(
    relinkItemReferences('See [[/item Fiery Blood]] now.', translations),
    'See [[/item 타오르는 피]] now.',
  );
});

test(
  'SBI recovery recognizes already-localized Items and avoids ambiguous translated names',
  async () => {
  const { createLocalizationPlan } = await loadCore();
  const result = createLocalizationPlan(
    [{ id: 'bite', name: '물기', system: { description: { value: '<p>공격</p>' } } }],
    {
    items: { Bite: { name: '물기', description: '<p>공격</p>' } },
  }
  );
  assert.deepEqual(
    result.itemUpdates,
    []
  );
  assert.deepEqual(
    result.unmatched,
    []
  );
  const ambiguous = createLocalizationPlan(
    [{ id: 'bite', name: '물기' }],
    {
    items: { Bite: { name: '물기' }, Chomp: { name: '물기' } },
  }
  );
  assert.deepEqual(
    ambiguous.unmatched,
    ['Bite', 'Chomp']
  );
}
);

test('module entry registers importer API immediately when game.modules is available', async () => {
  const modulePackage = { api: {} };
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;

  globalThis.game = {
    modules: new Map([['nihil-compendium-module', modulePackage]]),
  };
  globalThis.Hooks = {
    once() {},
  };

  try {
    const entryUrl = new URL('../scripts/module.mjs', import.meta.url);
    entryUrl.searchParams.set('test', `${Date.now()}-${Math.random()}`);
    await import(entryUrl.href);
    assert.equal(typeof modulePackage.api.openStatblockImporter, 'function');
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});

test('statblock importer launcher opens the NPC SBI creation state inside Actor Workbench', async () => {
  const previousGame = globalThis.game;
  const calls = [];
  globalThis.game = {
    modules: new Map([['nihil-compendium-module', {
      api: {
        openActorWorkbench(options) {
          calls.push(options);
          return 'actor-workbench';
        },
      },
    }]]),
  };

  try {
    const url = new URL('../scripts/statblock-importer/importer.mjs', import.meta.url);
    url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
    const { openStatblockImporter } = await import(url.href);
    assert.equal(openStatblockImporter(), 'actor-workbench');
    assert.deepEqual(calls, [{ activeType: 'npc', creationMode: 'sbi' }]);
  } finally {
    globalThis.game = previousGame;
  }
});


test('localization plan applies built-in Korean names to SBI structural items without marking them unmatched', async () => {
  const { createLocalizationPlan } = await loadCore();
  const items = [
    { id: 'legendary', name: 'Legendary Actions', system: { description: { value: '<p>Keep legendary description.</p>' } } },
    { id: 'lair', name: 'Lair Actions', system: { description: { value: '<p>Keep lair description.</p>' } } },
    { id: 'mythic', name: 'Mythic Actions', system: { description: { value: '<p>Keep mythic description.</p>' } } },
    { id: 'villain', name: 'Villain Actions', system: { description: { value: '<p>Keep villain description.</p>' } } },
  ];

  const result = createLocalizationPlan(items, { items: {} });

  assert.deepEqual(result.itemUpdates, [
    { _id: 'legendary', name: '전설적 행동' },
    { _id: 'lair', name: '소굴 행동' },
    { _id: 'mythic', name: '신화적 행동' },
    { _id: 'villain', name: '악당 행동' },
  ]);
  assert.deepEqual(result.unmatched, []);
});

test('user localization overrides built-in structural item names and descriptions', async () => {
  const { createLocalizationPlan } = await loadCore();
  const items = [
    { id: 'legendary', name: 'Legendary Actions', system: { description: { value: '<p>Original.</p>' } } },
  ];

  const result = createLocalizationPlan(items, {
    items: {
      'Legendary Actions': {
        name: '전설 행동 묶음',
        description: '사용자 지정 설명',
      },
    },
  });

  assert.deepEqual(result.itemUpdates, [
    {
      _id: 'legendary',
      name: '전설 행동 묶음',
      'system.description.value': '<p>사용자 지정 설명</p>',
    },
  ]);
  assert.deepEqual(result.unmatched, []);
});

test(
  'SBI service corrects an importer result that was created at root despite the requested folder',
  async () => {
    const { importLocalizedStatblock } = await loadService();
    const updates = [];
    const owner = {
      name: 'Test Drake', folder: null, items: [],
      async update(update) {
        updates.push(update);
        this.folder = { id: update.folder };
        return this;
      },
    };
    const sbi = {
      api: {
        parse: () => ({ actor: { name: 'Test Drake' } }),
        import: async () => ({ actor5e: owner }),
      },
    };
    await importLocalizedStatblock(
      { rawPayload: '===STATBLOCK===\nTest Drake\n===LOCALIZATION===\n{}', folderId: 'child-folder' },
      sbi,
    );
    assert.deepEqual(
      updates,
      [{ folder: 'child-folder' }],
    );
    assert.equal(
      owner.folder.id,
      'child-folder',
    );
  },
);
