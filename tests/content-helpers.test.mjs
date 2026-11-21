import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { content, codes } from '../scripts/content/index.mjs';

const MODULE_ID = 'nihil-compendium-module';

async function fixture(run) {
  const globals = ['game', 'CONFIG', 'fromUuid', 'foundry', 'fetch'];
  const previous = new Map(globals.map((key) => [key, globalThis[key]]));
  const writes = [];
  const pack = new Map();
  Object.assign(
    pack,
    {
      collection: `${MODULE_ID}.test`,
      documentName: 'Item',
      locked: false,
      visible: true,
      metadata: { system: 'dnd5e', packageType: 'module' },
      testUserPermission: () => true,
      getIndex: async () =>
        new Map([...pack.values()].map((doc) => [doc.id, doc.toObject()])),
      getDocument: async (id) => pack.get(id),
    },
  );
  let nextId = 0;
  class Document {
    constructor(
      data,
      options = {},
    ) {
      // Foundry cleaners may mutate their input; validation must keep a separate source.
      if (data.system) delete data.system.doesNotExist;
      this.source = structuredClone(data);
      this.parent = options.parent;
      this.pack = options.pack;
      this.system = {
        ...data.system,
        schema: {
          fields: {
            identifier: {},
            description: {},
            magicalBonus: {},
            activities: {},
            advancement: {},
            details: {},
            attributes: {},
            traits: {},
            abilities: {},
            skills: {},
            resources: {},
          },
        },
      };
    }
    validate() {
      if (this.source.system?.magicalBonus < 0)
        throw new Error('Schema rejected magicalBonus');
    }
    get id() {
      return this.source._id;
    }
    get type() {
      return this.source.type;
    }
    get documentName() {
      return pack.documentName;
    }
    get uuid() {
      return `Compendium.${this.pack}.${this.documentName}.${this.id}`;
    }
    toObject() {
      return structuredClone(this.source);
    }
    async update(patch) {
      writes.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.split('.');
        let target = this.source;
        for (const key of keys.slice(
          0,
          -1,
        )) target = target[key] ??= {};
        target[keys.at(-1)] = structuredClone(value);
      }
      return this;
    }
    static async create(
      data,
      options,
    ) {
      const doc = new this(
        { ...data, _id: String(++nextId).padStart(
          16,
          '0',
        ) },
        options,
      );
      writes.push({ create: doc.toObject() });
      pack.set(
        doc.id,
        doc,
      );
      return doc;
    }
  }
  pack.documentClass = Document;
  globalThis.game = {
    system: { id: 'dnd5e' },
    user: { id: 'gm', isGM: true },
    modules: new Map([[MODULE_ID, { packs: [{ name: 'test' }] }]]),
    packs: new Map([[pack.collection, pack]]),
  };
  globalThis.CONFIG = {
    Item: { documentClass: Document },
    Actor: { documentClass: Document },
    DND5E: {
      distanceUnits: { self: {}, ft: {}, spec: {} },
      movementUnits: { ft: {}, m: {} },
      timePeriods: { inst: {}, minute: {}, round: {} },
      timeUnits: { minute: {} },
      activityConsumptionTypes: { activityUses: {}, itemUses: {} },
      armorClasses: { natural: {}, armored: {}, unarmored: {} },
    },
  };
  globalThis.fromUuid = async (uuid) =>
    [...pack.values()].find((doc) => doc.uuid === uuid);
  globalThis.foundry = {
    utils: { randomID: () => String(++nextId).padStart(
      16,
      '0',
    ) },
  };
  const templates = JSON.parse(
    await readFile(
      new URL(
        '../data/common-monster-templates.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => structuredClone(templates),
  });
  try {
    await run({ pack, writes, Document, options: { packId: pack.collection } });
  } finally {
    for (const [key, value] of previous)
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
  }
}

test(
  'Independent API matches all 68 planned helpers and immutable 17 canonical code groups',
  async () => {
    const inventory = await readFile(
      new URL(
        '../docs/workbench/콘텐츠 개발 헬퍼 1차 산출-2026-10-12.md',
        import.meta.url,
      ),
      'utf8',
    );
    const planned = [...inventory.matchAll(/^\| [^|]+ \| `([A-Za-z]\w+)` \|/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(
      Object.entries(content)
        .filter(([, value]) => typeof value === 'function')
        .map(([name]) => name)
        .sort(),
      planned,
    );
    assert.equal(
      Object.keys(codes).length,
      17,
    );
    assert.equal(
      Object.values(codes).reduce(
        (
          total,
          values,
        ) => total + Object.keys(values).length,
        0,
      ),
      164,
    );
    assert.throws(
      () => {
        codes.DamageType.FIRE = 'wrong';
      },
      TypeError,
    );
    assert.equal(
      codes.EffectMode.ADD,
      'add',
    );
    const source = await readFile(
      new URL(
        '../scripts/content/index.mjs',
        import.meta.url,
      ),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /workbench/,
    );
  },
);

test(
  '20 data builders preserve inputs and reject invalid codes, numbers and incompatible duration shapes',
  async () => {
    await fixture(async () => {
      const cases = {
        buildDescription: { value: '<p>설명</p>', chat: '요약' },
        buildDamagePart: { types: ['fire'], number: 2, denomination: 6 },
        buildEffectChange: {
          key: 'system.attributes.movement.walk',
          type: 'add',
          value: '10',
        },
        buildActivation: { type: 'legendary', value: 1 },
        buildRange: { units: 'ft', value: 30 },
        buildTarget: {
          affects: { type: 'creature' },
          template: { type: 'cone', size: 15, units: 'ft' },
        },
        buildDuration: { seconds: 60 },
        buildConsumption: { targets: [{ type: 'itemUses', value: '1' }] },
        buildUses: {
          max: '3',
          spent: 0,
          recovery: [{ period: 'sr', type: 'recoverAll' }],
        },
        buildAbilityScores: { str: { value: 16, proficient: 1 } },
        buildSkills: { ath: { value: 2, ability: 'str' } },
        buildHitPoints: { value: 25, max: 25, formula: '4d8+7' },
        buildArmorClass: { calcs: ['natural'], flat: 15 },
        buildMovement: { walk: 30, fly: 60, units: 'ft' },
        buildSenses: { ranges: { darkvision: 60 }, units: 'ft' },
        buildCreatureType: { value: 'dragon', subtype: 'red', swarm: '' },
        buildDamageTraits: {
          di: { value: ['fire'] },
          dr: { value: ['cold'] },
          dv: { value: ['radiant'] },
        },
        buildConditionImmunities: { value: ['poisoned'] },
        buildNpcResources: { legact: { value: 3, max: 3 } },
        buildPrototypeToken: {
          width: 2,
          height: 2,
          texture: { src: 'icons/svg/mystery-man.svg' },
        },
      };
      for (const [name, source] of Object.entries(cases)) {
        const before = structuredClone(source);
        assert.deepEqual(
          content[name](source),
          source,
          name,
        );
        assert.deepEqual(
          source,
          before,
          name,
        );
      }
      // v13 이하 입력 형식은 dnd5e 6 / Foundry v14 원본 구조로 바뀐다.
      assert.deepEqual(
        content.buildEffectChange({ key: 'system.attributes.ac.bonus', mode: 2, value: 1 }),
        { key: 'system.attributes.ac.bonus', type: 'add', value: '1' },
      );
      assert.deepEqual(
        content.buildArmorClass({ calc: 'flat', flat: 15 }),
        { flat: 15, override: 15 },
      );
      assert.deepEqual(
        content.buildArmorClass({ calc: 'custom', formula: '12 + @abilities.dex.mod' }),
        { formulas: [{ formula: '12 + @abilities.dex.mod' }] },
      );
      assert.deepEqual(
        content.buildSenses({ darkvision: 60, units: 'ft' }),
        { ranges: { darkvision: 60 }, units: 'ft' },
      );
      assert.deepEqual(
        content.buildDamagePart({ formula: '2d6+3', types: ['cold'] }).custom,
        { enabled: true, formula: '2d6+3' },
      );
      for (const [name, input] of [
        ['buildDamagePart', { types: ['lava'] }],
        ['buildDamagePart', { number: -1 }],
        [
          'buildEffectChange',
          { key: 'system.__proto__.polluted', mode: 2, value: 'x' },
        ],
        ['buildActivation', { type: 'nope' }],
        ['buildRange', { units: 'nope' }],
        ['buildTarget', { affects: { type: 'nope' } }],
        ['buildDuration', { seconds: 2, units: 'minute' }],
        ['buildConsumption', { targets: [{ type: 'nope' }] }],
        ['buildUses', { spent: -1 }],
        ['buildAbilityScores', { strength: { value: 10 } }],
        ['buildSkills', { ath: { value: 3 } }],
        ['buildHitPoints', { value: 26, max: 25 }],
        ['buildArmorClass', { flat: NaN }],
        ['buildMovement', { fly: -10 }],
        ['buildSenses', { darkvision: -1 }],
        ['buildCreatureType', { value: 'monster' }],
        ['buildDamageTraits', { di: { value: ['lava'] } }],
        ['buildConditionImmunities', { value: ['fire'] }],
        ['buildNpcResources', { legres: { value: 5, max: 3 } }],
        ['buildPrototypeToken', { width: 0 }],
      ])
        assert.throws(
          () => content[name](input),
          undefined,
          name,
        );
    });
  },
);

test(
  'Pack writing rejects foreign module, wrong type/system, locks and absent ownership',
  async () => {
    await fixture(async ({ pack, options }) => {
      for (const change of [
        () => {
          pack.locked = true;
        },
        () => {
          game.user.isGM = false;
        },
        () => {
          pack.testUserPermission = () => false;
        },
        () => {
          pack.metadata.system = 'other';
        },
        () => {
          game.modules.get(MODULE_ID).packs = [];
        },
      ]) {
        const before = {
          locked: pack.locked,
          user: game.user.isGM,
          permission: pack.testUserPermission,
          system: pack.metadata.system,
          packs: game.modules.get(MODULE_ID).packs,
        };
        change();
        await assert.rejects(content.createFeat(
          { name: 'blocked' },
          options,
        ));
        pack.locked = before.locked;
        game.user.isGM = before.user;
        pack.testUserPermission = before.permission;
        pack.metadata.system = before.system;
        game.modules.get(MODULE_ID).packs = before.packs;
      }
      assert.equal(
        pack.size,
        0,
      );
    });
  },
);

test(
  'All item factories preserve type-specific sources and creation options without world intermediates',
  async () => {
    await fixture(async ({ pack, options }) => {
      const pairs = {
        Weapon: 'weapon',
        Equipment: 'equipment',
        Consumable: 'consumable',
        Tool: 'tool',
        Loot: 'loot',
        Species: 'race',
        Background: 'background',
        Class: 'class',
        Subclass: 'subclass',
        Spell: 'spell',
        Feat: 'feat',
        Container: 'container',
        Facility: 'facility',
      };
      for (const [suffix, type] of Object.entries(pairs)) {
        const source = {
          name: suffix,
          flags: { external: { preserved: true } },
          system: { identifier: suffix.toLowerCase() },
        };
        const doc = await content[`create${suffix}`](
          source,
          options,
        );
        assert.equal(
          doc.type,
          type,
        );
        assert.equal(
          doc.pack,
          options.packId,
        );
        assert.deepEqual(
          doc.toObject().flags,
          source.flags,
        );
        assert.equal(
          source.type,
          undefined,
        );
      }
      assert.equal(
        pack.size,
        13,
      );
      await assert.rejects(
        content.createSpecies(
          { name: 'wrong', type: 'feat' },
          options,
        ),
      );
    });
  },
);

test(
  'Creation cancellation, duplicate keys and simultaneous duplicate registration retain a single document',
  async () => {
    await fixture(async ({ pack, options, Document }) => {
      const original = Document.create;
      Document.create = async () => undefined;
      await assert.rejects(
        content.createFeat(
          { name: 'retry' },
          { ...options, contentKey: 'one' },
        ),
        /취소/,
      );
      Document.create = original;
      const results = await Promise.allSettled([
        content.createFeat(
          { name: 'one' },
          { ...options, contentKey: 'one' },
        ),
        content.createFeat(
          { name: 'duplicate' },
          { ...options, contentKey: 'one' },
        ),
      ]);
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        pack.size,
        1,
      );
    });
  },
);

test(
  'Upsert preserves UUID and unrelated flags; missing/stale snapshots refuse changes',
  async () => {
    await fixture(async ({ options }) => {
      const opts = { ...options, contentKey: 'same' };
      const doc = await content.upsertCompendiumDocument(
        'Item',
        {
          name: 'original',
          type: 'weapon',
          flags: { external: { keep: 1 } },
          system: { magicalBonus: 1 },
        },
        opts,
      );
      const uuid = doc.uuid;
      const baseline = doc.toObject();
      await assert.rejects(
        content.upsertCompendiumDocument(
          'Item',
          { name: 'overwrite' },
          opts,
        ),
        /expectedSource/,
      );
      const updated = await content.upsertCompendiumDocument(
        'Item',
        { system: { magicalBonus: 2 } },
        { ...opts, expectedSource: baseline },
      );
      assert.equal(
        updated.uuid,
        uuid,
      );
      assert.equal(
        updated.toObject().flags.external.keep,
        1,
      );
      await assert.rejects(
        content.upsertCompendiumDocument(
          'Item',
          { name: 'stale' },
          { ...opts, expectedSource: baseline },
        ),
        /変更|변경/,
      );
      assert.equal(
        updated.toObject().name,
        'original',
      );
      await assert.rejects(
        content.upsertCompendiumDocument(
          'Item',
          { ownership: {} },
          { ...opts, expectedSource: updated.toObject() },
        ),
      );
    });
  },
);

test(
  'Schema failure, unknown fields and invalid references fail before any write',
  async () => {
    await fixture(async ({ options, writes }) => {
      await assert.rejects(
        content.createWeapon(
          { name: 'invalid', system: { magicalBonus: -1 } },
          options,
        ),
        /Schema/,
      );
      await assert.rejects(
        content.createFeat(
          { name: 'invalid', system: { doesNotExist: 1 } },
          options,
        ),
        /스키마/,
      );
      await assert.rejects(
        content.createFeat(
          {
            name: 'invalid',
            system: {
              activities: {
                x: { _id: 'x', type: 'utility', effects: [{ _id: 'missing' }] },
              },
            },
          },
          options,
        ),
        /효과/,
      );
      await assert.rejects(
        content.createSpecies(
          {
            name: 'invalid',
            system: {
              advancement: [
                {
                  type: 'ItemGrant',
                  configuration: {
                    items: [{ uuid: 'Compendium.missing.Item.one' }],
                  },
                },
              ],
            },
          },
          options,
        ),
        /UUID/,
      );
      await assert.rejects(
        content.createNpc(
          { name: 'PC', type: 'character' },
          options,
        ),
      );
      assert.equal(
        writes.length,
        0,
      );
    });
  },
);

test(
  'Normal, elite and boss presets use all 90 existing HP rows without adding combat rules',
  async () => {
    await fixture(async ({ pack, options }) => {
      pack.documentName = 'Actor';
      const templates = JSON.parse(
        await readFile(
          new URL(
            '../data/common-monster-templates.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      for (const row of templates) {
        const method = {
          일반: 'createNormalMonster',
          엘리트: 'createEliteMonster',
          보스: 'createBossMonster',
        }[row.folder];
        const doc = await content[method](
          { name: row.name, system: { details: { cr: row.cr } } },
          options,
        );
        assert.equal(
          doc.toObject().system.attributes.hp.max,
          row.hp,
        );
        assert.equal(
          doc.toObject().system.resources,
          undefined,
        );
      }
      await assert.rejects(
        content.createBossMonster(
          { name: 'invalid', system: { details: { cr: 0.5 } } },
          options,
        ),
      );
    });
  },
);

test(
  'UUID links escape neither markup nor arbitrary document identifiers',
  () => {
    assert.equal(
      content.buildContentLink({
        uuid: 'Compendium.example.items.Item.id',
        name: '특성',
      }),
      '@UUID[Compendium.example.items.Item.id]{특성}',
    );
    assert.throws(() =>
      content.buildContentLink(
        'Compendium.example.items.Item.id',
        '<script>',
      ),
    );
    assert.throws(() => content.buildContentLink(
      'not-a-uuid',
      'x',
    ));
  },
);

test(
  'Empty partial objects do not reset stored system data or unrelated flags',
  async () => {
    await fixture(async ({ options }) => {
      const opts = { ...options, contentKey: 'empty' };
      const doc = await content.createWeapon(
        {
          name: 'keep',
          system: { magicalBonus: 3 },
          flags: { external: { keep: true } },
        },
        opts,
      );
      await content.upsertCompendiumDocument(
        'Item',
        { system: {}, flags: { external: {} } },
        { ...opts, expectedSource: doc.toObject() },
      );
      assert.equal(
        doc.toObject().system.magicalBonus,
        3,
      );
      assert.equal(
        doc.toObject().flags.external.keep,
        true,
      );
    });
  },
);

test(
  'Pack re-locking during asynchronous reference validation stops publication',
  async () => {
    await fixture(async ({ pack, options, writes }) => {
      const feat = await content.createFeat(
        { name: 'source' },
        options,
      );
      globalThis.fromUuid = async () => {
        pack.locked = true;
        return feat;
      };
      await assert.rejects(
        content.createSpecies(
          {
            name: 'blocked',
            system: {
              advancement: [
                {
                  type: 'ItemGrant',
                  configuration: { items: [{ uuid: feat.uuid }] },
                },
              ],
            },
          },
          options,
        ),
        /잠금/,
      );
      assert.equal(
        pack.size,
        1,
      );
      assert.equal(
        writes.length,
        1,
      );
    });
  },
);

test(
  'Cyclic forward activities and casting a non-spell UUID fail before creation',
  async () => {
    await fixture(async ({ options, writes }) => {
      await assert.rejects(
        content.createFeat(
          {
            name: 'cycle',
            system: {
              activities: {
                first: {
                  _id: 'first',
                  type: 'forward',
                  activity: { id: 'second' },
                },
                second: {
                  _id: 'second',
                  type: 'forward',
                  activity: { id: 'first' },
                },
              },
            },
          },
          options,
        ),
        /순환/,
      );
      const feat = await content.createFeat(
        { name: 'not spell' },
        options,
      );
      await assert.rejects(
        content.createFeat(
          {
            name: 'bad cast',
            system: {
              activities: {
                cast: { _id: 'cast', type: 'cast', spell: { uuid: feat.uuid } },
              },
            },
          },
          options,
        ),
        /주문/,
      );
      assert.equal(
        writes.length,
        1,
      );
    });
  },
);
