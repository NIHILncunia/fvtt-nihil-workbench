import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advancementSourceList,
  appendAdvancementSource,
  hasAdvancementSource,
} from '../scripts/shared/advancement-source.mjs';
import {
  changeTypeOf,
  effectChangeTypeOptions,
  effectChangesOf,
  isValidChangeType,
  normalizeEffectChange,
} from '../scripts/shared/effect-change-types.mjs';
import { buildEffectDuration } from '../scripts/content/effect-duration.mjs';
import { effectStartPatch } from '../scripts/workbench/effect-workbench-app.mjs';
import { rebaseItemDraftSnapshot } from '../scripts/workbench/save-state.mjs';

test('dnd5e 5.3+ advancement sources are read as lists from objects, arrays and collections', () => {
  const object = { a: { _id: 'a', type: 'HitPoints' }, b: { _id: 'b', type: 'Size' } };
  assert.deepEqual(advancementSourceList(object).map((entry) => entry._id), ['a', 'b']);
  assert.deepEqual(advancementSourceList([object.a]).map((entry) => entry._id), ['a']);
  assert.deepEqual(advancementSourceList(new Map([['a', object.a]])).map((entry) => entry._id), ['a']);
  assert.deepEqual(advancementSourceList(null), []);
  assert.equal(hasAdvancementSource({}), true);
  assert.equal(hasAdvancementSource(undefined), false);
  assert.deepEqual(appendAdvancementSource(object, { _id: 'c' }), { ...object, c: { _id: 'c' } });
  assert.deepEqual(appendAdvancementSource([object.a], { _id: 'c' }), [object.a, { _id: 'c' }]);
});

test('v14 effect change types map legacy numeric modes and validate type strings', () => {
  assert.equal(changeTypeOf({ mode: 2 }), 'add');
  assert.equal(changeTypeOf({ mode: 0 }), 'custom');
  assert.equal(changeTypeOf({ mode: 7 }), 'custom.7');
  assert.equal(changeTypeOf({ type: 'dnd5e.bonus', mode: 2 }), 'dnd5e.bonus');
  assert.deepEqual(normalizeEffectChange({ key: 'a', mode: 5, value: '1' }), { key: 'a', type: 'override', value: '1' });
  assert.equal(isValidChangeType('add'), true);
  assert.equal(isValidChangeType('custom.3'), true);
  assert.equal(isValidChangeType('dnd5e.bonus'), true);
  assert.equal(isValidChangeType('2'), false);
  assert.equal(isValidChangeType('a b'), false);
  assert.deepEqual(effectChangesOf({ system: { changes: [{ key: 'x' }] } }), [{ key: 'x' }]);
  assert.deepEqual(effectChangesOf({ changes: [{ key: 'y' }] }), [{ key: 'y' }]);
  const options = effectChangeTypeOptions('module.special');
  assert.ok(options.some((option) => option.value === 'subtract'));
  assert.ok(options.some((option) => option.value === 'module.special' && option.selected));
});

test('effect durations convert v13 shapes into v14 duration and start data', () => {
  assert.deepEqual(buildEffectDuration({ rounds: 2, startRound: 1, combat: 'c1' }), {
    duration: { value: 2, units: 'rounds' },
    start: { round: 1, combat: 'c1' },
  });
  assert.deepEqual(buildEffectDuration({ seconds: 60, rounds: 2 }), {
    duration: { value: 60, units: 'seconds' },
    start: null,
  });
  assert.deepEqual(buildEffectDuration({ value: 3, units: 'turns', expiry: 'turnEnd' }), {
    duration: { value: 3, units: 'turns', expiry: 'turnEnd' },
    start: null,
  });
  assert.throws(() => buildEffectDuration({ rounds: 2, units: 'rounds' }), /섞지/);
  assert.throws(() => buildEffectDuration({ value: 2, units: 'weeks' }), /단위/);
});

test('partial start edits on an effect without start data become a full v14 start object', () => {
  assert.deepEqual(
    effectStartPatch({ name: 'x', 'start.round': 2 }, { start: null }, 500),
    { name: 'x', start: { combat: null, combatant: null, initiative: null, round: 2, turn: null, time: 500 } },
  );
  const patch = { 'start.round': 2 };
  assert.equal(effectStartPatch(patch, { start: { time: 1 } }, 500), patch);
});

test('advancement saves rebase object-keyed advancement sources', () => {
  const baseline = JSON.stringify({ name: 'x', system: { advancement: { a: { _id: 'a', value: 1 }, b: { _id: 'b', value: 2 } } } });
  const item = {
    toObject: () => ({ name: 'x', system: { advancement: { a: { _id: 'a', value: 5 }, b: { _id: 'b', value: 2 } } } }),
  };
  const rebased = JSON.parse(rebaseItemDraftSnapshot(baseline, item, [{ advancementId: 'a' }]));
  assert.equal(rebased.system.advancement.a.value, 5);
  assert.equal(rebased.system.advancement.b.value, 2);
  const removed = { toObject: () => ({ name: 'x', system: { advancement: { b: { _id: 'b', value: 2 } } } }) };
  assert.deepEqual(Object.keys(JSON.parse(rebaseItemDraftSnapshot(baseline, removed, [{ advancementId: 'a' }])).system.advancement), ['b']);
});

test('workbench access opens for full gamemasters and legacy users, not assistants', async () => {
  const { isWorkbenchUser } = await import('../scripts/shared/workbench-access.mjs');
  assert.equal(isWorkbenchUser({ id: 'rXB1GcSui4mDsgAn', role: 1 }), true);
  assert.equal(isWorkbenchUser({ id: 'ai2', role: 4 }), true);
  assert.equal(isWorkbenchUser({ id: 'assistant', role: 3 }), false);
  assert.equal(isWorkbenchUser({ id: 'player', role: 1 }), false);
  assert.equal(isWorkbenchUser(null), false);
});

test('deletions use the v14 ForcedDeletion operator when available and legacy keys otherwise', async () => {
  const { addDeletion } = await import('../scripts/shared/deletion.mjs');
  assert.deepEqual(addDeletion({}, 'flags.dae.showIcon'), { 'flags.dae.-=showIcon': null });
  const previous = globalThis._del;
  const operator = { forced: true };
  globalThis._del = operator;
  try {
    const update = addDeletion({}, 'prototypeToken.detectionModes.seeAll');
    assert.equal(update['prototypeToken.detectionModes.seeAll'], operator);
  } finally {
    if (previous === undefined) delete globalThis._del;
    else globalThis._del = previous;
  }
});

test('legacy DAE showIcon flags are shown as always and migrated on save', async () => {
  const { effectFields, migrateLegacyShowIcon } = await import('../scripts/workbench/effect-fields.mjs');
  const legacy = { name: 'x', showIcon: 1, flags: { dae: { showIcon: true } }, system: { changes: [] } };
  const field = effectFields(legacy).find((entry) => entry.path === 'showIcon');
  assert.equal(field.initial, '2');
  assert.deepEqual(migrateLegacyShowIcon({ name: 'y' }, legacy), { showIcon: 2, name: 'y', 'flags.dae.-=showIcon': null });
  assert.deepEqual(migrateLegacyShowIcon({ name: 'y' }, { flags: {} }), { name: 'y' });
  const modern = effectFields({ name: 'x', showIcon: 0, flags: {}, system: { changes: [] } }).find((entry) => entry.path === 'showIcon');
  assert.equal(modern.options.find((option) => option.selected).value, '0');
  assert.ok(!effectFields({ flags: {} }, { dae: true }).some((entry) => entry.path === 'flags.dae.showIcon'));
});
