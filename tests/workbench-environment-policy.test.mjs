import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseActorWorkbench } from '../scripts/workbench/actor-workbench-app.mjs';
import { canManageOwnership } from '../scripts/workbench/ownership-workbench-app.mjs';
import { canEditWorkbenchEffect } from '../scripts/workbench/effect-workbench-app.mjs';
import { effectFields } from '../scripts/workbench/effect-fields.mjs';
import { readActivityCommonFields, buildActivityFieldUpdate } from '../scripts/workbench/activity-field-adapter.mjs';

test('Current allowed users, document ownership and GM ownership administration remain separate policies', () => {
  const previous = globalThis.game;
  try {
    for (const id of ['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn', 'other']) {
      for (const isGM of [false, true]) {
        for (const isOwner of [false, true]) {
          const actor = { id: 'actor', documentName: 'Actor', isOwner, effects: new Map() };
          const effect = { id: 'effect', parent: actor, isOwner }; actor.effects.set(effect.id, effect);
          globalThis.game = { user: { id, isGM }, actors: new Map([[actor.id, actor]]) };
          const allowed = id !== 'other';
          assert.equal(canUseActorWorkbench(), allowed);
          // Ownership distribution needs GM status even when ordinary document editing is allowed.
          assert.equal(canManageOwnership(actor, canUseActorWorkbench), allowed && isGM);
          assert.equal(canEditWorkbenchEffect(effect, canUseActorWorkbench), allowed && isOwner);
        }
      }
    }
  } finally { globalThis.game = previous; }
});

test('Effect editing rejects changed permission, packs, replaced owner and detached embedded Item', () => {
  const previous = globalThis.game;
  try {
    const actor = { id: 'actor', documentName: 'Actor', isOwner: true, items: new Map() };
    const item = { id: 'item', documentName: 'Item', parent: actor, isOwner: true, effects: new Map() };
    const effect = { id: 'effect', parent: item, isOwner: true };
    actor.items.set(item.id, item); item.effects.set(effect.id, effect);
    globalThis.game = { user: {}, actors: new Map([[actor.id, actor]]) };
    assert.equal(canEditWorkbenchEffect(effect), true);
    effect.canUserModify = () => false; assert.equal(canEditWorkbenchEffect(effect), false); delete effect.canUserModify;
    item.pack = 'readonly'; assert.equal(canEditWorkbenchEffect(effect), false); delete item.pack;
    game.actors.set(actor.id, { ...actor }); assert.equal(canEditWorkbenchEffect(effect), false); game.actors.set(actor.id, actor);
    actor.items.delete(item.id); assert.equal(canEditWorkbenchEffect(effect), false); actor.items.set(item.id, item);
    item.effects.delete(effect.id); assert.equal(canEditWorkbenchEffect(effect), false);
  } finally { globalThis.game = previous; }
});

for (const midi of [false, true]) for (const dae of [false, true]) {
  test(`Module field policy midi=${midi} dae=${dae} preserves stored extensions and activity references`, () => {
    class StringField { options = {}; }
    class BooleanField { options = {}; }
    const source = { type: 'attack', midiProperties: { autoConsume: false, triggeredActivityId: 'activity-target', extension: 'keep' }, flags: { 'midi-qol': { onUseMacroName: 'macro' } } };
    const activity = { type: 'attack', schema: { fields: midi ? { midiProperties: { fields: { autoConsume: new BooleanField(), triggeredActivityId: new StringField() } } } : {} }, toObject: () => structuredClone(source) };
    const original = structuredClone(source);
    const fields = readActivityCommonFields(activity);
    assert.equal(fields.some(field => field.path === 'midiProperties.autoConsume'), midi);
    assert.equal(fields.some(field => field.path === 'midiProperties.triggeredActivityId'), false);
    assert.deepEqual(buildActivityFieldUpdate(fields.map(field => ({ ...field, value: true }))), midi ? { 'midiProperties.autoConsume': true } : {});
    const effect = { flags: { dae: { stackable: 'multi', custom: 'keep' } } };
    // Stored DAE flags remain editable even while the module is inactive; this does not imply effect execution.
    assert.equal(effectFields(effect, { dae }).some(field => field.path === 'flags.dae.stackable'), true);
    assert.equal(effectFields({ flags: {} }, { dae, itemEffect: true }).some(field => field.path === 'flags.dae.stackable'), dae);
    assert.equal(effect.flags.dae.custom, 'keep');
    assert.deepEqual(source, original);
  });
}
