import assert from 'node:assert/strict';
import test from 'node:test';
import { copyItemToActor } from '../scripts/workbench/item-library.mjs';

function fixture(t) {
  const previous = { foundry: globalThis.foundry, game: globalThis.game };
  t.after(() => Object.assign(
    globalThis,
    previous
  ));
  globalThis.foundry = { utils: { randomID: () => 'newItem1234567890' } };
  globalThis.game = { items: new Map(), packs: new Map() };
  const writes = [];
  const actor = {
    uuid: 'Actor.destination',
    isOwner: true,
    items: new Map(),
    async createEmbeddedDocuments(
      type,
      documents,
      options
    ) {
      writes.push({ type, documents, options });
      return [{ id: documents[0]._id, parent: actor }];
    },
  };
  const data = {
    _id: 'source1234567890',
    name: '복사 예제',
    type: 'spell',
    folder: 'folder',
    ownership: { default: 3 },
    _stats: { createdTime: 1, modifiedTime: 2 },
    system: { activities: {}, advancement: [] },
    effects: [],
    flags: { custom: { reference: 'Item.source1234567890' } },
  };
  const item = {
    documentName: 'Item',
    uuid: 'Item.source1234567890',
    toObject: () => structuredClone(data),
  };
  return { actor, item, data, writes };
}

test(
  'A single physical copy starts at root even when the destination has a colliding container ID',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    data.type = 'loot';
    data.system.container = 'oldContainer1234';
    data.system.quantity = 3;
    actor.items.set(
      'oldContainer1234',
      { type: 'container' }
    );
    const original = structuredClone(data);
    await copyItemToActor(
      actor,
      item
    );
    const copied = writes[0].documents[0];
    assert.equal(
      copied.system.container,
      null
    );
    assert.equal(
      copied.system.quantity,
      3
    );
    assert.equal(
      copied.folder,
      undefined
    );
    assert.equal(
      copied.ownership,
      undefined
    );
    assert.equal(
      copied._stats,
      undefined
    );
    assert.deepEqual(
      data,
      original
    );
  }
);

test(
  'Activities keep effect IDs and external summon UUIDs; only self effect origin follows the new item',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    data.effects = [
      { _id: 'effect', origin: item.uuid, changes: [] },
      { _id: 'external', origin: 'Item.enchantingItem', changes: [] },
    ];
    data.system.activities.summon = {
      _id: 'summon',
      effects: [{ _id: 'effect', level: { min: 2, max: 5 } }],
      profiles: [{ uuid: 'Actor.summoned', count: '2' }],
    };
    const original = structuredClone(data);
    await copyItemToActor(
      actor,
      item
    );
    const copied = writes[0].documents[0];
    assert.equal(
      copied.effects[0].origin,
      'Actor.destination.Item.newItem1234567890'
    );
    assert.equal(
      copied.effects[1].origin,
      'Item.enchantingItem'
    );
    assert.deepEqual(
      copied.system,
      original.system
    );
    assert.deepEqual(
      copied.flags.custom,
      original.flags.custom
    );
    assert.equal(
      copied.flags.dnd5e.sourceId,
      item.uuid
    );
    assert.deepEqual(
      writes[0].options,
      { keepId: true, keepEmbeddedIds: true }
    );
    assert.deepEqual(
      data,
      original
    );
  }
);

test(
  'Locked compendium sources retain provenance without copying source timestamps',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    item.pack = 'dnd5e.items';
    item.uuid = 'Compendium.dnd5e.items.Item.source1234567890';
    item.isOwner = false;
    data.system.advancement = [{
      _id: 'grant', type: 'ItemGrant',
      configuration: { items: [{ uuid: 'Compendium.dnd5e.items.Item.granted', optional: false }] },
      value: {},
    }];
    await copyItemToActor(
      actor,
      item
    );
    assert.deepEqual(
      writes[0].documents[0]._stats,
      { compendiumSource: item.uuid }
    );
    assert.deepEqual(
      writes[0].documents[0].system.advancement,
      data.system.advancement
    );
  }
);

test(
  'World imports preserve existing compendium provenance',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    data._stats.compendiumSource = 'Compendium.dnd5e.items.Item.original';
    await copyItemToActor(
      actor,
      item
    );
    assert.deepEqual(
      writes[0].documents[0]._stats,
      { compendiumSource: data._stats.compendiumSource }
    );
  }
);

test(
  'Self consumption is remapped, explicit UUIDs and identifiers stay intact',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    data.system.activities.use = { consumption: { targets: [
      { type: 'itemUses', target: data._id },
      { type: 'material', target: item.uuid },
      { type: 'itemUses', target: '' },
      { type: 'itemUses', target: 'wand-of-fireballs' },
      { type: 'itemUses', target: 'Compendium.dnd5e.items.Item.wand' },
      { type: 'hitDice', target: 'd6' },
    ] } };
    await copyItemToActor(
      actor,
      item
    );
    assert.deepEqual(
      writes[0].documents[0].system.activities.use.consumption.targets.map((row) => row.target),
      [
        'newItem1234567890', 'newItem1234567890', '', 'wand-of-fireballs', 'Compendium.dnd5e.items.Item.wand', 'd6',
      ]
    );
  }
);

test(
  'Foreign raw consumption IDs use source UUIDs despite a colliding destination ID',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    const id = 'dependency123456';
    actor.items.set(
      id,
      { uuid: `Actor.destination.Item.${id}` }
    );
    globalThis.game.items.set(
      id,
      { uuid: `Item.${id}` }
    );
    data.system.activities.use = { consumption: { targets: [{ type: 'itemUses', target: id }] } };
    await copyItemToActor(
      actor,
      item
    );
    assert.equal(
      writes[0].documents[0].system.activities.use.consumption.targets[0].target,
      `Item.${id}`
    );
  }
);

test(
  'Pack dependencies resolve from that pack and are not silently imported',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    item.pack = 'source.pack';
    item.uuid = 'Compendium.source.pack.Item.source1234567890';
    let reads = 0;
    globalThis.game.packs.set(
      item.pack,
      { async getDocument(id) {
        reads += 1;
        return { uuid: `Compendium.source.pack.Item.${id}` };
      } }
    );
    data.system.activities.use = { consumption: { targets: [
      { type: 'itemUses', target: 'dependency123456' },
      { type: 'material', target: 'dependency123456' },
    ] } };
    await copyItemToActor(
      actor,
      item
    );
    assert.equal(
      reads,
      1
    );
    assert.equal(
      writes[0].documents.length,
      1
    );
    assert.equal(
      writes[0].documents[0].system.activities.use.consumption.targets[0].target,
      'Compendium.source.pack.Item.dependency123456'
    );
  }
);

test(
  'Missing consumption source aborts before creation instead of becoming self consumption',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    data.system.activities.use = { consumption: { targets: [{ type: 'itemUses', target: 'missing123456789' }] } };
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /소모 대상/
    );
    assert.equal(
      writes.length,
      0
    );
  }
);

for (const type of ['ItemGrant', 'ItemChoice']) {
  test(
    `${type} applied result IDs cannot cross actor scopes, even if destination IDs collide`,
    async (t) => {
      const { actor, item, data, writes } = fixture(t);
      actor.items.set(
        'granted',
        {}
      );
      const added = { granted: 'Compendium.source.pack.Item.granted' };
      data.system.advancement = [{ type, value: { added: type === 'ItemGrant' ? added : { 1: added } } }];
      await assert.rejects(
        copyItemToActor(
          actor,
          item
        ),
        /성장 지급 결과/
      );
      assert.equal(
        writes.length,
        0
      );
    }
  );
}

test(
  'Same actor growth results preserve UUID values, and self origins use the copied ID',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    item.parent = actor;
    actor.items.set(
      'granted',
      {}
    );
    data.flags.dnd5e = { advancementOrigin: `${data._id}.grant` };
    data.system.advancement = [{ type: 'ItemGrant', value: { added: { granted: 'Compendium.source.pack.Item.granted' } } }];
    await copyItemToActor(
      actor,
      item
    );
    assert.equal(
      writes[0].documents[0].flags.dnd5e.advancementOrigin,
      'newItem1234567890.grant'
    );
    assert.deepEqual(
      writes[0].documents[0].system.advancement,
      data.system.advancement
    );
  }
);

test(
  'Permission revoked while resolving a pack dependency prevents creation',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    item.pack = 'source.pack';
    globalThis.game.packs.set(
      item.pack,
      { async getDocument() {
        actor.isOwner = false;
        return { uuid: 'Compendium.source.pack.Item.dependency123456' };
      } }
    );
    data.system.activities.use = { consumption: { targets: [{ type: 'itemUses', target: 'dependency123456' }] } };
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /권한/
    );
    assert.equal(
      writes.length,
      0
    );
  }
);

test(
  'System refusal produces a failure instead of an undefined success document',
  async (t) => {
    const { actor, item } = fixture(t);
    actor.createEmbeddedDocuments = async () => [];
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /추가되지 않았습니다/
    );
  }
);

test(
  'Creation errors propagate and source data stays unchanged',
  async (t) => {
    const { actor, item, data } = fixture(t);
    const original = structuredClone(data);
    actor.createEmbeddedDocuments = async () => { throw new Error('server failed'); };
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /server failed/
    );
    assert.deepEqual(
      data,
      original
    );
  }
);

test(
  'A 16-character identifier stays usable when it names a source item',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    const identifier = 'abcdefghijklmnop';
    globalThis.game.items.set(
      'anotherId',
      { system: { identifier } }
    );
    data.system.activities.use = { consumption: { targets: [{ type: 'itemUses', target: identifier }] } };
    await copyItemToActor(
      actor,
      item
    );
    assert.equal(
      writes[0].documents[0].system.activities.use.consumption.targets[0].target,
      identifier
    );
  }
);

test(
  'Dangling local effect links are rejected before item creation',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    data.system.activities.use = { effects: [{ _id: 'missing' }] };
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /연결된 효과/
    );
    assert.equal(
      writes.length,
      0
    );
  }
);

test(
  'A foreign advancement origin cannot accidentally point at a destination item',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    actor.items.set(
      'oldClass',
      {}
    );
    data.flags.dnd5e = { advancementRoot: 'oldClass.grant' };
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /성장 지급 결과/
    );
    assert.equal(
      writes.length,
      0
    );
  }
);

test(
  'Fresh ID collision aborts without overwriting an existing owned item',
  async (t) => {
    const { actor, item, writes } = fixture(t);
    actor.items.set(
      'newItem1234567890',
      {}
    );
    await assert.rejects(
      copyItemToActor(
        actor,
        item
      ),
      /아이템 ID/
    );
    assert.equal(
      writes.length,
      0
    );
  }
);

test(
  'A world dependency imported from a pack uses its canonical provenance for native source lookup',
  async (t) => {
    const { actor, item, data, writes } = fixture(t);
    const id = 'dependency123456';
    const compendiumSource = 'Compendium.source.pack.Item.original';
    globalThis.game.items.set(
      id,
      { uuid: `Item.${id}`, _stats: { compendiumSource } }
    );
    data.system.activities.use = { consumption: { targets: [{ type: 'itemUses', target: id }] } };
    await copyItemToActor(
      actor,
      item
    );
    assert.equal(
      writes[0].documents[0].system.activities.use.consumption.targets[0].target,
      compendiumSource
    );
  }
);
