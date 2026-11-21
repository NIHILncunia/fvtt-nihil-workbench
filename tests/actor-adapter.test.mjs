import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/actor-adapter.mjs', import.meta.url);

async function loadAdapter() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function actorFixture({
  type = 'character',
  name = type === 'npc' ? 'Test NPC' : 'Test PC',
  source = {},
} = {}) {
  const baseSource = {
    name,
    img: 'icons/svg/mystery-man.svg',
    prototypeToken: {
      name,
      disposition: 1,
      actorLink: false,
    },
    system: {
      abilities: {
        str: { value: 14, proficient: 1 },
        dex: { value: 12, proficient: 0 },
      },
      attributes: {
        ac: { flat: 15 },
        hp: { value: 22, max: 30, temp: 3, formula: '5d8' },
        movement: { walk: 30, fly: 0, units: 'ft' },
        senses: { darkvision: 60, units: 'ft' },
        death: { success: 1, failure: 2 },
        inspiration: true,
        spell: { level: 5 },
      },
      traits: {
        size: 'med',
        di: { value: ['fire'], custom: '' },
        dr: { value: ['cold'], custom: '' },
        dv: { value: [], custom: '' },
        ci: { value: ['poisoned'], custom: '' },
      },
      details: {
        biography: { value: '<p>Bio</p>' },
        type: { value: 'humanoid', subtype: 'elf', custom: '' },
        xp: { value: 355 },
        cr: 2,
      },
      source: { book: 'PHB', page: '12', custom: '' },
      resources: {
        primary: { value: 1, max: 3, label: '기력' },
        secondary: { value: 0, max: 2, label: '집중' },
        tertiary: { value: 4, max: 4, label: '탄약' },
        legact: { spent: 1, max: 3 },
        legres: { spent: 2, max: 3 },
        lair: { value: true, initiative: 20 },
      },
      currency: { gp: 15 },
    },
  };
  const resolvedSource = structuredClone(baseSource);
  Object.assign(resolvedSource, source);
  resolvedSource.system = {
    ...baseSource.system,
    ...(source.system ?? {}),
  };
  return {
    id: `${type}-1`,
    type,
    name,
    img: resolvedSource.img,
    folder: { id: `${type}-folder` },
    toObject() {
      return structuredClone(resolvedSource);
    },
  };
}

test('Actor Adapter reads only character and npc into the Workbench model', async () => {
  const { isSupportedActor, readActorWorkbenchModel } = await loadAdapter();
  const character = actorFixture({ type: 'character' });
  const npc = actorFixture({ type: 'npc' });

  assert.equal(isSupportedActor(character), true);
  assert.equal(isSupportedActor(npc), true);
  assert.equal(isSupportedActor(actorFixture({ type: 'vehicle' })), false);
  assert.equal(readActorWorkbenchModel(actorFixture({ type: 'vehicle' })), null);

  const model = readActorWorkbenchModel(character);
  assert.equal(model.id, 'character-1');
  assert.equal(model.folderId, 'character-folder');
  assert.deepEqual(model.common.hp, { value: 22, max: 30, temp: 3, formula: '5d8' });
  assert.deepEqual(model.common.abilities.str, { value: 14, proficient: 1 });
  assert.deepEqual(model.common.movement, { walk: 30, fly: 0, units: 'ft' });
  assert.equal(model.common.prototypeToken.disposition, 1);
});

test('Actor Adapter reads character-only growth and resource fields', async () => {
  const { readActorWorkbenchModel } = await loadAdapter();
  const model = readActorWorkbenchModel(actorFixture({ type: 'character' }));

  assert.deepEqual(model.typeSpecific, {
    xp: { value: 355 },
    inspiration: true,
    death: { success: 1, failure: 2 },
    resources: {
      primary: { value: 1, max: 3, label: '기력' },
      secondary: { value: 0, max: 2, label: '집중' },
      tertiary: { value: 4, max: 4, label: '탄약' },
    },
  });
});

test('Actor Adapter reads npc-only combat and legendary fields', async () => {
  const { readActorWorkbenchModel } = await loadAdapter();
  const model = readActorWorkbenchModel(actorFixture({ type: 'npc' }));

  assert.deepEqual(model.typeSpecific, {
    creature: { size: 'med', type: { value: 'humanoid', subtype: 'elf', custom: '' } },
    cr: 2,
    xp: { value: 355 },
    hpFormula: '5d8',
    spellLevel: 5,
    legendary: { actions: { spent: 1, max: 3 }, resistance: { spent: 2, max: 3 } },
    lair: { value: true, initiative: 20 },
  });
});

test('Actor Adapter writes only changed character paths and never writes level', async () => {
  const { buildActorWorkbenchUpdate } = await loadAdapter();
  const actor = actorFixture({ type: 'character' });
  const update = buildActorWorkbenchUpdate(actor, {
    name: '새 PC',
    hpValue: '14',
    xpValue: '900',
    xpMax: '9000',
    inspiration: false,
    level: '20',
    acFlat: '15',
  });

  assert.deepEqual(update, {
    name: '새 PC',
    'system.attributes.hp.value': 14,
    'system.details.xp.value': 900,
    'system.attributes.inspiration': false,
  });
  assert.equal('system.details.level' in update, false);
  assert.equal('system.details.xp.max' in update, false);
  assert.equal('system.attributes.ac.flat' in update, false);
});

test('Actor Adapter writes only npc-specific changed paths', async () => {
  const { buildActorWorkbenchUpdate } = await loadAdapter();
  const update = buildActorWorkbenchUpdate(actorFixture({ type: 'npc' }), {
    cr: '3',
    hpFormula: '6d8 + 12',
    creatureType: 'dragon',
    spellLevel: '9',
    legendaryActionsSpent: '0',
    legendaryActionsMax: '4',
  });

  assert.deepEqual(update, {
    'system.details.cr': 3,
    'system.attributes.hp.formula': '6d8 + 12',
    'system.details.type.value': 'dragon',
    'system.attributes.spell.level': 9,
    'system.resources.legact.spent': 0,
    'system.resources.legact.max': 4,
  });
});

test(
  'NPC XP is computed by the system and cannot be saved as a nonexistent source field',
  async () => {
  const { buildActorWorkbenchUpdate } = await loadAdapter();
  assert.throws(
    () => buildActorWorkbenchUpdate(
      actorFixture({ type: 'npc' }),
      { xpValue: '700' }
    ),
    /자동 계산/
  );
}
);

test('Actor Adapter creates only the requested supported Actor type', async () => {
  const { buildActorCreateSource } = await loadAdapter();

  assert.deepEqual(buildActorCreateSource('npc', {
    name: '빈 NPC',
    folderId: 'folder-1',
    img: 'icons/svg/monster.svg',
  }), {
    type: 'npc',
    name: '빈 NPC',
    folder: 'folder-1',
    img: 'icons/svg/monster.svg',
    prototypeToken: { name: '빈 NPC' },
  });
  assert.throws(
    () => buildActorCreateSource('vehicle', { name: '수레' }),
    /지원하지 않는 Actor 유형/,
  );
  assert.throws(
    () => buildActorCreateSource('character', { name: '   ' }),
    /이름/,
  );
});

test(
  'portrait and token edits write separate paths and preserve other prototype token settings',
  async () => {
    const { buildActorWorkbenchUpdate } = await loadAdapter();
    for (const type of ['character', 'npc']) {
      const owner = actorFixture({
        type,
        source: {
          prototypeToken: {
            name: '기존 토큰',
            actorLink: false,
            width: 2,
            texture: { src: 'old-token.webp', scaleX: 1.5, scaleY: 1.5 },
          },
        },
      });
      const before = owner.toObject();
      assert.deepEqual(
        buildActorWorkbenchUpdate(
          owner,
          { img: 'portrait.webp', tokenImg: 'token.webp' },
        ),
        { img: 'portrait.webp', 'prototypeToken.texture.src': 'token.webp' },
      );
      assert.deepEqual(
        buildActorWorkbenchUpdate(
          owner,
          { tokenImg: 'old-token.webp' },
        ),
        {},
      );
      assert.deepEqual(
        owner.toObject(),
        before,
      );
    }
  },
);
