import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MODULE_ID = 'nihil-compendium-module';
const LEGACY = 'luxterra-resource-manager';
const settingsStore = new Map();
let randomId = 0;

function getProperty(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}
function setProperty(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) target = target[key] ??= {};
  target[last] = value;
}

globalThis.foundry = {
  ...(globalThis.foundry ?? {}),
  utils: {
    ...(globalThis.foundry?.utils ?? {}),
    deepClone: (value) => structuredClone(value),
    randomID: () => `resource-${++randomId}`,
    getProperty,
    setProperty,
  },
};

globalThis.game = {
  actors: [],
  user: { isGM: true },
  settings: {
    get: (moduleId, key) => settingsStore.get(`${moduleId}.${key}`),
    set: async (moduleId, key, value) => {
      settingsStore.set(`${moduleId}.${key}`, structuredClone(value));
      return value;
    },
  },
};

const { createResourceDefinition, updateResourceDefinition, archiveResourceDefinition } = await import('../scripts/resources/resource-definitions.mjs');
const {
  adjustResourceForActors,
  getActorResourceRows,
  getResourceStatusRows,
  setActorResourceValue,
  syncActorResources,
  synchronizeAllActorResources,
} = await import('../scripts/resources/actor-resources.mjs');
const {
  canUserChangeActorResources,
  canUserViewActorResources,
  containsActorResourceChanges,
} = await import('../scripts/resources/resource-permissions.mjs');
const { migrateLegacyResources, planLegacyResourceMigration, readLegacyWorldSetting } = await import('../scripts/resources/migration.mjs');
const { changedMax, healthMonitorMessageCount, isHealthMonitorMessageFor } = await import('../scripts/secret-hp/secret-hp.mjs');

function createActor(id, name, resources = {}, legacyResources = null) {
  let flags = structuredClone(resources);
  return {
    id,
    name,
    type: 'character',
    uuid: `Actor.${id}`,
    _source: {
      get flags() {
        return {
          [MODULE_ID]: Object.keys(flags).length ? { resources: structuredClone(flags) } : undefined,
          ...(legacyResources ? { [LEGACY]: { resources: structuredClone(legacyResources) } } : {}),
        };
      },
    },
    getFlag: () => structuredClone(flags),
    setFlag: async (_moduleId, _key, value) => {
      flags = structuredClone(value);
    },
    get resources() {
      return structuredClone(flags);
    },
  };
}

test.beforeEach(() => {
  settingsStore.clear();
  randomId = 0;
  game.actors = [];
  game.user.isGM = true;
  globalThis.fromUuid = async (uuid) => game.actors.find((actor) => actor.uuid === uuid) ?? null;
});

test('resource definitions live under the workbench module id and reject duplicates and bad max', async () => {
  const definition = await createResourceDefinition({ name: '스트레스', max: 100, startFromZero: true });
  assert.ok(settingsStore.get(`${MODULE_ID}.resourceDefinitions`)[definition.id]);
  await assert.rejects(createResourceDefinition({ name: '스트레스', max: 10 }), /이미 존재하는 자원명/);
  await assert.rejects(createResourceDefinition({ name: '오염도', max: 0 }), /최대치는 1 이상의 정수/);
  await assert.rejects(createResourceDefinition({ name: '오염도', max: 1.5 }), /최대치는 1 이상의 정수/);
  await archiveResourceDefinition(definition.id);
  await assert.rejects(createResourceDefinition({ name: '스트레스', max: 10 }), /이미 존재하는 자원명/);
});

test('every active resource is synced to existing and new PCs and lowering max keeps stored values', async () => {
  const zero = await createResourceDefinition({ name: '오염도', max: 200, startFromZero: true });
  const full = await createResourceDefinition({ name: '행운', max: 10, startFromZero: false });
  const existing = createActor('a1', '기존 PC');
  const fresh = createActor('a2', '새 PC');
  game.actors = [existing];
  await synchronizeAllActorResources();
  await syncActorResources(fresh);
  assert.equal(existing.resources[zero.id].value, 0);
  assert.equal(existing.resources[full.id].value, 10);
  assert.equal(fresh.resources[full.id].value, 10);

  await setActorResourceValue(existing, zero.id, 180);
  await updateResourceDefinition(zero.id, { max: 100 });
  const row = getActorResourceRows(existing).find((entry) => entry.id === zero.id);
  assert.equal(row.value, 180);
  assert.equal(row.max, 100);
  assert.equal(row.percent, 100);
});

test('status rows and bulk adjustment only touch managed PCs and clamp to the range', async () => {
  const definition = await createResourceDefinition({ name: '스트레스', max: 20, startFromZero: true });
  const managed = createActor('a1', '관리 PC');
  const unmanaged = createActor('a2', '비관리 PC');
  game.actors = [managed, unmanaged];
  settingsStore.set(`${MODULE_ID}.managedActorUuids`, { [managed.uuid]: true });
  assert.deepEqual(getResourceStatusRows(definition.id).map((row) => row.uuid), [managed.uuid]);
  await adjustResourceForActors(definition.id, 25, [managed]);
  assert.equal(managed.resources[definition.id].value, 20);
  await adjustResourceForActors(definition.id, -50, [managed]);
  assert.equal(managed.resources[definition.id].value, 0);
});

test('players cannot change resource values or resource flags, but other workbench flags pass', async () => {
  const definition = await createResourceDefinition({ name: '스트레스', max: 100, startFromZero: true });
  const actor = createActor('a1', 'PC 1', { [definition.id]: { value: 10 } });
  game.user.isGM = false;
  await assert.rejects(setActorResourceValue(actor, definition.id, 50), /GM만/);
  assert.equal(actor.resources[definition.id].value, 10);

  const nested = { flags: { [MODULE_ID]: { resources: { x: { value: 1 } } } } };
  assert.equal(containsActorResourceChanges(nested), true);
  assert.equal(containsActorResourceChanges({ [`flags.${MODULE_ID}.resources.x.value`]: 3 }), true);
  assert.equal(containsActorResourceChanges({ flags: { [MODULE_ID]: { '-=resources': null } } }), true);
  assert.equal(containsActorResourceChanges({ flags: { [`-=${MODULE_ID}`]: null } }), true);
  assert.equal(containsActorResourceChanges({ flags: { [MODULE_ID]: { contentKey: 'a' } } }), false);
  assert.equal(containsActorResourceChanges({ [`flags.${MODULE_ID}`]: { sceneWorkbench: {} } }), false);
  assert.equal(canUserChangeActorResources({ isGM: false }, nested), false);
  assert.equal(canUserChangeActorResources({ isGM: true }, nested), true);
  assert.equal(canUserChangeActorResources({ isGM: false }, { name: '새 이름' }), true);
});

test('only non-GM owners of a character get the read-only viewer', () => {
  assert.equal(canUserViewActorResources({ isGM: false }, { type: 'character', isOwner: true }), true);
  assert.equal(canUserViewActorResources({ isGM: true }, { type: 'character', isOwner: true }), false);
  assert.equal(canUserViewActorResources({ isGM: false }, { type: 'npc', isOwner: true }), false);
  assert.equal(canUserViewActorResources({ isGM: false }, { type: 'character', isOwner: false }), false);
});

test('legacy migration plan fills only missing definitions, managed PCs and actor values', () => {
  const plan = planLegacyResourceMigration({
    currentDefinitions: { keep: { id: 'keep', name: '현재', max: 5 } },
    legacyDefinitions: JSON.stringify({ keep: { id: 'keep', name: '옛', max: 9 }, old: { id: 'old', name: '스트레스', max: 100 } }),
    currentManaged: {},
    legacyManaged: { 'Actor.a1': true, 'Actor.a2': false },
    actors: [
      { actor: 'A1', currentResources: { keep: { value: 1 } }, legacyResources: { keep: { value: 4 }, old: { value: 30 } } },
      { actor: 'A2', currentResources: {}, legacyResources: {} },
    ],
  });
  assert.equal(plan.definitions.keep.name, '현재');
  assert.equal(plan.definitions.old.max, 100);
  assert.deepEqual(plan.managed, { 'Actor.a1': true });
  assert.deepEqual(plan.actors, [{ actor: 'A1', resources: { keep: { value: 1 }, old: { value: 30 } } }]);

  const empty = planLegacyResourceMigration({ currentDefinitions: {}, legacyDefinitions: {}, currentManaged: {}, legacyManaged: {}, actors: [] });
  assert.deepEqual(empty, { definitions: null, managed: null, actors: [] });
});

test('legacy world settings are read from storage even when the old module is not registered', () => {
  const storage = { getSetting: (key) => (key === `${LEGACY}.resourceDefinitions` ? { value: '{"a":{"id":"a"}}' } : undefined) };
  assert.deepEqual(readLegacyWorldSetting('resourceDefinitions', storage), { a: { id: 'a' } });
  assert.deepEqual(readLegacyWorldSetting('managedActorUuids', storage), {});
});

test('migration copies legacy resources once and then sync keeps them', async () => {
  const actor = createActor('a1', 'PC', {}, { old: { value: 30 } });
  game.actors = [actor];
  const legacyStorage = new Map([
    [`${LEGACY}.resourceDefinitions`, { value: { old: { id: 'old', name: '스트레스', max: 100, startFromZero: false } } }],
    [`${LEGACY}.managedActorUuids`, { value: { [actor.uuid]: true } }],
  ]);
  game.settings.storage = { get: () => ({ getSetting: (key) => legacyStorage.get(key) }) };
  try {
    const summary = await migrateLegacyResources();
    assert.deepEqual(summary, { definitions: 1, managed: 1, actors: 1 });
    await synchronizeAllActorResources();
    assert.equal(actor.resources.old.value, 30);
    assert.equal(settingsStore.get(`${MODULE_ID}.resourceMigrationVersion`), 1);
    assert.equal(await migrateLegacyResources(), null);
  } finally {
    delete game.settings.storage;
  }
});

test('secret HP helpers mirror Health Monitor message counting and detect max changes', () => {
  const actor = { _source: { system: { attributes: { hp: { value: 10, max: 20 } } } } };
  assert.equal(changedMax(actor, { system: { attributes: { hp: { max: 30 } } } }), 30);
  assert.equal(changedMax(actor, { system: { attributes: { hp: { max: 20 } } } }), null);
  assert.equal(changedMax(actor, { system: { attributes: { hp: { value: 3 } } } }), null);
  assert.equal(healthMonitorMessageCount({ value: 10, max: 20, temp: 0 }, { value: 5, max: 25 }), 2);
  assert.equal(healthMonitorMessageCount({ value: 10, temp: 5 }, { temp: 0 }), 1);
  assert.equal(isHealthMonitorMessageFor('<div class="hm-message"><b>고블린</b> loses 5 HP</div>', new Set(['고블린'])), true);
  assert.equal(isHealthMonitorMessageFor('<p>고블린 loses 5 HP</p>', new Set(['고블린'])), false);
});

test('manifest ships resource styles and entry wires secret HP and resource manager', async () => {
  const manifest = JSON.parse(await readFile(new URL('../module.json', import.meta.url), 'utf8'));
  // 월드를 다시 열지 않아도 서식이 들어가도록 기존 workbench.css에 합쳤다(서버는 월드 실행 때의 manifest styles만 싣는다).
  assert.deepEqual(manifest.styles, ['styles/workbench.css']);
  const entry = await readFile(new URL('../scripts/module.mjs', import.meta.url), 'utf8');
  assert.match(entry, /registerSecretHp\(\)/);
  assert.match(entry, /registerResourceManager\(\)/);
  const template = await readFile(new URL('../templates/resources/resource-manager.hbs', import.meta.url), 'utf8');
  assert.match(template, /data-action="create-resource"/);
  const css = await readFile(new URL('../styles/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.ncm-resource-manager/);
});
