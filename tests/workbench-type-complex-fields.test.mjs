import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTypeFieldUpdate, readTypeFields } from '../scripts/workbench/type-field-adapter.mjs';
import {
  changeComplexList,
  complexEditor,
  syncComplexInputs,
  typeChoices,
  validateComplexValue,
} from '../scripts/workbench/type-complex-fields.mjs';

class StringField {
  constructor(options = {}) {
    this.options = options;
    this.choices = options.choices;
  }
}
class NumberField {
  constructor(options = {}) {
    this.options = options;
  }
}
class BooleanField {}
class DocumentIdField {}
class ArrayField {
  constructor(element) {
    this.element = element;
  }
}
class SetField extends ArrayField {}
class SchemaField {
  constructor(fields) {
    this.fields = fields;
  }
}
class MappingField {
  constructor(
    model,
    options = {},
  ) {
    this.model = model;
    this.options = options;
  }
}

test(
  'invalid compound values block basic writes and keep both drafts in the Item workbench',
  async () => {
    const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui, CSS: globalThis.CSS };
    globalThis.CSS = { escape: (value) => value };
    class ApplicationV2 { render() { return this; } }
    const source = { name: '가방', img: 'icon', type: 'container', system: { currency: { gp: 3 } }, flags: {} };
    let writes = 0;
    const errors = [];
    const item = {
      id: 'item',
      type: 'container',
      isOwner: true,
      system: { schema: { fields: { currency: new MappingField(new NumberField({ integer: true, min: 0, nullable: false })) } } },
      toObject: () => structuredClone(source),
      update: async () => { writes++; },
    };
    globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } } };
    globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([['item', item]]) };
    globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
    try {
      const url = new URL(
        '../scripts/workbench/workbench-app.mjs',
        import.meta.url,
      );
      url.searchParams.set(
        'compoundSaveTest',
        Date.now(),
      );
      const { openWorkbench } = await import(url.href);
      const { itemEditSnapshot } = await import('../scripts/workbench/document-fields.mjs');
      const { formInputEntries } = await import('../scripts/workbench/form-inputs.mjs');
      const app = openWorkbench('item');
      const name = { name: 'itemName', type: 'text', tagName: 'INPUT', value: '가방', dataset: {} };
      const hidden = { type: 'hidden', tagName: 'INPUT', value: '{"gp":3}', dataset: { typePath: 'currency' } };
      const amount = { type: 'number', tagName: 'INPUT', value: '3', dataset: { complexAddress: '["gp"]', complexKind: 'number', complexBaseline: '"3"' }, hasAttribute: () => true };
      const root = { querySelector: () => hidden, querySelectorAll: () => [amount] };
      const form = {
        querySelectorAll: (selector) => selector.includes('[data-type-complex-root]') ? [root] : selector === '[data-advancement-field]' ? [] : [name, hidden, amount],
        querySelector: () => hidden,
      };
      app.form = form;
      app.initialInputs = new Map(formInputEntries(form).map(({ key, value }) => [key, value]));
      app.renderedSource = itemEditSnapshot(item);
      name.value = '새 가방';
      amount.value = '-1';
      await app.constructor.DEFAULT_OPTIONS.form.handler.call(
        app,
        { preventDefault() {} },
        form,
      );
      assert.equal(
        writes,
        0,
      );
      assert.equal(
        app.submissionSucceeded,
        false,
      );
      assert.equal(
        app.inputDraft.size,
        2,
      );
      assert.deepEqual(
        JSON.parse(hidden.value),
        { gp: -1 },
      );
      assert.ok(errors.some((message) => message.includes('수치')));
    } finally {
      globalThis.game = previous.game;
      globalThis.foundry = previous.foundry;
      globalThis.ui = previous.ui;
      globalThis.CSS = previous.CSS;
    }
  },
);
class EmbeddedDataField {
  constructor(model) {
    this.model = model;
  }
}
const label = (path) => path;

function itemFixture() {
  const fields = {
    crew: new SchemaField({ value: new ArrayField(new StringField()) }),
    primaryAbility: new SchemaField({ value: new SetField(new StringField()) }),
    currency: new MappingField(new NumberField({ integer: true, min: 0, nullable: false }), {
      initialKeys: { gp: '금화', sp: '은화' },
    }),
    startingEquipment: new ArrayField(
      new EmbeddedDataField({
        schema: {
          fields: {
            _id: new DocumentIdField(),
            group: new StringField({ nullable: true, initial: null }),
            type: new StringField({
              initial: 'OR',
              choices: { OR: '선택 묶음', linked: '아이템' },
            }),
            count: new NumberField(),
            requiresProficiency: new BooleanField(),
          },
        },
      }),
    ),
    absent: new StringField(),
  };
  const source = {
    crew: { value: ['Actor.a'] },
    primaryAbility: { value: ['str'] },
    currency: { gp: 3, sp: 0, custom: 7 },
    startingEquipment: [{ _id: 'root', group: null, type: 'OR', moduleValue: { keep: true } }],
  };
  return {
    type: 'background',
    system: { schema: { fields } },
    toObject: () => ({ system: structuredClone(source) }),
  };
}

test('native arrays, sets, currencies and embedded starting equipment expose row editors', () => {
  const fields = readTypeFields(itemFixture());
  assert.equal(fields.filter((field) => field.kind === 'complex').length, 4);
  assert.deepEqual(buildTypeFieldUpdate(fields), {});
  const currencies = fields.find((field) => field.path === 'currency');
  assert.equal(currencies.editor.children.length, 3);
  const equipment = fields.find((field) => field.path === 'startingEquipment');
  assert.equal(equipment.editor.rows[0].node.children[0].readOnly, true);
});

test('list add and remove preserve unknown row properties and block orphaned groups', () => {
  const field = readTypeFields(itemFixture()).find((entry) => entry.path === 'startingEquipment');
  const added = changeComplexList(field.schema, field.original, []);
  assert.match(added[1]._id, /^[a-zA-Z0-9]{16}$/);
  assert.equal(added[1].type, 'OR');
  assert.deepEqual(added[0].moduleValue, { keep: true });
  added[1].group = 'root';
  assert.throws(() => changeComplexList(field.schema, added, [], 0), /하위 장비/);
  assert.equal(changeComplexList(field.schema, added, [], 1).length, 1);
});

test('nested primitive row edits merge into the full root and are not replayed after row removal', () => {
  const controls = [
    {
      type: 'text',
      value: 'new',
      dataset: { complexAddress: '[1,"key"]', complexKind: 'text', complexBaseline: '"old"' },
    },
  ];
  const hidden = {
    value: JSON.stringify([
      { key: 'first', extra: true },
      { key: 'old', untouched: null },
    ]),
  };
  const root = { querySelector: () => hidden, querySelectorAll: () => controls };
  const form = { querySelectorAll: () => [root] };
  syncComplexInputs(form);
  assert.deepEqual(JSON.parse(hidden.value), [
    { key: 'first', extra: true },
    { key: 'new', untouched: null },
  ]);
  hidden.value = '[{"key":"first","extra":true}]';
  syncComplexInputs(form);
  assert.deepEqual(JSON.parse(hidden.value), [{ key: 'first', extra: true }]);
});

test('unchanged null and missing values stay untouched, while explicitly changed empty numbers become null', () => {
  const hidden = { value: '[{"count":null}]' };
  const control = {
    type: 'number',
    value: '',
    dataset: { complexAddress: '[0,"count"]', complexKind: 'number', complexBaseline: '""' },
  };
  const root = { querySelector: () => hidden, querySelectorAll: () => [control] };
  syncComplexInputs({ querySelectorAll: () => [root] });
  assert.equal(hidden.value, '[{"count":null}]');
  control.value = '4';
  syncComplexInputs({ querySelectorAll: () => [root] });
  assert.equal(hidden.value, '[{"count":4}]');
});

test('unchanged structured roots keep their formatting so reading does not create a false draft', () => {
  const hidden = { value: '{\n  "gp": 3\n}' };
  const control = {
    type: 'number',
    value: '3',
    dataset: { complexAddress: '["gp"]', complexKind: 'number', complexBaseline: '"3"' },
  };
  const root = { querySelector: () => hidden, querySelectorAll: () => [control] };
  syncComplexInputs({ querySelectorAll: () => [root] });
  assert.equal(hidden.value, '{\n  "gp": 3\n}');
});

test('complex validation rejects duplicate sets, negative currency, cycles and dangling starting groups', () => {
  const fields = readTypeFields(itemFixture());
  const by = Object.fromEntries(fields.map((field) => [field.path, field]));
  assert.throws(
    () =>
      validateComplexValue(
        by['primaryAbility.value'].schema,
        ['str', 'str'],
        'primaryAbility.value',
        ['str'],
      ),
    /중복/,
  );
  assert.throws(() => buildTypeFieldUpdate([{ ...by.currency, value: '{"gp":-1}' }]), /수치/);
  for (const group of ['root', 'missing'])
    assert.throws(
      () =>
        validateComplexValue(
          by.startingEquipment.schema,
          [{ _id: 'root', group, type: 'OR' }],
          'startingEquipment',
          [],
        ),
      /상위 묶음/,
    );
});

test('configuration enums and unknown current values remain selectable without dropping references', () => {
  const previous = globalThis.CONFIG;
  globalThis.CONFIG = {
    DND5E: {
      abilities: { str: '근력', dex: '민첩' },
      spellcasting: { innate: { label: '타고난 시전' } },
    },
  };
  try {
    const options = typeChoices(new StringField(), 'method', { type: 'spell' }, 'module-method');
    assert.equal(options.find((option) => option.value === 'module-method').selected, true);
    const node = complexEditor(new StringField(), 'str', 'primaryAbility.value', {}, label);
    assert.equal(node.hasChoices, true);
    assert.equal(node.options.find((option) => option.value === 'str').label, '근력');
  } finally {
    globalThis.CONFIG = previous;
  }
});

test('unsafe object keys and array replacement payloads fail before a document update', () => {
  const field = readTypeFields(itemFixture()).find((entry) => entry.path === 'currency');
  assert.throws(() => buildTypeFieldUpdate([{ ...field, value: '{"__proto__":1}' }]), /키/);
  assert.throws(() => buildTypeFieldUpdate([{ ...field, value: '[]' }]), /묶음/);
});

test(
  'existing invalid group references remain visible without silently changing the source',
  () => {
    const field = readTypeFields(itemFixture()).find((entry) => entry.path === 'startingEquipment');
    const value = [{ _id: 'root', type: 'OR', group: 'root' }];
    const editor = complexEditor(
      field.schema,
      value,
      'startingEquipment',
      {},
      label,
    );
    const group = editor.rows[0].node.children.find((child) => child.label === 'startingEquipment.group');
    assert.equal(
      group.options.find((option) => option.value === 'root').selected,
      true,
    );
    assert.deepEqual(
      value,
      [{ _id: 'root', type: 'OR', group: 'root' }],
    );
  },
);
