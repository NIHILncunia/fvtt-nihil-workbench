import assert from 'node:assert/strict';
import test from 'node:test';
import { activityFieldEditsFromForm, buildActivityFieldUpdate, readActivityCommonFields, readActivitySpecificFields } from '../scripts/workbench/activity-field-adapter.mjs';
import { changeComplexList, syncComplexInputs, toggleComplexObject } from '../scripts/workbench/type-complex-fields.mjs';

class StringField { constructor(options = {}) { this.options = options; } }
class NumberField { constructor(options = {}) { this.options = options; } }
class DocumentIdField extends StringField {}
class SchemaField { constructor(fields) { this.fields = fields; this.options = {}; } }
class ArrayField { constructor(element) { this.element = element; this.options = {}; } }
class SetField extends ArrayField {}
class ConsumptionTargetsField extends ArrayField {}
class DocumentFlagsField extends ArrayField {}
class EmbeddedDataField {
  constructor(fields) {
    this.model = { schema: { fields } };
    this.options = { nullable: true };
  }
}

const globals = { CONFIG: globalThis.CONFIG, game: globalThis.game };
test.after(() => { Object.assign(globalThis, globals); });
globalThis.CONFIG = { DND5E: {
  actorSizes: { med: { label: '중형' } },
  creatureTypes: { beast: { label: '야수' } },
  movementTypes: { fly: '비행' },
  activityConsumptionTypes: {
    activityUses: { label: '활동 횟수' },
    hitDice: { label: '생명 주사위', validTargets: () => [{ value: 'd6', label: 'd6' }] },
    itemUses: { label: '아이템 횟수', targetRequiresEmbedded: true, validTargets() { return Array.from(this.actor.items).map((item) => ({ value: item.id, label: item.name })); } },
  },
  transformation: { keep: { mental: { label: '정신 능력치' } } },
} };
globalThis.game = {
  actors: [{ uuid: 'Actor.one', name: '액터 하나' }],
  items: [],
  dnd5e: { registry: { spellLists: { options: [{ value: 'class:wizard', label: '위저드' }] } } },
};

function fixture(
  type = 'summon',
  overrides = {},
) {
  const fields = {
    consumption: new SchemaField({ targets: new ConsumptionTargetsField(new SchemaField({
      type: new StringField({ initial: 'activityUses', blank: false }),
      target: new StringField(), value: new StringField({ initial: '1' }),
      scaling: new SchemaField({ mode: new StringField(), formula: new StringField() }),
    })) }),
    effects: new ArrayField(new SchemaField({ _id: new DocumentIdField(), level: new SchemaField({ min: new NumberField({ integer: true, min: 0 }), max: new NumberField({ integer: true, min: 0 }) }) })),
    profiles: new ArrayField(new SchemaField({
      _id: new DocumentIdField({ initial: 'new-profile' }),
      name: new StringField(), uuid: new StringField(), types: new SetField(new StringField()),
      level: new SchemaField({ min: new NumberField({ integer: true, min: 0 }), max: new NumberField({ integer: true, min: 0 }) }),
    })),
    settings: new EmbeddedDataField({ keep: new SetField(new StringField()), minimumAC: new StringField() }),
    creatureSizes: new SetField(new StringField()),
  };
  const source = { type, consumption: { targets: [] }, effects: [], profiles: [], settings: null, creatureSizes: [], ...overrides };
  const item = { effects: [{ id: 'effect-one', name: '효과 하나' }], isEmbedded: false };
  return { type, item, schema: { fields }, toObject: () => structuredClone(source) };
}

function fieldsFor(activity) {
  return [
    ...readActivityCommonFields(activity),
    ...readActivitySpecificFields(
      activity,
      { schema: activity.schema },
    ),
  ];
}

test('native custom consumption arrays render row controls without modifying their schema', () => {
  const activity = fixture('summon', { consumption: { targets: [{ type: 'hitDice', target: 'd6', value: '1', scaling: {} }] } });
  const field = fieldsFor(activity).find((entry) => entry.path === 'consumption.targets');
  assert.equal(field.isComplex, true);
  const target = field.editor.rows[0].node.children.find((node) => node.label === '대상 / 범위');
  assert.ok(target.options.some((option) => option.value === 'd6'));
  assert.equal(activity.schema.fields.consumption.fields.targets.constructor.name, 'ConsumptionTargetsField');
});

test('consumption candidates use the owning actor and preserve unknown current references', () => {
  const activity = fixture('summon', { consumption: { targets: [{ type: 'itemUses', target: 'legacy', value: '1', scaling: {} }] } });
  activity.item.isEmbedded = true;
  activity.actor = { items: [{ id: 'owned-one', name: '소유 아이템' }] };
  const field = fieldsFor(activity).find((entry) => entry.path === 'consumption.targets');
  const target = field.editor.rows[0].node.children.find((node) => node.label === '대상 / 범위');
  assert.ok(target.options.some((option) => option.value === 'owned-one'));
  assert.ok(target.options.some((option) => option.value === 'legacy' && option.selected));
});

test('effect references are editable, blank by default, and validated against item effects', () => {
  const activity = fixture();
  const field = fieldsFor(activity).find((entry) => entry.path === 'effects');
  const next = changeComplexList(
    field.schema,
    [],
    [],
  );
  assert.equal(next[0]._id, '');
  const form = { querySelectorAll: () => [{ dataset: { activityPath: 'effects' }, get value() { return JSON.stringify(next); } }] };
  assert.throws(() => activityFieldEditsFromForm(
    activity,
    { schema: activity.schema },
    form,
  ), /비어/);
  next[0]._id = 'effect-one';
  assert.deepEqual(activityFieldEditsFromForm(
    activity,
    { schema: activity.schema },
    form,
  ).effects, next);
  next.push(structuredClone(next[0]));
  assert.throws(() => activityFieldEditsFromForm(
    activity,
    { schema: activity.schema },
    form,
  ), /중복/);
});

test('profiles preserve identifiers and unknown row fields while updating an actor reference', () => {
  const original = [{ _id: 'profile-one', name: '후보', uuid: 'Actor.old', types: ['beast'], level: {}, extension: { keep: true } }];
  const activity = fixture('summon', { profiles: original });
  const field = fieldsFor(activity).find((entry) => entry.path === 'profiles');
  const ref = field.editor.rows[0].node.children.find((node) => node.label === '액터 참조');
  assert.ok(ref.options.some((option) => option.value === 'Actor.one'));
  const next = structuredClone(original);
  next[0].uuid = 'Actor.one';
  const update = buildActivityFieldUpdate([{ ...field, value: JSON.stringify(next) }]);
  assert.deepEqual(update.profiles[0].extension, { keep: true });
  assert.equal(update.profiles[0]._id, 'profile-one');
});

test('nullable transformation settings can be enabled and cleared without changing the native schema', () => {
  const activity = fixture('transform');
  const field = fieldsFor(activity).find((entry) => entry.path === 'settings');
  assert.equal(field.editor.isEnabled, false);
  const next = toggleComplexObject(
    field.schema,
    null,
    [],
  );
  assert.deepEqual(next, { keep: [], minimumAC: '' });
  assert.deepEqual(buildActivityFieldUpdate([{ ...field, value: JSON.stringify(next) }]), { settings: next });
  assert.equal(toggleComplexObject(
    field.schema,
    next,
    [],
  ), null);
  assert.deepEqual(buildActivityFieldUpdate(fieldsFor(activity)), {});
});

test('profile level bounds reject reversed ranges and fractional levels before an update', () => {
  const activity = fixture();
  const rows = [{ _id: 'profile-one', level: { min: 5, max: 2 } }];
  const form = { querySelectorAll: () => [{ dataset: { activitySpecificPath: 'profiles' }, value: JSON.stringify(rows) }] };
  assert.throws(() => activityFieldEditsFromForm(
    activity,
    { schema: activity.schema },
    form,
  ), /최소 레벨/);
  rows[0].level = { min: 1.5, max: 3 };
  assert.throws(() => activityFieldEditsFromForm(
    activity,
    { schema: activity.schema },
    form,
  ), /정수/);
});

test('untouched source fields stay absent and list deletion preserves sibling extensions', () => {
  const activity = fixture('summon', { consumption: { targets: [{ type: 'activityUses', value: '1', custom: true }], extension: 'keep' } });
  const field = fieldsFor(activity).find((entry) => entry.path === 'consumption.targets');
  assert.deepEqual(buildActivityFieldUpdate(fieldsFor(activity)), {});
  const update = buildActivityFieldUpdate([{ ...field, value: '[]' }]);
  assert.deepEqual(update, { 'consumption.targets': [] });
});

test('complex activity input merges edited values without losing unknown data or dirty drafts', () => {
  const hidden = { value: '[{"type":"activityUses","value":"1","custom":true}]' };
  const control = { value: '2', dataset: { complexAddress: '[0,"value"]', complexKind: 'text', complexBaseline: '"1"' } };
  syncComplexInputs({ querySelectorAll: () => [{ querySelector: () => hidden, querySelectorAll: () => [control] }] });
  assert.deepEqual(JSON.parse(hidden.value), [{ type: 'activityUses', value: '2', custom: true }]);
});

test('a flags field with an element remains a JSON object instead of becoming an array editor', () => {
  const activity = fixture(
    'summon',
    { flags: {} },
  );
  activity.schema.fields.flags = new DocumentFlagsField(new StringField());
  const flags = readActivityCommonFields(activity).find((field) => field.path === 'flags');
  assert.equal(flags.isComplex, false);
  assert.equal(flags.isJson, true);
  assert.deepEqual(buildActivityFieldUpdate([flags]), {});
});

test('macro commands use a multiline field with the same partial-save contract', () => {
  const activity = fixture();
  activity.schema.fields.macroData = new SchemaField({ command: new StringField() });
  const command = readActivityCommonFields(activity).find((field) => field.path === 'macroData.command');
  assert.equal(command.isLongText, true);
  assert.deepEqual(buildActivityFieldUpdate([{ ...command, value: 'line one\nline two' }]), {
    'macroData.command': 'line one\nline two',
  });
});

test('transformation spell lists use registry identifiers rather than spellcasting methods', () => {
  const activity = fixture(
    'transform',
    { settings: { spellLists: ['class:wizard'] } },
  );
  activity.schema.fields.settings.model.schema.fields.spellLists = new SetField(new StringField());
  const settings = fieldsFor(activity).find((field) => field.path === 'settings');
  const lists = settings.editor.children.find((node) => node.label === '주문 목록');
  assert.ok(lists.rows[0].node.options.some((option) => option.value === 'class:wizard' && option.selected));
  assert.ok(!lists.rows[0].node.options.some((option) => option.value === 'pact'));
});

test('an invalid activity blocks basic Item writes and retains both drafts', async () => {
  const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
  class ApplicationV2 { render() { return this; } }
  const activity = fixture();
  activity.id = 'summon';
  const source = { name: '주문', type: 'spell', img: 'icon', system: {}, flags: {} };
  let writes = 0;
  const errors = [];
  const item = {
    id: 'item',
    type: 'spell',
    isOwner: true,
    system: { schema: { fields: {} }, activities: new Map([['summon', activity]]) },
    toObject: () => structuredClone(source),
    update: async () => { writes++; },
  };
  activity.update = async () => { writes++; };
  globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } } };
  globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([['item', item]]) };
  globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
  try {
    const url = new URL(
      '../scripts/workbench/workbench-app.mjs',
      import.meta.url,
    );
    url.searchParams.set(
      'activityPreflight',
      Date.now(),
    );
    const { openWorkbench } = await import(url.href);
    const { formInputEntries } = await import('../scripts/workbench/form-inputs.mjs');
    const { itemEditSnapshot } = await import('../scripts/workbench/document-fields.mjs');
    const app = openWorkbench('item');
    app.selectedActivityId = 'summon';
    const name = { name: 'itemName', type: 'text', tagName: 'INPUT', value: '주문', dataset: {} };
    const hidden = { type: 'hidden', tagName: 'INPUT', value: '[]', dataset: { activityPath: 'effects' } };
    const form = {
      querySelector: () => null,
      querySelectorAll: (selector) => {
        if (selector.includes('[data-type-complex-root]') || selector === '[data-advancement-field]') return [];
        if (selector.includes('[data-activity-common-field]')) return [hidden];
        return [name, hidden];
      },
    };
    app.form = form;
    app.initialInputs = new Map(formInputEntries(form).map(({ key, value }) => [key, value]));
    app.renderedSource = itemEditSnapshot(item);
    name.value = '저장되면 안 되는 이름';
    hidden.value = '[{"_id":"","level":{}}]';
    await app.constructor.DEFAULT_OPTIONS.form.handler.call(
      app,
      { preventDefault() {} },
      form,
    );
    assert.equal(writes, 0);
    assert.equal(app.submissionSucceeded, false);
    assert.equal(app.inputDraft.size, 2);
    assert.ok(errors.some((message) => message.includes('참조')));
  } finally {
    Object.assign(globalThis, previous);
  }
});

test('whole Item save also persists standard Activity values from inactive tabs', async () => {
  const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
  class ApplicationV2 { render() { return this; } }
  const activity = fixture(
    'transform',
    { name: '원래 이름', uses: { spent: 0, max: '', recovery: [] } },
  );
  const updates = [];
  const item = {
    id: 'item', type: 'spell', isOwner: true,
    system: { schema: { fields: {} }, activities: new Map([['transform', activity]]) },
    toObject: () => ({ name: '주문', type: 'spell', img: '', system: {}, flags: {} }),
    update: async () => { throw new Error('Unexpected Item change'); },
  };
  activity.id = 'transform';
  activity.update = async (changes) => updates.push(changes);
  const controls = new Map([
    ['activityWorkspaceName', { value: '새 이름' }],
    ['activityWorkspaceUsesMax', { value: '4', hidden: true }],
    ['activityWorkspaceRangeValue', { value: '30', hidden: true }],
  ]);
  const form = {
    elements: { namedItem: (name) => controls.get(name) },
    querySelector: (selector) => selector === '[name="activityWorkspaceName"]' ? controls.get('activityWorkspaceName') : null,
    querySelectorAll: () => [],
  };
  globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } } };
  globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([['item', item]]) };
  globalThis.ui = { notifications: { info() {}, error(message) { throw new Error(message); } } };
  try {
    const url = new URL('../scripts/workbench/workbench-app.mjs', import.meta.url);
    url.searchParams.set(
      'inactiveTabSave',
      Date.now(),
    );
    const { openWorkbench } = await import(url.href);
    const app = openWorkbench('item');
    app.selectedActivityId = 'transform';
    app.form = form;
    await app.constructor.DEFAULT_OPTIONS.form.handler.call(
      app,
      { preventDefault() {} },
      form,
    );
    assert.equal(app.submissionSucceeded, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].name, '새 이름');
    assert.equal(updates[0]['uses.max'], '4');
    assert.equal(updates[0]['range.value'], '30');
    assert.ok(!Object.hasOwn(updates[0], 'settings'));
  } finally {
    Object.assign(globalThis, previous);
  }
});
