import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/item-adapter.mjs', import.meta.url);

async function loadAdapter() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function fixtureItem() {
  return {
    id: 'item1',
    uuid: 'Item.item1',
    name: 'Test Blade',
    type: 'weapon',
    img: 'icons/svg/sword.svg',
    system: {
      description: { value: '<p>Desc</p>' },
      identifier: 'test-blade',
      source: { book: 'PHB', page: '123', custom: '', license: 'SRD', rules: '2024', revision: 2, futureKey: 'preserve-me' },
      identified: false,
      unidentified: { name: 'Unknown Blade', description: '<p>Mysterious</p>' },
      quantity: 2,
      weight: { value: 3.5, units: 'lb' },
      price: { value: 25, denomination: 'gp' },
      rarity: 'rare',
      container: 'container-1',
      equipped: true,
      attunement: 'required',
      attuned: true,
      properties: new Set(['mgc', 'legacy-prop']),
      validProperties: new Set(['fin', 'mgc', 'two']),
      uses: { spent: 1, max: '3', recovery: [{ period: 'lr', type: 'recoverAll' }] },
      damage: {
        base: { number: 1, denomination: 8, bonus: '+2', types: new Set(['slashing']), custom: { enabled: false, formula: '' } },
      },
      activities: new Map([
        ['a1', {
          id: 'a1',
          name: 'Slash',
          type: 'attack',
          damage: { includeBase: true, parts: [{ number: 1, denomination: 6, bonus: '', types: new Set(['fire']), custom: { enabled: false, formula: '' } }] },
          effects: [{ _id: 'e1' }],
        }],
      ]),
    },
    effects: new Map([
      ['e1', { id: 'e1', name: 'Burning', transfer: false, disabled: false, statuses: new Set(['burning']), changes: [], duration: { rounds: 1 } }],
      ['e2', { id: 'e2', name: 'Passive AC', transfer: true, disabled: false, statuses: new Set(), changes: [{ key: 'system.attributes.ac.bonus', mode: 2, value: '1', priority: 20 }], duration: {} }],
      ['e3', { id: 'e3', name: 'Other Target Effect', transfer: false, disabled: false, statuses: new Set(['prone']), changes: [], duration: {} }],
    ]),
  };
}

test('reads a stable workbench model without exposing raw document internals', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const model = readItemWorkbenchModel(fixtureItem(), 'a1');

  assert.equal(model.id, 'item1');
  assert.equal(model.name, 'Test Blade');
  assert.equal(model.selectedActivity.type, 'attack');
  assert.deepEqual(model.selectedActivity.baseDamage, {
    number: 1, denomination: 8, bonus: '+2', types: ['slashing'], customFormula: null,
  });
  assert.deepEqual(model.selectedActivity.extraDamage, [{
    number: 1, denomination: 6, bonus: '', types: ['fire'], customFormula: null,
  }]);
  assert.deepEqual(model.selectedActivity.effectRefs, [{ effectId: 'e1', onSave: null }]);
  assert.deepEqual(model.uses.recovery, [{ period: 'lr', type: 'recoverAll', formula: '' }]);
  assert.deepEqual(model.effects.onHit.map(e => e.id), ['e1']);
  assert.deepEqual(model.effects.passive.map(e => e.id), ['e2']);
  assert.deepEqual(model.effects.availableTarget.map(e => e.id), ['e3']);
});

test('CORE-001 reads identifier and all native source fields into the workbench model', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const model = readItemWorkbenchModel(fixtureItem(), 'a1');

  assert.equal(model.identifier, 'test-blade');
  assert.deepEqual(model.source, {
    book: 'PHB', page: '123', custom: '', license: 'SRD', rules: '2024', revision: 2,
  });
});

test('CORE-001 builds dotted identifier/source updates without replacing the source object', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const update = buildBasicItemUpdate({
    identifier: 'renamed-blade',
    source: { book: 'DMG', page: '45', custom: 'Homebrew', license: '', rules: '2014', revision: 3 },
  });

  assert.deepEqual(update, {
    'system.identifier': 'renamed-blade',
    'system.source.book': 'DMG',
    'system.source.page': '45',
    'system.source.custom': 'Homebrew',
    'system.source.license': '',
    'system.source.rules': '2014',
    'system.source.revision': 3,
  });
  assert.equal('system.source' in update, false);
});

test('CORE-002 reads identification state and unidentified name/description when supported', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const model = readItemWorkbenchModel(fixtureItem(), 'a1');

  assert.equal(model.hasIdentification, true);
  assert.deepEqual(model.identification, {
    identified: false,
    name: 'Unknown Blade',
    description: '<p>Mysterious</p>',
  });
});

test('CORE-002 builds identification updates only for Item types that support identification', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const form = { identification: { identified: true, name: 'Unknown Relic', description: '<p>Unknown</p>' } };

  assert.deepEqual(buildBasicItemUpdate(form, { hasIdentification: true }), {
    'system.identified': true,
    'system.unidentified.name': 'Unknown Relic',
    'system.unidentified.description': '<p>Unknown</p>',
  });
  assert.deepEqual(buildBasicItemUpdate(form, { hasIdentification: false }), {});
});

test('CORE-003 reads inventory/economy fields when the Item supports them', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const model = readItemWorkbenchModel(fixtureItem(), 'a1');

  assert.equal(model.hasInventory, true);
  assert.deepEqual(model.inventory, {
    quantity: 2,
    weight: { value: 3.5, units: 'lb' },
    price: { value: 25, denomination: 'gp' },
    rarity: 'rare',
    containerId: 'container-1',
  });
});

test('CORE-003 builds dotted inventory/economy updates only for supported Items', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const form = { inventory: {
    quantity: 4,
    weight: { value: 2, units: 'kg' },
    price: { value: 12.5, denomination: 'sp' },
    rarity: 'legendary',
    containerId: 'container-2',
  } };
  assert.deepEqual(buildBasicItemUpdate(form, { hasInventory: true }), {
    'system.quantity': 4,
    'system.weight.value': 2,
    'system.weight.units': 'kg',
    'system.price.value': 12.5,
    'system.price.denomination': 'sp',
    'system.rarity': 'legendary',
    'system.container': 'container-2',
  });
  assert.deepEqual(buildBasicItemUpdate(form, { hasInventory: false }), {});
});

test('CORE-004 reads equipped and attunement state only when supported', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const model = readItemWorkbenchModel(fixtureItem(), 'a1');
  assert.equal(model.hasEquipAttunement, true);
  assert.deepEqual(model.equipAttunement, { equipped: true, attunement: 'required', attuned: true });
});

test('CORE-004 builds equipped and attunement updates only for supported Items', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const form = { equipAttunement: { equipped: false, attunement: 'optional', attuned: false } };
  assert.deepEqual(buildBasicItemUpdate(form, { hasEquipAttunement: true }), {
    'system.equipped': false,
    'system.attunement': 'optional',
    'system.attuned': false,
  });
  assert.deepEqual(buildBasicItemUpdate(form, { hasEquipAttunement: false }), {});
});

test('CORE-005 reads valid and existing properties without losing unknown existing values', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const model = readItemWorkbenchModel(fixtureItem(), 'a1');
  assert.equal(model.hasProperties, true);
  assert.deepEqual(model.properties, ['legacy-prop', 'mgc']);
  assert.deepEqual(model.validProperties, ['fin', 'mgc', 'two']);
});

test('CORE-005 replaces the properties set only when the Item supports properties', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  assert.deepEqual(buildBasicItemUpdate({ properties: ['fin', 'legacy-prop'] }, { hasProperties: true }), {
    'system.properties': ['fin', 'legacy-prop'],
  });
  assert.deepEqual(buildBasicItemUpdate({ properties: ['fin'] }, { hasProperties: false }), {});
});

test('parses supported simple damage formulas and preserves custom formulas', async () => {
  const { parseSimpleDamageFormula, damagePartFromFormula } = await loadAdapter();

  assert.deepEqual(parseSimpleDamageFormula('2d6 + 3'), { number: 2, denomination: 6, bonus: '3' });
  assert.deepEqual(parseSimpleDamageFormula('1d8-2'), { number: 1, denomination: 8, bonus: '-2' });
  assert.deepEqual(parseSimpleDamageFormula('2d6 + @mod'), { number: 2, denomination: 6, bonus: '@mod' });
  assert.deepEqual(damagePartFromFormula('2d6 + @mod', 'fire'), {
    number: 2, denomination: 6, bonus: '@mod',
    custom: { enabled: false, formula: '' },
    types: ['fire'],
  });
});

test('CORE-006 preserves formula max, multiple recovery rows, and autoDestroy', async () => {
  const { readUses, buildUsesUpdate } = await loadAdapter();
  const model = readUses({
    spent: 1,
    max: '@prof',
    recovery: [
      { period: 'sr', type: 'recoverAll' },
      { period: 'dawn', type: 'formula', formula: '1d4' },
      { period: 'recharge', type: 'loseAll', formula: '5' },
    ],
    autoDestroy: true,
  });
  assert.deepEqual(model, {
    spent: 1,
    max: '@prof',
    recovery: [
      { period: 'sr', type: 'recoverAll', formula: '' },
      { period: 'dawn', type: 'formula', formula: '1d4' },
      { period: 'recharge', type: 'loseAll', formula: '5' },
    ],
    hasAutoDestroy: true,
    autoDestroy: true,
  });
  assert.deepEqual(buildUsesUpdate(model), {
    'system.uses.spent': 1,
    'system.uses.max': '@prof',
    'system.uses.recovery': [
      { period: 'sr', type: 'recoverAll' },
      { period: 'dawn', type: 'formula', formula: '1d4' },
      { period: 'recharge', type: 'recoverAll', formula: '5' },
    ],
    'system.uses.autoDestroy': true,
  });
});

test('basic update plan only contains explicitly supported fields', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const update = buildBasicItemUpdate({
    name: 'Renamed',
    img: 'icons/svg/fire.svg',
    description: '<p>New</p>',
    uses: { spent: 0, max: '2', recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }] },
    baseDamageFormula: '2d8 + 4',
    baseDamageType: 'fire',
  }, { hasBaseDamage: true });

  assert.deepEqual(update, {
    name: 'Renamed',
    img: 'icons/svg/fire.svg',
    'system.description.value': '<p>New</p>',
    'system.uses.spent': 0,
    'system.uses.max': '2',
    'system.uses.recovery': [{ period: 'lr', type: 'recoverAll' }],
    'system.damage.base.number': 2,
    'system.damage.base.denomination': 8,
    'system.damage.base.bonus': '4',
    'system.damage.base.types': ['fire'],
    'system.damage.base.custom.enabled': false,
    'system.damage.base.custom.formula': '',
  });
  assert.equal('system.activities' in update, false);
  assert.equal('effects' in update, false);
});

test('attaches and detaches activity effect references without replacing unrelated references', async () => {
  const { attachEffectRef, detachEffectRef } = await loadAdapter();
  const refs = [{ _id: 'a', level: {} }, { _id: 'b', onSave: false }];
  assert.deepEqual(attachEffectRef(refs, 'c'), [{ _id: 'a', level: {} }, { _id: 'b', onSave: false }, { _id: 'c' }]);
  assert.deepEqual(attachEffectRef(refs, 'a'), refs);
  assert.deepEqual(detachEffectRef(refs, 'a'), [{ _id: 'b', onSave: false }]);
});

test('builds minimal ActiveEffect payloads for on-hit conditions and passive changes', async () => {
  const { buildOnHitStatusEffectData, buildPassiveEffectData } = await loadAdapter();

  assert.deepEqual(buildOnHitStatusEffectData({ name: 'Prone', statusId: 'prone', rounds: 2 }), {
    name: 'Prone',
    transfer: false,
    disabled: false,
    statuses: ['prone'],
    system: { changes: [] },
    duration: { value: 2, units: 'rounds' },
    flags: { 'nihil-compendium-module': { workbench: { role: 'onHit' } } },
  });

  assert.deepEqual(buildPassiveEffectData({ name: 'AC +1', key: 'system.attributes.ac.bonus', mode: 2, value: '1' }), {
    name: 'AC +1',
    transfer: true,
    disabled: false,
    statuses: [],
    system: { changes: [{ key: 'system.attributes.ac.bonus', type: 'add', value: '1', phase: 'initial', priority: null }] },
    flags: { 'nihil-compendium-module': { workbench: { role: 'passive' } } },
  });
});

test('saves basic item fields through a partial Item.update call', async () => {
  const { saveBasicItem } = await loadAdapter();
  const calls = [];
  const item = {
    system: { damage: { base: {} } },
    async update(data) { calls.push(data); return this; },
  };

  await saveBasicItem(item, {
    name: 'Saved Blade',
    img: 'icons/svg/sword.svg',
    description: '<p>Saved</p>',
    uses: { spent: 1, max: 3, recoveryKind: 'shortRest' },
    baseDamageFormula: '1d10 + 3',
    baseDamageType: 'slashing',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Saved Blade');
  assert.equal(calls[0]['system.damage.base.denomination'], 10);
  assert.equal('system.activities' in calls[0], false);
});

test('updates only selected Activity extra damage parts', async () => {
  const { saveActivityExtraDamage } = await loadAdapter();
  const calls = [];
  const activity = {
    async update(data) { calls.push(data); return this; },
  };

  await saveActivityExtraDamage(activity, [
    { formula: '1d6', type: 'fire' },
    { formula: '2d4 + @mod', type: 'cold' },
  ]);

  assert.deepEqual(calls, [{
    'damage.parts': [
      { number: 1, denomination: 6, bonus: '', custom: { enabled: false, formula: '' }, types: ['fire'] },
      { number: 2, denomination: 4, bonus: '@mod', custom: { enabled: false, formula: '' }, types: ['cold'] },
    ],
  }]);
});

test('attaches and detaches existing embedded effects through Activity.update', async () => {
  const { setActivityEffectAttached } = await loadAdapter();
  const calls = [];
  const activity = {
    effects: [{ _id: 'a', level: {} }, { _id: 'b', onSave: false }],
    async update(data) { calls.push(data); this.effects = data.effects; return this; },
  };

  await setActivityEffectAttached(activity, 'c', true);
  await setActivityEffectAttached(activity, 'a', false);

  assert.deepEqual(calls, [
    { effects: [{ _id: 'a', level: {} }, { _id: 'b', onSave: false }, { _id: 'c' }] },
    { effects: [{ _id: 'b', onSave: false }, { _id: 'c' }] },
  ]);
});

test('creates an on-hit status effect and attaches only its reference to the Activity', async () => {
  const { createOnHitStatusEffect } = await loadAdapter();
  const activityCalls = [];
  const embeddedCalls = [];
  const effect = { id: 'newEffect' };
  const item = {
    async createEmbeddedDocuments(type, data) { embeddedCalls.push({ type, data }); return [effect]; },
  };
  const activity = {
    effects: [{ _id: 'existing' }],
    async update(data) { activityCalls.push(data); this.effects = data.effects; return this; },
  };

  const created = await createOnHitStatusEffect(item, activity, {
    name: '넘어짐', statusId: 'prone', rounds: 1,
  });

  assert.equal(created, effect);
  assert.equal(embeddedCalls[0].type, 'ActiveEffect');
  assert.deepEqual(embeddedCalls[0].data[0].statuses, ['prone']);
  assert.deepEqual(activityCalls[0], { effects: [{ _id: 'existing' }, { _id: 'newEffect' }] });
});

test('deletes an on-hit effect and removes its references from every Activity', async () => {
  const { deleteOnHitEffect } = await loadAdapter();
  const deleted = [];
  const firstActivity = {
    effects: [{ _id: 'target-effect', level: {} }, { _id: 'keep-first' }],
    async update(data) { this.effects = data.effects; return this; },
  };
  const secondActivity = {
    effects: [{ _id: 'keep-second' }, { _id: 'target-effect', onSave: false }],
    async update(data) { this.effects = data.effects; return this; },
  };
  const unrelatedActivity = {
    effects: [{ _id: 'unrelated-effect' }],
    async update(data) { this.effects = data.effects; return this; },
  };
  const effects = new Map([
    ['target-effect', { id: 'target-effect', name: '검증 중독' }],
    ['unrelated-effect', { id: 'unrelated-effect', name: '유지 효과' }],
  ]);
  const item = {
    effects,
    system: {
      activities: new Map([
        ['first', firstActivity],
        ['second', secondActivity],
        ['unrelated', unrelatedActivity],
      ]),
    },
    async deleteEmbeddedDocuments(type, ids) {
      deleted.push({ type, ids });
      const result = ids.map(id => effects.get(id)).filter(Boolean);
      for (const id of ids) effects.delete(id);
      return result;
    },
  };

  await deleteOnHitEffect(item, 'target-effect');

  assert.deepEqual(deleted, [{ type: 'ActiveEffect', ids: ['target-effect'] }]);
  assert.equal(effects.has('target-effect'), false);
  assert.deepEqual(firstActivity.effects, [{ _id: 'keep-first' }]);
  assert.deepEqual(secondActivity.effects, [{ _id: 'keep-second' }]);
  assert.deepEqual(unrelatedActivity.effects, [{ _id: 'unrelated-effect' }]);
});

test('creates a passive effect without altering activities', async () => {
  const { createPassiveEffect } = await loadAdapter();
  const calls = [];
  const effect = { id: 'passive1' };
  const item = {
    async createEmbeddedDocuments(type, data) { calls.push({ type, data }); return [effect]; },
  };

  const created = await createPassiveEffect(item, {
    name: 'AC +1', key: 'system.attributes.ac.bonus', mode: 2, value: '1',
  });

  assert.equal(created, effect);
  assert.equal(calls[0].type, 'ActiveEffect');
  assert.equal(calls[0].data[0].transfer, true);
});

test('reads only raw Activity extra damage and excludes synthesized base damage parts', async () => {
  const { readItemWorkbenchModel } = await loadAdapter();
  const item = fixtureItem();
  const activity = item.system.activities.get('a1');
  activity.damage.parts = [
    { number: 1, denomination: 8, bonus: '+2', types: new Set(['slashing']), custom: { enabled: false, formula: '' }, base: true, locked: true },
    { number: 1, denomination: 6, bonus: '', types: new Set(['fire']), custom: { enabled: false, formula: '' } },
  ];
  activity.toObject = () => ({
    damage: {
      includeBase: true,
      parts: [
        { number: 1, denomination: 6, bonus: '', types: ['fire'], custom: { enabled: false, formula: '' } },
      ],
    },
    effects: [{ _id: 'e1' }],
  });

  const model = readItemWorkbenchModel(item, 'a1');
  assert.deepEqual(model.selectedActivity.extraDamage, [{
    number: 1, denomination: 6, bonus: '', types: ['fire'], customFormula: null,
  }]);
});

test('preserves non-enumerable Activity effect reference ids and unknown fields during attach', async () => {
  const { setActivityEffectAttached } = await loadAdapter();
  const calls = [];
  const reference = { level: { min: 1 } };
  Object.defineProperty(reference, '_id', {
    value: 'existing',
    enumerable: false,
    configurable: true,
  });
  const activity = {
    effects: [reference],
    toObject() {
      return { effects: [{ _id: 'existing', level: { min: 1 }, onSave: false }] };
    },
    async update(data) { calls.push(data); this.effects = data.effects; return this; },
  };

  await setActivityEffectAttached(activity, 'new-effect', true);

  assert.deepEqual(calls, [{
    effects: [
      { _id: 'existing', level: { min: 1 }, onSave: false },
      { _id: 'new-effect' },
    ],
  }]);
});

test('formats D&D5e numeric damage bonuses as explicit signed formulas', async () => {
  const { formatDamagePartFormula } = await loadAdapter();

  assert.equal(formatDamagePartFormula({ number: 1, denomination: 12, bonus: '3', customFormula: null }), '1d12 + 3');
  assert.equal(formatDamagePartFormula({ number: 2, denomination: 6, bonus: '+4', customFormula: null }), '2d6 + 4');
  assert.equal(formatDamagePartFormula({ number: 1, denomination: 8, bonus: '-2', customFormula: null }), '1d8 - 2');
  assert.equal(formatDamagePartFormula({ number: 0, denomination: 0, bonus: '', customFormula: '2d6 + @mod' }), '2d6 + @mod');
});

test('basic update plan preserves multiple selected base damage types', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const update = buildBasicItemUpdate({
    name: 'Multi Type Blade',
    img: 'icons/svg/sword.svg',
    description: '',
    uses: { spent: 0, max: null, recoveryKind: 'none' },
    baseDamageFormula: '1d12 + 3',
    baseDamageTypes: ['cold', 'lightning', 'acid', 'slashing', 'fire', 'necrotic'],
  }, { hasBaseDamage: true });

  assert.deepEqual(update['system.damage.base.types'], [
    'cold', 'lightning', 'acid', 'slashing', 'fire', 'necrotic',
  ]);
  assert.equal(update['system.damage.base.number'], 1);
  assert.equal(update['system.damage.base.denomination'], 12);
  assert.equal(update['system.damage.base.bonus'], '3');
});


test('preserves formula-only Activity damage as a bonus-only D&D5e part', async () => {
  const { formatDamagePartFormula, damagePartFromFormula } = await loadAdapter();
  const source = {
    number: 0,
    denomination: 0,
    bonus: '@abilities.cha.mod',
    types: ['thunder'],
    customFormula: null,
  };

  assert.equal(formatDamagePartFormula(source), '@abilities.cha.mod');
  assert.deepEqual(damagePartFromFormula('@abilities.cha.mod', ['thunder']), {
    number: null,
    denomination: null,
    bonus: '@abilities.cha.mod',
    custom: { enabled: false, formula: '' },
    types: ['thunder'],
  });
});

test('basic update builder can omit untouched uses and damage paths', async () => {
  const { buildBasicItemUpdate } = await loadAdapter();
  const update = buildBasicItemUpdate({ name: 'Only Name' }, { hasBaseDamage: true });

  assert.deepEqual(update, { name: 'Only Name' });
});

test('extra damage saver preserves multiple selected damage types', async () => {
  const { saveActivityExtraDamage } = await loadAdapter();
  const calls = [];
  const activity = { async update(data) { calls.push(data); return this; } };

  await saveActivityExtraDamage(activity, [{
    formula: '1d6 + 2',
    types: ['fire', 'radiant'],
  }]);

  assert.deepEqual(calls, [{
    'damage.parts': [{
      number: 1,
      denomination: 6,
      bonus: '2',
      custom: { enabled: false, formula: '' },
      types: ['fire', 'radiant'],
    }],
  }]);
});
