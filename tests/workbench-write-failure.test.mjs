import assert from 'node:assert/strict';
import test from 'node:test';
import { requireWriteResult, requireWritableItem } from '../scripts/workbench/write-result.mjs';
import { createItemWorkbenchPanel } from '../scripts/workbench/item-workbench-panel.mjs';
import { createActivity } from '../scripts/workbench/activity-adapter.mjs';
import { saveActivityExtraDamage } from '../scripts/workbench/item-adapter.mjs';
import { formInputEntries } from '../scripts/workbench/form-inputs.mjs';
import { itemEditSnapshot } from '../scripts/workbench/document-fields.mjs';

test('Cancelled basic, embedded, activity create and extra damage saves are failures', async () => {
  for (const result of [undefined, null, []]) assert.throws(() => requireWriteResult(result), /취소/);
  const item = { id: 'item', name: '원본', system: {}, update: async () => undefined };
  for (const result of [undefined, []]) {
    const panel = createItemWorkbenchPanel({ context: { item, update: async () => result } });
    await assert.rejects(panel.saveBasic({ name: '새 이름' }), /취소/);
    assert.equal(item.name, '원본');
  }
  await assert.rejects(createActivity({ system: { activities: [] }, createActivity: async () => undefined }, 'damage'), /취소/);
  await assert.rejects(saveActivityExtraDamage({ damage: { parts: [] }, update: async () => undefined }, []), /취소/);
});

async function fixture(run) {
  const previous = { foundry: globalThis.foundry, game: globalThis.game, ui: globalThis.ui, CONFIG: globalThis.CONFIG };
  class ApplicationV2 { render() { return this; } _onRender() {} async _prepareContext() { return {}; } }
  const errors = [], notices = [];
  globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: base => base } } };
  globalThis.CONFIG = {};
  globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map(), actors: new Map(), folders: new Map(), modules: new Map() };
  globalThis.ui = { notifications: { error: message => errors.push(message), info: message => notices.push(message) } };
  try { await run({ errors, notices }); }
  finally { Object.assign(globalThis, previous); }
}

const event = { preventDefault() {} };
function form(control) {
  return { querySelector: () => null, querySelectorAll: selector => ['input, textarea, select'].includes(selector) || selector.startsWith('[data-actor-edit]') ? [control] : [] };
}
async function fresh(path) { return import(`${new URL(path, import.meta.url).href}?test=${Date.now()}-${Math.random()}`); }

test('Deleted or forbidden item keeps its target key, recoverable values and failed save status', async () => {
  await fixture(async ({ errors, notices }) => {
    const { openWorkbench } = await fresh('../scripts/workbench/workbench-app.mjs');
    const source = { name: '원본', type: 'loot', system: {}, flags: {} };
    const item = { id: 'item', type: 'loot', isOwner: true, toObject: () => source };
    game.items.set(item.id, item);
    const app = openWorkbench(item.id);
    const control = { name: 'itemName', type: 'text', tagName: 'INPUT', dataset: {}, value: '원본' };
    app.form = form(control);
    app.initialInputs = new Map(formInputEntries(app.form).map(({ key, value }) => [key, value]));
    app.renderedSource = itemEditSnapshot(item);
    app.renderedInputKey = app.inputKey;
    control.value = '미저장 이름';
    item.isOwner = false;
    await app.constructor.DEFAULT_OPTIONS.form.handler.call(app, event, app.form);
    assert.equal(app.inputDraft.size, 1);
    assert.equal(app.submissionSucceeded, false);
    game.items.delete(item.id);
    const key = app.inputKey;
    const context = await app._prepareContext({});
    assert.equal(app.inputKey, key);
    assert.equal(context.missingTargetDraft[0].value, '미저장 이름');
    app.form = form(null); app.form.querySelectorAll = () => [];
    app._onRender(context, {});
    assert.equal(app.inputDraft.size, 1);
    await app.constructor.DEFAULT_OPTIONS.form.handler.call(app, event, app.form);
    assert.equal(app.submissionSucceeded, false);
    assert.equal(app.inputDraft.size, 1);
    assert.equal(notices.length, 0);
    assert.equal(errors.length, 2);
  });
});

test('Item write policy rejects pack, lost ownership and deleted or replaced Actor while folder moves preserve baseline', async () => {
  await fixture(async () => {
    const actor = { id: 'owner', isOwner: true, items: new Map() };
    const source = { name: '검', system: {}, folder: 'first' };
    const item = { id: 'item', parent: actor, isOwner: true, toObject: () => source };
    game.actors.set(actor.id, actor); actor.items.set(item.id, item);
    const baseline = itemEditSnapshot(item);
    source.folder = 'moved';
    assert.equal(itemEditSnapshot(item), baseline);
    assert.equal(requireWritableItem(item, true), item);
    item.pack = 'module.readonly'; assert.throws(() => requireWritableItem(item, true), /권한/); delete item.pack;
    actor.isOwner = false; assert.throws(() => requireWritableItem(item, true), /권한/); actor.isOwner = true;
    game.actors.set(actor.id, { ...actor }); assert.throws(() => requireWritableItem(item, true), /삭제/);
    game.actors.set(actor.id, actor); actor.items.delete(item.id); assert.throws(() => requireWritableItem(item, true), /삭제/);
  });
});

test('Actor cancelled save and external deletion preserve the last visible draft for copying', async () => {
  await fixture(async ({ errors, notices }) => {
    const module = await fresh('../scripts/workbench/actor-workbench-app.mjs');
    const source = { name: '원본', type: 'npc', img: '', system: {} };
    const actor = { id: 'actor', type: 'npc', name: '원본', isOwner: true, system: {}, toObject: () => structuredClone(source), update: async () => undefined };
    game.actors.set(actor.id, actor);
    const app = module.openActorWorkbench({ actorId: actor.id });
    app.renderedActorId = actor.id; app.renderedActorDocument = actor;
    const control = { name: 'actorName', type: 'text', value: '원본' };
    app.form = form(control); app.initialControls = { actorName: '원본' };
    control.value = '처음 입력';
    await app.constructor.DEFAULT_OPTIONS.actions.saveActor.call(app, event);
    assert.equal(app.drafts.records.get(actor.id).values.actorName, '처음 입력');
    assert.equal(notices.length, 0); assert.match(errors[0], /취소/);
    control.value = '삭제 직전 입력';
    game.actors.delete(actor.id);
    module.syncDeletedActor(actor.id);
    assert.equal(app.selectedActor, null);
    assert.equal(app.drafts.records.get(actor.id).values.actorName, '삭제 직전 입력');
    const context = await app._prepareContext({});
    assert.equal(context.deletedDrafts[0].fields[0].value, '삭제 직전 입력');
    await assert.rejects(app.saveActorDraft(actor), /삭제/);
    app.confirmChange = async () => false;
    await app.constructor.DEFAULT_OPTIONS.actions.discardDeletedActorDraft.call(app, event, { dataset: { actorId: actor.id } });
    assert.equal(app.drafts.records.size, 1);
    app.confirmChange = async () => true;
    await app.constructor.DEFAULT_OPTIONS.actions.discardDeletedActorDraft.call(app, event, { dataset: { actorId: actor.id } });
    assert.equal(app.drafts.records.size, 0);
  });
});

test('Cancelled Actor folder move retains selection and input without reporting success', async () => {
  await fixture(async ({ errors, notices }) => {
    const module = await fresh('../scripts/workbench/actor-workbench-app.mjs');
    const source = { name: '원본', type: 'npc', system: {} };
    const actor = { id: 'actor', type: 'npc', name: '원본', isOwner: true, folder: null, system: {}, toObject: () => structuredClone(source), update: async () => undefined };
    game.actors.set(actor.id, actor); game.folders.set('destination', { id: 'destination', type: 'Actor', name: '시험 폴더' });
    const app = module.openActorWorkbench({ actorId: actor.id });
    app.renderedActorId = actor.id; app.renderedActorDocument = actor;
    app.form = form({ name: 'actorName', type: 'text', value: '이동 전 미저장 입력' });
    app.initialControls = { actorName: '원본' };
    const moved = await app.onActorDrop({ ...event, stopPropagation() {}, currentTarget: { dataset: { actorDropFolder: 'destination' } }, dataTransfer: { getData: () => JSON.stringify({ type: 'Actor', uuid: 'Actor.actor' }) } });
    assert.equal(moved, false);
    assert.equal(app.selectedActor, actor);
    assert.equal(app.drafts.records.get(actor.id).values.actorName, '이동 전 미저장 입력');
    assert.equal(app.movingActorIds.size, 0);
    assert.equal(notices.length, 0); assert.match(errors[0], /취소/);
  });
});

test('Repeated Item transitions share one decision and release the guard after cancellation or dialog failure', async () => {
  await fixture(async () => {
    const { openWorkbench } = await fresh('../scripts/workbench/workbench-app.mjs');
    const source = { name: '원본', type: 'loot', system: {}, flags: {} };
    const item = { id: 'item', type: 'loot', isOwner: true, toObject: () => source };
    game.items.set(item.id, item);
    const app = openWorkbench(item.id);
    const control = { name: 'itemName', type: 'text', tagName: 'INPUT', dataset: {}, value: '원본' };
    app.form = form(control);
    app.initialInputs = new Map(formInputEntries(app.form).map(({ key, value }) => [key, value]));
    control.value = '미저장 입력';
    let decisions = 0, resolve;
    foundry.applications.api.DialogV2 = { wait: () => { decisions++; return new Promise(done => { resolve = done; }); } };
    const pending = app.guardItemTransition();
    assert.equal(await app.guardItemTransition(), false);
    assert.equal(await app.guardItemTransition(['itemName']), false);
    assert.equal(decisions, 1);
    resolve('cancel');
    assert.equal(await pending, false);
    assert.equal(app.transitionGuardPending, false);
    assert.equal(app.inputDraft.size, 1);
    foundry.applications.api.DialogV2.wait = async () => { throw new Error('dialog unavailable'); };
    await assert.rejects(app.guardItemTransition(), /dialog unavailable/);
    assert.equal(app.transitionGuardPending, false);
    assert.equal(app.inputDraft.size, 1);
    foundry.applications.api.DialogV2.wait = async () => 'discard';
    assert.equal(await app.guardItemTransition(), true);
    assert.equal(app.inputDraft.size, 0);
  });
});

test('Activity selectors retain unspecified and legacy source values without offering managed orders for creation', async () => {
  await fixture(async () => {
    CONFIG.DND5E = { abilities: { str: { label: '힘' }, dex: { label: '민첩' } }, individualTargetTypes: { self: { label: '자신' } }, activityTypes: { attack: { configurable: true }, order: { configurable: false } } };
    const { openWorkbench } = await fresh('../scripts/workbench/workbench-app.mjs');
    const source = { _id: 'activity', type: 'attack', name: '공격', target: { affects: {} }, attack: {} };
    const activity = { id: 'activity', type: 'attack', toObject: () => structuredClone(source) };
    const item = { id: 'item', type: 'weapon', name: '무기', isOwner: true,
      system: { activities: new Map([[activity.id, activity]]) },
      toObject: () => ({ name: '무기', type: 'weapon', system: { activities: { activity: structuredClone(source) } } }) };
    game.items.set(item.id, item);
    const app = openWorkbench(item.id);
    let context = await app._prepareContext({});
    assert.equal(context.selected.activityWorkspace.attackAbilityOptions.find(option => option.selected).value, '');
    assert.equal(context.selected.activityWorkspace.targetOptions.find(option => option.selected).value, '');
    assert.ok(!context.selected.activityWorkspaceNewTypeOptions.some(option => option.value === 'order'));
    source.attack.ability = 'legacy'; source.target.affects.type = 'legacy-target';
    app.activityWorkspaceDraft = null;
    context = await app._prepareContext({});
    assert.equal(context.selected.activityWorkspace.attackAbilityOptions.find(option => option.selected).value, 'legacy');
    assert.equal(context.selected.activityWorkspace.targetOptions.find(option => option.selected).value, 'legacy-target');
    assert.equal(source.attack.ability, 'legacy');
  });
});
