import assert from 'node:assert/strict';
import test from 'node:test';
import { copyItemToActor } from '../scripts/workbench/item-library.mjs';
import { createEmbeddedItemContext } from '../scripts/workbench/item-document-context.mjs';
import { createItemWorkbenchPanel } from '../scripts/workbench/item-workbench-panel.mjs';

// The installed system declares backpack as a legacy alias for container. Keep
// its adapter coverage alongside the generic base fallback document.
const types = ['base', 'weapon', 'equipment', 'consumable', 'tool', 'loot', 'race', 'background', 'class', 'subclass', 'spell', 'feat', 'container', 'backpack', 'facility'];

for (const actorType of ['character', 'npc']) for (const type of types) {
  test(`${actorType} ${type}: adapter copy, owned edit and readback retain source and module references`, async t => {
    const previous = { foundry: globalThis.foundry, game: globalThis.game };
    t.after(() => Object.assign(globalThis, previous));
    let sequence = 0;
    globalThis.foundry = { utils: { randomID: () => `copy${String(++sequence).padStart(12, '0')}` } };
    globalThis.game = { items: new Map(), packs: new Map() };
    const actor = {
      id: 'destination', type: actorType, uuid: 'Actor.destination', isOwner: true, items: new Map(),
      async createEmbeddedDocuments(kind, sources) {
        assert.equal(kind, 'Item');
        return sources.map(source => {
          const data = structuredClone(source);
          const item = { id: source._id, type, parent: actor, get name() { return data.name; }, system: data.system, toObject: () => structuredClone(data), data };
          this.items.set(item.id, item);
          return item;
        });
      },
      async updateEmbeddedDocuments(kind, updates) {
        assert.equal(kind, 'Item');
        return updates.map(update => { const item = this.items.get(update._id); Object.assign(item.data, { name: update.name }); return item; });
      },
    };
    const data = {
      _id: 'source1234567890', name: `시험 ${type}`, type, folder: 'original-folder', ownership: { default: 2 },
      system: { container: 'original-container', activities: { activity: { _id: 'activity', effects: [{ _id: 'effect' }], midiProperties: { triggeredActivityId: 'followup', chooseEffects: true } }, followup: { _id: 'followup', effects: [] } }, advancement: [] },
      effects: [{ _id: 'effect', origin: 'Item.source1234567890', flags: { dae: { stackable: 'noneName', enableCondition: 'true', specialDuration: ['turnEnd'] } } }],
      flags: { 'midi-qol': { onUseMacroName: '[preItemRoll]TestMacro' }, custom: { uuid: 'Actor.external', keep: [1, 2] } },
    };
    const snapshot = structuredClone(data);
    const source = { uuid: 'Item.source1234567890', documentName: 'Item', toObject: () => structuredClone(data) };
    const created = await copyItemToActor(actor, source);
    assert.equal(created.parent, actor);
    assert.deepEqual(created.toObject().system.activities, snapshot.system.activities);
    assert.deepEqual(created.toObject().effects[0].flags, snapshot.effects[0].flags);
    assert.equal(created.toObject().effects[0].origin, `${actor.uuid}.Item.${created.id}`);
    assert.deepEqual(created.toObject().flags['midi-qol'], snapshot.flags['midi-qol']);
    let returned;
    const panel = createItemWorkbenchPanel({ context: createEmbeddedItemContext(actor, created), onReturn: () => { returned = actor; } });
    await panel.saveBasic({ itemName: `수정 ${type}` });
    assert.equal(actor.items.get(created.id).toObject().name, `수정 ${type}`);
    panel.returnToOwner();
    assert.equal(returned, actor);
    assert.deepEqual(data, snapshot);
    const repeated = await copyItemToActor(actor, source);
    assert.notEqual(repeated.id, created.id);
    assert.equal(created.name, `수정 ${type}`);
    assert.equal(repeated.name, snapshot.name);
  });
}
