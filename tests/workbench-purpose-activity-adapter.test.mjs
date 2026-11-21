import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/purpose-activity-adapter.mjs', import.meta.url);
async function load() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('purpose UI exposes Korean labels for common Activity purposes and types', async () => {
  const { ACTIVITY_PURPOSES, activityTypeLabel } = await load();
  assert.deepEqual(ACTIVITY_PURPOSES.map((entry) => [entry.value, entry.label]), [
    ['extraDamage', '추가 피해'],
    ['heal', '회복 효과'],
    ['save', '내성 공격'],
    ['status', '상태 효과'],
    ['advanced', '기타 / 고급'],
  ]);
  assert.equal(activityTypeLabel('attack'), '공격');
  assert.equal(activityTypeLabel('heal'), '회복');
  assert.equal(activityTypeLabel('save'), '내성 굴림');
  assert.equal(activityTypeLabel('unknown-type'), 'unknown-type');
});

test('quick heal maps user-facing range target area and formula into a Heal Activity source', async () => {
  const { buildQuickActivityData } = await load();
  const result = buildQuickActivityData('heal', {
    name: '치유 파동',
    rangeType: 'distance',
    rangeValue: '60',
    rangeUnits: 'ft',
    targetType: 'ally',
    targetCount: '2',
    areaType: 'circle',
    areaSize: '10',
    formula: '2d8 + 3',
    healingType: 'healing',
  });
  assert.equal(result.type, 'heal');
  assert.equal(result.data.name, '치유 파동');
  assert.deepEqual(result.data.range, { value: '60', units: 'ft', override: false, special: '' });
  assert.deepEqual(result.data.target, {
    affects: { type: 'ally', count: '2', choice: false, special: '' },
    template: { contiguous: false, units: 'ft', count: '', type: 'circle', size: '10' },
    override: false,
    prompt: true,
  });
  assert.deepEqual(result.data.healing, {
    custom: { enabled: true, formula: '2d8 + 3' },
    types: ['healing'],
    scaling: { number: 1 },
  });
});

test('quick save maps damage save DC and save-success behavior into a Save Activity source', async () => {
  const { buildQuickActivityData } = await load();
  const result = buildQuickActivityData('save', {
    name: '폭발',
    rangeType: 'distance',
    rangeValue: '150',
    rangeUnits: 'ft',
    targetType: 'creature',
    targetCount: '',
    areaType: 'circle',
    areaSize: '15',
    formula: '7d6',
    damageType: 'fire',
    saveAbility: 'dex',
    saveDc: '17',
    onSave: 'half',
  });
  assert.equal(result.type, 'save');
  assert.equal(result.data.damage.onSave, 'half');
  assert.deepEqual(result.data.damage.parts[0], {
    number: 7,
    denomination: 6,
    bonus: '',
    custom: { enabled: false, formula: '' },
    types: ['fire'],
  });
  assert.deepEqual(result.data.save, {
    ability: ['dex'],
    dc: { formula: '17', calculation: '' },
  });
  assert.equal(result.data.range.value, '150');
  assert.equal(result.data.target.template.type, 'circle');
  assert.equal(result.data.target.template.size, '15');
});

test('quick additional damage appends one damage part without replacing existing source fields', async () => {
  const { appendQuickDamage } = await load();
  let payload = null;
  const activity = {
    type: 'attack',
    toObject() {
      return {
        damage: {
          critical: { allow: true },
          parts: [{ number: 1, denomination: 8, bonus: '', types: ['slashing'], custom: { enabled: false, formula: '' }, marker: 'keep' }],
        },
      };
    },
    async update(update) { payload = update; return this; },
  };
  await appendQuickDamage(activity, { formula: '2d6 + 1', damageType: 'fire' });
  assert.equal(payload['damage.parts'].length, 2);
  assert.equal(payload['damage.parts'][0].marker, 'keep');
  assert.deepEqual(payload['damage.parts'][1], {
    number: 2,
    denomination: 6,
    bonus: '1',
    custom: { enabled: false, formula: '' },
    types: ['fire'],
  });
});

test('quick builders reject missing required formulas and unsupported extra-damage activities', async () => {
  const { buildQuickActivityData, appendQuickDamage } = await load();
  assert.throws(() => buildQuickActivityData('heal', { formula: '' }), /주사위식/);
  assert.throws(() => buildQuickActivityData('save', { formula: '2d6', saveAbility: '', saveDc: '' }), /내성/);
  await assert.rejects(() => appendQuickDamage({ type: 'utility', update() {} }, { formula: '1d6', damageType: 'fire' }), /추가 피해/);
});
