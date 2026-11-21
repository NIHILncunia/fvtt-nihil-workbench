import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteOnHitEffect, setActivityEffectAttached } from '../scripts/workbench/item-adapter.mjs';
import { moveContainerItem } from '../scripts/workbench/container-adapter.mjs';

test('Cancelled effect unlink prevents deletion and leaves other effects and references intact', async () => {
  let deletes = 0;
  const activity = { effects: [{ _id: 'delete' }, { _id: 'keep', extension: true }], update: async () => undefined };
  const item = { effects: new Map([['delete', { id: 'delete' }], ['keep', { id: 'keep' }]]), system: { activities: [activity] }, deleteEmbeddedDocuments: async () => { deletes++; return [{ id: 'delete' }]; } };
  await assert.rejects(deleteOnHitEffect(item, 'delete'), /취소/);
  assert.equal(deletes, 0);
  assert.equal(item.effects.size, 2);
  assert.deepEqual(activity.effects, [{ _id: 'delete' }, { _id: 'keep', extension: true }]);
  await assert.rejects(setActivityEffectAttached(activity, 'keep', false), /취소/);
});

test('Cancelled effect deletion reports failure after confirmed unlink and preserves unrelated references', async () => {
  const activity = { effects: [{ _id: 'delete' }, { _id: 'keep' }], async update(patch) { this.effects = patch.effects; return this; } };
  const item = { effects: new Map([['delete', { id: 'delete' }], ['keep', { id: 'keep' }]]), system: { activities: [activity] }, deleteEmbeddedDocuments: async () => [] };
  await assert.rejects(deleteOnHitEffect(item, 'delete'), /취소/);
  assert.deepEqual(activity.effects, [{ _id: 'keep' }]);
  assert.equal(item.effects.size, 2);
});

test('Cancelled container write is a failure and preserves the previous owned relationship', async () => {
  const actor = { isOwner: true, items: new Map() };
  const item = { id: 'item', type: 'loot', parent: actor, isOwner: true, system: { container: null }, update: async () => undefined };
  const bag = { id: 'bag', type: 'container', parent: actor, isOwner: true, system: { container: null } };
  actor.items.set(item.id, item); actor.items.set(bag.id, bag);
  await assert.rejects(moveContainerItem(item, bag.id, { expectedParent: null }), /취소/);
  assert.equal(item.system.container, null);
});

test('Effect action failures show the reason in the UI and never announce deletion success', async () => {
  const previous = { foundry: globalThis.foundry, game: globalThis.game, ui: globalThis.ui };
  class ApplicationV2 { render() { return this; } }
  const errors = [], notices = [];
  globalThis.foundry = { applications: { api: {
    ApplicationV2, HandlebarsApplicationMixin: base => base,
    DialogV2: { confirm: async () => true },
  } } };
  globalThis.ui = { notifications: { error: message => errors.push(message), info: message => notices.push(message) } };
  const refs = [{ _id: 'delete' }, { _id: 'keep', extension: true }];
  const activity = { id: 'activity', effects: refs, update: async () => undefined };
  let deletes = 0;
  const item = { id: 'item', isOwner: true, effects: new Map([['delete', { id: 'delete' }]]),
    system: { activities: [activity] }, deleteEmbeddedDocuments: async () => { deletes++; return []; } };
  globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([[item.id, item]]) };
  try {
    const { openWorkbench } = await import(`../scripts/workbench/workbench-app.mjs?effectFailure=${Date.now()}`);
    const app = openWorkbench(item.id);
    app.selectedActivityId = activity.id;
    for (const action of ['attachEffect', 'detachEffect', 'deleteOnHitEffect', 'deleteEffect']) {
      await app.constructor.DEFAULT_OPTIONS.actions[action].call(app, { preventDefault() {} }, { dataset: { effectId: 'delete' } });
    }
    assert.equal(errors.length, 4);
    assert.ok(errors.every(message => message.includes('취소')));
    assert.equal(notices.length, 0);
    assert.equal(deletes, 0);
    assert.deepEqual(activity.effects, refs);
  } finally { Object.assign(globalThis, previous); }
});
