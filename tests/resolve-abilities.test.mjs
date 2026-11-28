import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESOLVE_SAVE_DC,
  applyRawScore,
  patchNonNpcAbilities,
  registerResolveAbilities,
  resolveAbilityKey,
  rollResolveSave,
  stripResolveAbilities,
} from '../scripts/resolve/abilities.mjs';

test('grit and will are registered as mental abilities modeled on wisdom', () => {
  const config = { abilities: { wis: { label: '지혜', abbreviation: '지혜', type: 'mental', icon: 'wis.svg' } } };
  assert.equal(registerResolveAbilities(config), true);
  assert.equal(config.abilities.grit.label, '투지');
  assert.equal(config.abilities.will.abbreviation, '의지');
  assert.equal(config.abilities.will.icon, 'wis.svg');
  assert.equal(config.abilities.wis.label, '지혜');
  assert.equal(registerResolveAbilities({}), false);
  assert.equal(resolveAbilityKey('투지'), 'grit');
  assert.equal(resolveAbilityKey('근력'), null);
});

test('grit and will stay on npcs and are removed from other actor types', () => {
  const seen = {};
  const make = (type) => class {
    prepareBaseData() {
      seen[type] = Object.keys(this.abilities);
    }
  };
  const models = { npc: make('npc'), character: make('character'), group: class {} };
  assert.equal(patchNonNpcAbilities(models), true);
  for (const type of ['npc', 'character']) {
    const data = new models[type]();
    data.abilities = { str: {}, grit: {}, will: {} };
    data.prepareBaseData();
  }
  assert.deepEqual(seen, { npc: ['str', 'grit', 'will'], character: ['str'] });
  assert.equal(patchNonNpcAbilities(models), false);
});

test('new non-npc actors drop grit and will from their source', () => {
  const pc = { type: 'character', _source: { system: { abilities: { str: {}, grit: {}, will: {} } } } };
  assert.equal(stripResolveAbilities(pc), true);
  assert.deepEqual(Object.keys(pc._source.system.abilities), ['str']);
  const npc = { type: 'npc', _source: { system: { abilities: { grit: {} } } } };
  assert.equal(stripResolveAbilities(npc), false);
});

test('a resolve save succeeds at DC 10 and reports the total', async () => {
  let asked;
  const actor = { rollSavingThrow: async (config) => { asked = config; return [{ total: 9 }]; } };
  assert.deepEqual(await rollResolveSave(actor, '의지'), { total: 9, success: false });
  assert.deepEqual(asked, { ability: 'will', target: RESOLVE_SAVE_DC });
  const held = { rollSavingThrow: async () => [{ total: 10 }] };
  assert.equal((await rollResolveSave(held, '투지')).success, true);
  const closed = { rollSavingThrow: async () => null };
  assert.equal(await rollResolveSave(closed, '투지'), null);
});

test('grit and will add their score with no modifier and start at 0', () => {
  const ability = { value: 3, mod: -4, check: { value: -4 }, save: { value: -2 }, dc: 6 };
  assert.equal(applyRawScore(ability), true);
  assert.deepEqual(ability, { value: 3, mod: 3, check: { value: 3 }, save: { value: 5 }, dc: 13 });
  const config = { abilities: { wis: {} } };
  registerResolveAbilities(config);
  assert.equal(config.abilities.grit.defaults.npc, 0);
});
