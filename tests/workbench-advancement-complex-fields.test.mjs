import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdvancementFieldUpdate, readAdvancementFields } from '../scripts/workbench/advancement-adapter.mjs';
import { advancementDeletionPaths } from '../scripts/workbench/advancement-complex-fields.mjs';
import { changeComplexList, changeComplexMapping, syncComplexInputs, toggleComplexObject } from '../scripts/workbench/type-complex-fields.mjs';

class StringField { constructor(options = {}) { this.options = options; this.choices = options.choices; } }
class NumberField { constructor(options = {}) { this.options = options; } }
class BooleanField { constructor(options = {}) { this.options = options; } }
class SchemaField { constructor(fields) { this.fields = fields; this.options = {}; } }
class ArrayField { constructor(element) { this.element = element; this.options = {}; } }
class SetField extends ArrayField {}
class MappingField { constructor(model) { this.model = model; this.options = {}; } }
class EmbeddedDataField {
  constructor(model) { this.model = model; this.options = { nullable: true }; }
  get fields() { return this.model.schema.fields; }
}
class ScaleValueEntryField { constructor() { this.options = {}; } }
class ForeignDocumentField { constructor(model) { this.model = model; this.options = { idOnly: true }; } }

function fixture(
  type,
  configuration,
  value,
  configFields = {},
  valueFields = {},
) {
  class Advancement {}
  Advancement.schema = { fields: { level: new NumberField({ integer: true, min: 0 }), title: new StringField() } };
  Advancement.metadata = { dataModels: {
    configuration: { schema: { fields: configFields } },
    value: { schema: { fields: valueFields } },
  } };
  Advancement.TYPES = {
    number: { schema: { fields: { value: new NumberField({ nullable: false, required: true }) } } },
    dice: { schema: { fields: { number: new NumberField({ integer: true }), faces: new NumberField({ integer: true, nullable: false }), modifiers: new SetField(new StringField()) } } },
  };
  return { type, constructor: Advancement, toObject: () => structuredClone({ type, level: 0, title: '테스트', configuration, value }) };
}

test('core advancement lists expose selectable rows without changing the native shared schema', () => {
  const sizes = new SetField(new StringField());
  const adv = fixture(
    'Size',
    { sizes: ['med'] },
    { size: 'med' },
    { sizes },
    { size: new StringField() },
  );
  const previous = globalThis.CONFIG;
  globalThis.CONFIG = { DND5E: { actorSizes: { med: '중형', sm: '소형' } } };
  try {
    const fields = readAdvancementFields(adv);
    const size = fields.find((field) => field.path === 'configuration.sizes');
    assert.equal(size.kind, 'complex');
    assert.ok(size.editor.rows[0].node.hasChoices);
    assert.equal(sizes.element.choices, undefined);
    assert.deepEqual(buildAdvancementFieldUpdate(fields), {});
  } finally { globalThis.CONFIG = previous; }
});

test('changing scale type cannot silently discard a row whose new value has not been entered', () => {
  const adv = fixture(
    'ScaleValue',
    { type: 'dice', scale: { 1: { number: 2, faces: 6, modifiers: [] } } },
    {},
    { type: new StringField(), scale: new MappingField(new ScaleValueEntryField()) },
  );
  const fields = readAdvancementFields(
    adv,
    { 'configuration.type': 'number' },
  ).map((field) => field.path === 'configuration.type' ? { ...field, value: 'number' } : field);
  assert.throws(() => buildAdvancementFieldUpdate(fields), /새 유형/);
});

test('ability assignments add and remove keys while preserving foreign entries and emitting native deletion paths', () => {
  const adv = fixture(
    'AbilityScoreImprovement',
    { fixed: { str: 1, extension: 9 } },
    {},
    { fixed: new MappingField(new NumberField({ integer: true, initial: 0, nullable: false })) },
  );
  const field = readAdvancementFields(adv).find((entry) => entry.path === 'configuration.fixed');
  let value = changeComplexMapping(
    field.schema,
    field.original,
    [],
    'dex',
  );
  value = changeComplexMapping(
    field.schema,
    value,
    [],
    'str',
    true,
  );
  assert.deepEqual(value, { extension: 9, dex: 0 });
  assert.deepEqual(buildAdvancementFieldUpdate([{ ...field, value: JSON.stringify(value) }]), {
    'configuration.fixed': { extension: 9, dex: 0 },
    'configuration.fixed.-=str': null,
  });
});

test('level mapping rejects duplicate, malformed and reserved keys, including level zero boundaries', () => {
  const adv = fixture('HitPoints', {}, { 1: 'max' });
  const field = readAdvancementFields(adv).find((entry) => entry.path === 'value');
  for (const key of ['0', '21', '01', '1.2', '__proto__', '-=x', '1']) assert.throws(() => changeComplexMapping(
    field.schema,
    field.original,
    [],
    key,
  ));
  assert.deepEqual(changeComplexMapping(
    field.schema,
    field.original,
    [],
    '2',
  ), { 1: 'max', 2: 'avg' });
});

test('hit points convert manual numbers and preserve average/max values with no false draft', () => {
  const hidden = { value: '{"1":"max","2":"avg"}' };
  const control = { type: 'text', value: '7', dataset: { complexKind: 'hitPoints', complexAddress: '["2"]', complexBaseline: '"avg"' } };
  const root = { querySelector: () => hidden, querySelectorAll: () => [control] };
  syncComplexInputs({ querySelectorAll: () => [root] });
  assert.deepEqual(JSON.parse(hidden.value), { 1: 'max', 2: 7 });
  const saved = hidden.value;
  syncComplexInputs({ querySelectorAll: () => [root] });
  assert.equal(hidden.value, saved);
  control.value = '-1';
  syncComplexInputs({ querySelectorAll: () => [root] });
  const field = readAdvancementFields(fixture('HitPoints', {}, { 1: 'max', 2: 'avg' })).find((entry) => entry.path === 'value');
  assert.throws(() => buildAdvancementFieldUpdate([{ ...field, value: hidden.value }]), /체력/);
  assert.deepEqual(JSON.parse(hidden.value), { 1: 'max', 2: -1 });
});

test('item grants and trait choice rows retain references and unknown row metadata', () => {
  const adv = fixture(
    'ItemGrant',
    { items: [{ uuid: 'Item.one', optional: false, foreign: 7 }] },
    { added: { actorItem: 'Item.one' } },
    { items: new ArrayField(new SchemaField({ uuid: new StringField(), optional: new BooleanField() })) },
  );
  const fields = readAdvancementFields(adv);
  const field = fields.find((entry) => entry.path === 'configuration.items');
  const next = changeComplexList(
    field.schema,
    field.original,
    [],
  );
  assert.equal(next[0].foreign, 7);
  assert.deepEqual(next[1], { uuid: '', optional: false });
  assert.equal(fields.find((entry) => entry.path === 'value.added').kind, 'complex');
});

test('scale rows use the selected native type schema across a draft and reject fractional dice', () => {
  const adv = fixture(
    'ScaleValue',
    { type: 'number', scale: { 1: { value: 3, foreign: 'keep' } } },
    {},
    { type: new StringField(), scale: new MappingField(new ScaleValueEntryField()) },
  );
  const fields = readAdvancementFields(
    adv,
    { 'configuration.type': 'dice', 'configuration.scale': '{"1":{"value":3,"foreign":"keep","number":1,"faces":6,"modifiers":[]}}' },
  );
  const field = fields.find((entry) => entry.path === 'configuration.scale');
  assert.ok(field.editor.children[0].children.some((child) => child.label.endsWith('주사위 면수')));
  assert.throws(() => buildAdvancementFieldUpdate([{ ...field, value: '{"1":{"number":1.5,"faces":6,"modifiers":[]}}' }]), /정수/);
  assert.deepEqual(buildAdvancementFieldUpdate([{ ...field, value: '{"1":{"value":3,"foreign":"keep","number":1,"faces":6,"modifiers":[]}}' }])['configuration.scale']['1'].foreign, 'keep');
});

test('nullable spell configurations enable with native defaults and clear back to null', () => {
  const field = new EmbeddedDataField({ schema: { fields: { prepared: new NumberField({ nullable: false, initial: 0 }), ability: new SetField(new StringField()) } } });
  const adv = fixture('ItemGrant', { spell: null }, {}, { spell: field });
  const descriptor = readAdvancementFields(adv).find((entry) => entry.path === 'configuration.spell');
  assert.equal(descriptor.editor.isEnabled, false);
  const next = toggleComplexObject(
    descriptor.schema,
    null,
    [],
  );
  assert.deepEqual(next, { prepared: 0, ability: [] });
  assert.equal(toggleComplexObject(
    descriptor.schema,
    next,
    [],
  ), null);
  assert.deepEqual(buildAdvancementFieldUpdate(readAdvancementFields(adv)), {});
});

test('nested mapping deletion targets removed leaf keys but never array row indices', () => {
  assert.deepEqual(advancementDeletionPaths(
    { 2: { first: 'Item.one', second: 'Item.two' }, list: [{ keep: 1 }] },
    { 2: { second: 'Item.two' }, list: [] },
    'value.added',
  ), { 'value.added.2.-=first': null });
});

test('changing one basic advancement field leaves absent and null sibling fields untouched', () => {
  const adv = fixture('Subclass', {}, { uuid: null }, {}, { uuid: new StringField() });
  const fields = readAdvancementFields(adv).map((field) => field.path === 'title' ? { ...field, value: '새 제목' } : field);
  assert.deepEqual(buildAdvancementFieldUpdate(fields), { title: '새 제목' });
});

test('ItemChoice replacement references never recurse into the complete Item schema', () => {
  const model = { defineSchema: () => { throw new Error('Document schema must not be traversed'); } };
  const adv = fixture(
    'ItemChoice',
    {},
    { replaced: { row: { level: 2, original: 'one', replacement: 'two' } } },
    {},
    { replaced: new MappingField(new SchemaField({ level: new NumberField(), original: new ForeignDocumentField(model), replacement: new ForeignDocumentField(model) })) },
  );
  const field = readAdvancementFields(adv).find((entry) => entry.path === 'value.replaced');
  assert.equal(field.editor.children[0].children.find((child) => child.label === '기존 아이템').isLeaf, true);
});

test('an invalid advancement blocks basic Item writes and retains the edited name and growth draft', async () => {
  const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
  class ApplicationV2 { render() { return this; } }
  const adv = fixture('HitPoints', {}, { 1: 'max' });
  const source = { name: '클래스', type: 'class', img: 'icon', system: { advancement: [{ ...adv.toObject(), _id: 'hp' }] }, flags: {} };
  let writes = 0;
  const errors = [];
  const item = {
    id: 'item', type: 'class', isOwner: true,
    system: { schema: { fields: {} } }, advancement: { byId: { hp: adv } },
    toObject: () => structuredClone(source),
    update: async () => { writes++; }, updateAdvancement: async () => { writes++; },
  };
  globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } } };
  globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([['item', item]]) };
  globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
  try {
    const url = new URL('../scripts/workbench/workbench-app.mjs', import.meta.url);
    url.searchParams.set(
      'advancementPreflight',
      Date.now(),
    );
    const { openWorkbench } = await import(url.href);
    const { formInputEntries } = await import('../scripts/workbench/form-inputs.mjs');
    const { itemEditSnapshot } = await import('../scripts/workbench/document-fields.mjs');
    const app = openWorkbench('item');
    app.selectedAdvancementId = 'hp';
    const name = { name: 'itemName', type: 'text', tagName: 'INPUT', value: '클래스', dataset: {} };
    const hidden = { type: 'hidden', tagName: 'INPUT', value: '{"1":"max"}', dataset: { advancementPath: 'value' } };
    const amount = { type: 'text', tagName: 'INPUT', value: 'max', dataset: { complexAddress: '["1"]', complexKind: 'hitPoints', complexBaseline: '"max"' }, hasAttribute: () => true };
    const root = { querySelector: () => hidden, querySelectorAll: () => [amount] };
    const form = {
      querySelectorAll: (selector) => selector.includes('[data-type-complex-root]') ? [root] : selector === '[data-advancement-field]' ? [hidden] : [name, hidden, amount],
      querySelector: () => null,
    };
    app.form = form;
    app.initialInputs = new Map(formInputEntries(form).map(({ key, value }) => [key, value]));
    app.renderedSource = itemEditSnapshot(item);
    name.value = '저장되면 안 되는 이름';
    amount.value = '-1';
    await app.constructor.DEFAULT_OPTIONS.form.handler.call(
      app,
      { preventDefault() {} },
      form,
    );
    assert.equal(writes, 0);
    assert.equal(app.submissionSucceeded, false);
    assert.equal(app.inputDraft.size, 2);
    assert.deepEqual(JSON.parse(hidden.value), { 1: -1 });
    assert.ok(errors.some((message) => message.includes('체력')));
  } finally { Object.assign(globalThis, previous); }
});
