import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTokenPortraitDefault,
  isLeadActiveGm,
  migrateTokenPortraits,
  needsTokenPortraitDefault,
  TOKEN_PORTRAIT_MIGRATION_VERSION,
  tokenPortraitMigrationTargets,
} from '../scripts/shared/token-portrait-default.mjs';

function fakeActor(source) {
  return {
    id: source._id,
    name: source.name,
    type: source.type,
    _source: source,
    updates: [],
    updateSource(change) {
      this.updates.push(change);
    },
  };
}

test('only PC and NPC actors without the flag need the token default', () => {
  assert.equal(needsTokenPortraitDefault({ type: 'npc' }), true);
  assert.equal(needsTokenPortraitDefault({ type: 'character', flags: { dnd5e: {} } }), true);
  assert.equal(needsTokenPortraitDefault({ type: 'npc', flags: { dnd5e: { showTokenPortrait: null } } }), true);
  assert.equal(needsTokenPortraitDefault({ type: 'npc', flags: { dnd5e: { showTokenPortrait: false } } }), false);
  assert.equal(needsTokenPortraitDefault({ type: 'npc', flags: { dnd5e: { showTokenPortrait: true } } }), false);
  assert.equal(needsTokenPortraitDefault({ type: 'group' }), false);
  assert.equal(needsTokenPortraitDefault({ type: 'vehicle' }), false);
});

test('preCreateActor sets the token view only when the flag is unset', () => {
  const plain = fakeActor({ type: 'npc', flags: {} });
  assert.equal(applyTokenPortraitDefault(plain, {}), true);
  assert.deepEqual(plain.updates, [{ 'flags.dnd5e.showTokenPortrait': true }]);

  const off = fakeActor({ type: 'character', flags: { dnd5e: { showTokenPortrait: false } } });
  assert.equal(applyTokenPortraitDefault(off, {}), false);
  assert.deepEqual(off.updates, []);

  const group = fakeActor({ type: 'group', flags: {} });
  assert.equal(applyTokenPortraitDefault(group, {}), false);
});

test('only the first active GM by id leads the migration', () => {
  const users = [
    { id: 'b', active: true, isGM: true },
    { id: 'a', active: false, isGM: true },
    { id: 'c', active: true, isGM: true },
    { id: '0', active: true, isGM: false },
  ];
  assert.equal(isLeadActiveGm({ user: users[0], users }), true);
  assert.equal(isLeadActiveGm({ user: users[2], users }), false);
  assert.equal(isLeadActiveGm({ user: users[3], users }), false);
});

function fakeGame({ setting = 0, user = { id: 'gm', active: true, isGM: true } } = {}) {
  const actors = [
    fakeActor({ _id: 'a1', name: 'NPC', type: 'npc', flags: {} }),
    fakeActor({ _id: 'a2', name: 'PC', type: 'character', flags: { dnd5e: { showTokenPortrait: false } } }),
    fakeActor({ _id: 'a3', name: 'Already', type: 'npc', flags: { dnd5e: { showTokenPortrait: true } } }),
    fakeActor({ _id: 'a4', name: 'Group', type: 'group', flags: {} }),
  ];
  const calls = { updates: [], settings: [] };
  return {
    calls,
    user,
    users: [user],
    actors: Object.assign(actors, {
      documentClass: { updateDocuments: async (updates) => calls.updates.push(...updates) },
      get: (id) => actors.find((actor) => actor.id === id),
    }),
    settings: {
      get: () => setting,
      set: async (...args) => calls.settings.push(args),
    },
  };
}

test('migration targets skip actors whose flag is already decided', () => {
  const game = fakeGame();
  assert.deepEqual(tokenPortraitMigrationTargets(game.actors), [
    { id: 'a1', name: 'NPC', type: 'npc', showTokenPortrait: null },
  ]);
});

test('migration updates unset actors once and records the version', async () => {
  const game = fakeGame();
  const result = await migrateTokenPortraits(game);
  assert.deepEqual(result.updated.map((entry) => entry.id), ['a1']);
  assert.deepEqual(game.calls.updates, [{ _id: 'a1', 'flags.dnd5e.showTokenPortrait': true }]);
  assert.deepEqual(game.calls.settings, [['nihil-compendium-module', 'tokenPortraitMigration', TOKEN_PORTRAIT_MIGRATION_VERSION]]);

  const again = fakeGame({ setting: TOKEN_PORTRAIT_MIGRATION_VERSION });
  assert.deepEqual(await migrateTokenPortraits(again), { skipped: 'done' });
  assert.deepEqual(again.calls.updates, []);

  const player = fakeGame({ user: { id: 'p', active: true, isGM: false } });
  assert.deepEqual(await migrateTokenPortraits(player), { skipped: 'not-lead-gm' });
});
