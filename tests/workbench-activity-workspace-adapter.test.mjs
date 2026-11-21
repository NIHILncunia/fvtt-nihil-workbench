import assert from 'node:assert/strict';
import test from 'node:test';

test('System-managed facility order rejects discarded name and standard data', async () => {
  const { readActivityWorkspace, buildActivityWorkspaceUpdate, buildActivityWorkspaceCreateData } = await load();
  const source = { _id: 'order', type: 'order', order: 'build', name: 'Build', flags: { custom: 'keep' } };
  const document = activity(source);
  const form = readActivityWorkspace(document);
  assert.deepEqual(buildActivityWorkspaceUpdate(document, form), {});
  assert.throws(() => buildActivityWorkspaceUpdate(document, { ...form, name: '시험 건설' }), /시스템이 관리/);
  for (const [key, value] of Object.entries({ activation: { type: 'action' }, uses: { max: '2' }, range: { value: '30' }, target: { count: '1' } })) {
    assert.throws(() => buildActivityWorkspaceUpdate(document, { ...form, [key]: value }), /지원하지/);
  }
  assert.throws(() => buildActivityWorkspaceCreateData('order', { name: 'Unsupported' }), /자동 생성/);
  assert.deepEqual(source.flags, { custom: 'keep' });
  assert.equal(source.name, 'Build');
});

const MODULE_URL = new URL('../scripts/workbench/activity-workspace-adapter.mjs', import.meta.url);

async function load() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function activity(source) {
  return {
    id: source._id,
    type: source.type,
    toObject() {
      return structuredClone(source);
    },
  };
}

function midiDamageForm(overrides = {}) {
  return {
    name: 'NCM Midi Damage',
    activation: { type: 'action', value: '1', condition: '대상을 볼 수 있을 때' },
    uses: {
      spent: '0',
      max: '3',
      recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }],
    },
    range: { value: '60', units: 'ft', special: '' },
    target: {
      type: 'creature',
      count: '1',
      special: '',
      template: { type: 'sphere', size: '10', units: 'ft' },
    },
    damageRows: [{ formula: '2d6 + 1', types: ['fire'] }],
    attack: { ability: 'str', bonus: '2' },
    ...overrides,
  };
}

test('ACT-006 reads an Attack Activity into the standard Composer fields', async () => {
  const { readActivityWorkspace } = await load();
  const workspace = readActivityWorkspace(activity({
    _id: 'attack-1',
    type: 'attack',
    name: '천둥 베기',
    activation: { type: 'action', value: 1, condition: '돌진 후' },
    uses: { spent: 1, max: '3', recovery: [{ period: 'lr', type: 'recoverAll' }] },
    range: { value: '60', units: 'ft' },
    target: {
      affects: { type: 'creature', count: '1' },
      template: { type: 'sphere', size: '10', units: 'ft' },
    },
    damage: {
      parts: [{
        number: 2,
        denomination: 6,
        bonus: '1',
        custom: { enabled: false, formula: '' },
        types: ['thunder'],
      }],
    },
    attack: { ability: 'str', bonus: '2' },
  }));

  assert.deepEqual(workspace, {
    id: 'attack-1',
    type: 'attack',
    name: '천둥 베기',
    activation: { type: 'action', value: '1', condition: '돌진 후' },
    uses: {
      spent: '1',
      max: '3',
      recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }],
    },
    range: { value: '60', units: 'ft', special: '' },
    target: {
      type: 'creature',
      count: '1',
      special: '',
      template: { type: 'sphere', size: '10', units: 'ft' },
    },
    damageRows: [{ formula: '2d6 + 1', types: ['thunder'] }],
    healing: { formula: '', types: [] },
    attack: { ability: 'str', bonus: '2' },
    save: { abilities: [], dc: '', calculation: '', onSave: '' },
  });
});

test('ACT-006 builds a complete Midi Damage create source from standard Composer input', async () => {
  const { buildActivityWorkspaceCreateData } = await load();
  const data = buildActivityWorkspaceCreateData('attack', midiDamageForm());

  assert.deepEqual(data, {
    name: 'NCM Midi Damage',
    activation: { type: 'action', value: 1, condition: '대상을 볼 수 있을 때' },
    uses: {
      spent: 0,
      max: '3',
      recovery: [{ period: 'lr', type: 'recoverAll' }],
    },
    range: { value: '60', units: 'ft' },
    target: {
      affects: { type: 'creature', count: '1' },
      template: { type: 'sphere', size: '10', units: 'ft' },
    },
    damage: {
      parts: [{
        number: 2,
        denomination: 6,
        bonus: '1',
        custom: { enabled: false, formula: '' },
        types: ['fire'],
      }],
    },
    attack: { ability: 'str', bonus: '2' },
  });
});

test('ACT-006 updates only changed Composer paths and preserves raw damage extensions', async () => {
  const { buildActivityWorkspaceUpdate } = await load();
  const source = {
    _id: 'attack-1',
    type: 'attack',
    name: 'NCM Midi Damage',
    activation: { type: 'action', value: 1, condition: '대상을 볼 수 있을 때' },
    uses: { spent: 0, max: '3', recovery: [{ period: 'lr', type: 'recoverAll' }] },
    range: { value: '60', units: 'ft', special: '' },
    target: {
      affects: { type: 'creature', count: '1', special: '' },
      template: { type: 'sphere', size: '10', units: 'ft' },
    },
    damage: {
      parts: [{
        number: 2,
        denomination: 6,
        bonus: '1',
        custom: { enabled: false, formula: '' },
        types: ['fire'],
        midiKeep: { enabled: true },
      }],
    },
    attack: { ability: 'str', bonus: '2' },
    flags: { midi: { keep: true } },
    effects: [{ _id: 'effect-1' }],
  };
  const update = buildActivityWorkspaceUpdate(
    activity(source),
    midiDamageForm({
      range: { value: '90', units: 'ft', special: '' },
      damageRows: [{ formula: '3d8 - 2', types: ['lightning'] }],
    }),
  );

  assert.deepEqual(update, {
    'range.value': '90',
    'damage.parts': [{
      number: 3,
      denomination: 8,
      bonus: '-2',
      custom: { enabled: false, formula: '' },
      types: ['lightning'],
      midiKeep: { enabled: true },
    }],
  });
  assert.ok(!Object.hasOwn(update, 'flags'));
  assert.ok(!Object.hasOwn(update, 'effects'));
});

test('ACT-006 maps Heal and Save Composer values to their native roots only', async () => {
  const { buildActivityWorkspaceCreateData } = await load();
  const heal = buildActivityWorkspaceCreateData('heal', {
    name: '치유 파동',
    healing: { formula: '2d8 + 3', types: ['healing'] },
  });
  const save = buildActivityWorkspaceCreateData('save', {
    name: '폭발',
    damageRows: [{ formula: '7d6', types: ['fire'] }],
    save: { abilities: ['dex'], dc: '17', calculation: '', onSave: 'half' },
  });

  assert.deepEqual(heal, {
    name: '치유 파동',
    healing: {
      custom: { enabled: true, formula: '2d8 + 3' },
      types: ['healing'],
    },
  });
  assert.deepEqual(save, {
    name: '폭발',
    damage: {
      parts: [{
        number: 7,
        denomination: 6,
        bonus: '',
        custom: { enabled: false, formula: '' },
        types: ['fire'],
      }],
      onSave: 'half',
    },
    save: {
      ability: ['dex'],
      dc: { formula: '17' },
    },
  });
});

test('ACT-006 leaves absent blank values untouched but emits an explicit clear for an existing range', async () => {
  const { buildActivityWorkspaceUpdate } = await load();
  const empty = buildActivityWorkspaceUpdate(activity({
    _id: 'utility-1',
    type: 'utility',
    name: '유틸리티',
  }), {
    name: '유틸리티',
    range: { value: '', units: '', special: '' },
  });
  const cleared = buildActivityWorkspaceUpdate(activity({
    _id: 'utility-2',
    type: 'utility',
    name: '유틸리티',
    range: { value: '30', units: 'ft', special: '' },
  }), {
    name: '유틸리티',
    range: { value: '', units: 'ft', special: '' },
  });

  assert.deepEqual(empty, {});
  assert.deepEqual(cleared, { 'range.value': '' });
});

test('ACT-006 never writes damage or healing roots for a Utility Activity', async () => {
  const {
    activityWorkspaceSupportsDamage,
    activityWorkspaceSupportsHealing,
    buildActivityWorkspaceUpdate,
  } = await load();
  const update = buildActivityWorkspaceUpdate(activity({
    _id: 'utility-1',
    type: 'utility',
    name: '유틸리티',
    flags: { midi: { keep: true } },
    effects: [{ _id: 'effect-1' }],
  }), {
    name: '유틸리티',
    damageRows: [{ formula: '1d6', types: ['fire'] }],
    healing: { formula: '1d8', types: ['healing'] },
  });

  assert.equal(activityWorkspaceSupportsDamage('utility'), false);
  assert.equal(activityWorkspaceSupportsHealing('utility'), false);
  assert.deepEqual(update, {});
});
