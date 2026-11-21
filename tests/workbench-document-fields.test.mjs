import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentPatch,
  itemEditSnapshot,
  editableDocumentRoots,
  readDocumentFields,
} from '../scripts/workbench/document-fields.mjs';
import {
  copyItemToActor,
  createItemInWorkbench,
  itemTypeChoices,
  openItemLibrary,
} from '../scripts/workbench/item-library.mjs';
import { openDocumentWorkbench } from '../scripts/workbench/document-workbench-app.mjs';

test(
  'ActiveEffect extensions expose tint and system data while keeping identity immutable',
  () => {
    const effect = { documentName: 'ActiveEffect', toObject: () => ({ _id: 'id', type: 'enchantment', name: '효과', tint: '#ffffff', system: { custom: true }, changes: [] }) };
    const fields = readDocumentFields(
      effect.toObject(),
      {},
      editableDocumentRoots(effect),
    );
    assert.ok(fields.some((field) => field.path === 'tint'));
    assert.ok(fields.some((field) => field.path === 'system.custom'));
    assert.ok(!fields.some((field) => ['_id', 'type'].includes(field.path)));
  },
);

test(
  'Multiline text preserves line endings when other fields are edited',
  () => {
    const source = { description: '<p>첫 줄</p>\r\n<p>둘째 줄</p>', img: 'before' };
    const fields = readDocumentFields(
      source,
      {},
    );
    assert.equal(
      fields[0].multiline,
      true,
    );
    assert.deepEqual(
      buildDocumentPatch(
        fields,
        { description: source.description.replace(/\r\n/g, '\n'), img: 'after' },
        source,
      ).patch,
      { img: 'after' },
    );
  },
);

test(
  'Schema choices normalize numeric and object labels before localization',
  () => {
  const previous = globalThis.game;
  globalThis.game = {
    i18n: {
      localize: (key) => {
        assert.equal(
          typeof key,
          'string'
        );
        return key;
      },
    },
  };
  try {
    const fields = readDocumentFields(
      { disposition: 0 },
      { disposition: { choices: { '-1': -1, 0: { label: '중립' } } } },
    );
    assert.equal(
      fields[0].options.find((option) => option.selected).label,
      '중립'
    );
  } finally {
    globalThis.game = previous;
  }
}
);

test(
  'Foundry v13 object-shaped type declarations and module-registered models both appear in creation choices',
  () => {
  const previous = { game: globalThis.game, CONFIG: globalThis.CONFIG };
  globalThis.game = { system: { documentTypes: { Item: { weapon: {}, facility: {} } } } };
  globalThis.CONFIG = { Item: { dataModels: { weapon: {}, moduleType: {} } } };
  try {
    assert.deepEqual(
      itemTypeChoices(),
      {
      weapon: '무기',
      facility: '시설',
      moduleType: 'moduleType',
    }
    );
  } finally {
    Object.assign(
      globalThis,
      previous
    );
  }
}
);

test(
  'Full editor preserves unknown module fields and distinguishes source values from computed values',
  () => {
  const source = {
    _id: 'actor',
    type: 'character',
    system: { abilities: { str: { value: 10 } }, custom: { type: 'special', value: 7 } },
    flags: { custom: { a: 1, b: 2 } },
  };
  const fields = readDocumentFields(
    source,
    {}
  );
  assert.ok(fields.some((field) => field.path === 'system.custom.type'));
  assert.ok(
    !fields.some((field) =>
      ['_id', 'type', 'system.abilities.str.mod'].includes(field.path),
    ),
  );
  const { patch, conflicts } = buildDocumentPatch(
    fields,
    { 'system.abilities.str.value': '14' },
    source,
  );
  assert.deepEqual(
    patch,
    { 'system.abilities.str.value': 14 }
  );
  assert.deepEqual(
    conflicts,
    []
  );
}
);

test(
  'JSON map edits use leaf patches and deletion operators without overwriting unrelated concurrent flags',
  () => {
  const source = { flags: { custom: { a: 1, b: 2 } } };
  const current = { flags: { custom: { a: 1, b: 2, concurrent: 3 } } };
  const fields = readDocumentFields(
    source,
    {}
  );
  const result = buildDocumentPatch(
    fields,
    { flags: '{"custom":{"a":4}}' },
    current
  );
  assert.deepEqual(
    result.patch,
    { 'flags.custom.a': 4, 'flags.custom.-=b': null }
  );
  assert.deepEqual(
    result.conflicts,
    []
  );
  assert.equal(
    result.patch['flags.custom.concurrent'],
    undefined
  );
}
);

test(
  'Full editor rejects concurrent writes, invalid JSON, array-shape changes, unsafe keys and invalid numeric bounds',
  () => {
  const source = { flags: {}, changes: [], width: 1 };
  const fields = readDocumentFields(
    source,
    {
    width: { constructor: { name: 'NumberField' }, min: 0.5, max: 10 },
  }
  );
  assert.deepEqual(
    buildDocumentPatch(
      fields,
      { width: '2' },
      { ...source, width: 3 }
    ).conflicts,
    ['width'],
  );
  for (const values of [
    { flags: 'invalid' },
    { changes: '{}' },
    { flags: '{"__proto__":{}}' },
    { flags: '{"x.y":1}' },
    { width: '-1' },
  ]) {
    assert.throws(() => buildDocumentPatch(
      fields,
      values,
      source
    ));
  }
  assert.deepEqual(
    buildDocumentPatch(
    fields,
    { changes: '[]' },
    source
  ).patch,
    {}
  );
}
);

test(
  'Schema fields absent from source remain untouched until edited, and nullable numbers preserve null',
  () => {
  const source = { range: null };
  const schema = {
    range: { constructor: { name: 'NumberField' }, nullable: true },
    added: { constructor: { name: 'NumberField' }, min: 0 },
  };
  const fields = readDocumentFields(
    source,
    schema,
    ['range', 'added']
  );
  assert.deepEqual(
    buildDocumentPatch(
      fields,
      { range: '', added: '' },
      source
    ).patch,
    {},
  );
  assert.deepEqual(
    buildDocumentPatch(
      fields,
      { range: '60', added: '2' },
      source
    ).patch,
    { range: 60, added: 2 },
  );
}
);

test(
  'Library copies preserve all Item content, effects and activities, isolate owner IDs and never mutate the original',
  async (t) => {
  const source = {
    _id: 'source',
    name: '주문',
    type: 'spell',
    folder: 'folder',
    ownership: { default: 3 },
    _stats: {},
    system: {
      activities: { cast: { _id: 'cast', type: 'save', effects: [{ _id: 'effect' }] } },
    },
    effects: [{ _id: 'effect', changes: [] }],
    flags: { custom: { value: 1 } },
  };
  const snapshot = structuredClone(source);
  const previousFoundry = globalThis.foundry;
  t.after(() => {
    globalThis.foundry = previousFoundry;
  });
  globalThis.foundry = { utils: { randomID: () => 'owned' } };
  let written;
  const actor = {
    isOwner: true,
    createEmbeddedDocuments: async (
      type,
      documents
    ) => {
      written = { type, documents };
      return [{ id: 'owned', parent: actor }];
    },
  };
  const created = await copyItemToActor(
    actor,
    {
    documentName: 'Item',
    toObject: () => structuredClone(source),
  }
  );
  assert.equal(
    created.parent,
    actor
  );
  assert.equal(
    written.type,
    'Item'
  );
  assert.equal(
    written.documents[0]._id,
    'owned'
  );
  for (const key of ['_stats', 'folder', 'ownership'])
    assert.equal(
      written.documents[0][key],
      undefined
    );
  assert.deepEqual(
    written.documents[0].effects,
    snapshot.effects
  );
  assert.deepEqual(
    written.documents[0].system,
    snapshot.system
  );
  assert.deepEqual(
    source,
    snapshot
  );
  actor.isOwner = false;
  await assert.rejects(
    copyItemToActor(
    actor,
    { documentName: 'Item' }
  ),
    /권한/
  );
}
);

test(
  'World creation uses the chosen folder and accepts every registered Item type through the Workbench',
  async () => {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    Item: globalThis.Item,
  };
  class ApplicationV2 {
    async close() {
      this.closed = true;
      return this;
    }
    render() {
      return this;
    }
  }
  globalThis.foundry = {
    applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } },
  };
  const types = [
    'weapon',
    'equipment',
    'consumable',
    'tool',
    'loot',
    'race',
    'background',
    'class',
    'subclass',
    'spell',
    'feat',
    'container',
    'backpack',
    'facility',
    'thirdParty',
  ];
  globalThis.game = { system: { documentTypes: { Item: types } } };
  const writes = [];
  globalThis.Item = {
    create: async (data) => {
      writes.push(data);
      return { ...data, id: 'item' };
    },
  };
  try {
    for (const type of types) {
      let selected;
      const app = createItemInWorkbench({
        folder: 'chosen',
        afterCreate: (item) => {
          selected = item;
        },
      });
      await app.config.save({ name: `새 ${type}`, itemType: type });
      assert.equal(
        selected.type,
        type
      );
      assert.equal(
        writes.at(-1).folder,
        'chosen'
      );
    }
    assert.equal(
      writes.length,
      types.length
    );
    const defaultCreation = createItemInWorkbench({ folder: 'chosen', afterCreate() {} });
    defaultCreation.values = () => ({ name: '새 아이템', itemType: 'feat' });
    await defaultCreation.constructor.DEFAULT_OPTIONS.form.handler.call(
      defaultCreation,
      {
      preventDefault() {},
    }
    );
    assert.equal(
      writes.length,
      types.length + 1
    );
    assert.equal(
      writes.at(-1).type,
      'feat'
    );
  } finally {
    Object.assign(
      globalThis,
      previous
    );
  }
}
);

test(
  'Full editor closes without a false numeric draft warning and rejects a conflicting save without writing',
  async () => {
  const previous = { ui: globalThis.ui, foundry: globalThis.foundry };
  const errors = [];
  globalThis.ui = {
    notifications: { error: (message) => errors.push(message), info() {} },
  };
  try {
    let source = { width: 1 };
    let writes = 0;
    const config = {
      title: '검증',
      read: () => source,
      roots: ['width'],
      schema: {},
      canEdit: () => true,
      save: async () => {
        writes++;
      },
    };
    const unchanged = openDocumentWorkbench(config);
    unchanged.values = () => ({ width: '1' });
    await unchanged.close();
    assert.equal(
      unchanged.closed,
      true
    );
    const changed = openDocumentWorkbench(config);
    changed.values = () => ({ width: '2' });
    source = { width: 3 };
    await changed.constructor.DEFAULT_OPTIONS.form.handler.call(
      changed,
      {
      preventDefault() {},
    }
    );
    assert.equal(
      writes,
      0
    );
    assert.equal(
      changed.saved,
      false
    );
    assert.ok(errors.some((message) => message.includes('다른 곳에서 변경')));
    assert.equal(
      changed.values().width,
      '2'
    );
  } finally {
    Object.assign(
      globalThis,
      previous
    );
  }
}
);

test(
  'Item draft snapshots ignore runtime metadata but detect editable changes',
  () => {
  const source = {
    name: '검',
    img: 'icon',
    system: { quantity: 1 },
    flags: {},
    _stats: { modifiedTime: 1 },
  };
  const item = { toObject: () => structuredClone(source) };
  const before = itemEditSnapshot(item);
  source._stats.modifiedTime = 2;
  assert.equal(
    itemEditSnapshot(item),
    before
  );
  source.system.quantity = 2;
  assert.notEqual(
    itemEditSnapshot(item),
    before
  );
}
);

test(
  'Library supports world and visible compendium search, pagination, and cancel-before-copy without creating data',
  async () => {
  const previous = { game: globalThis.game, foundry: globalThis.foundry };
  class ApplicationV2 {
    render() {
      return this;
    }
  }
  globalThis.foundry = {
    applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } },
  };
  const world = Array.from(
    { length: 205 },
    (
    _,
    index
  ) => ({
    id: `item-${index}`,
    name: `검 ${index}`,
    type: 'weapon',
  })
  );
  const pack = {
    collection: 'pack',
    title: '자료',
    documentName: 'Item',
    visible: true,
    getIndex: async () => [{ _id: 'spell', name: '빛', type: 'spell' }],
  };
  globalThis.game = {
    system: { documentTypes: { Item: { weapon: {}, spell: {} } } },
    items: new Map(world.map((item) => [item.id, item])),
    packs: new Map([
      ['pack', pack],
      ['hidden', { ...pack, collection: 'hidden', visible: false }],
    ]),
  };
  let copies = 0;
  const actor = {
    name: '대상',
    isOwner: true,
    createEmbeddedDocuments: async () => {
      copies++;
      return [];
    },
  };
  try {
    const app = openItemLibrary({ actor, beforeCopy: async () => false, afterCopy() {} });
    const filtered = openItemLibrary({ actor, type: 'spell', beforeCopy: async () => false, afterCopy() {} });
    assert.equal(filtered.type, 'spell');
    assert.equal((await filtered._prepareContext()).count, 0);
    const invalid = openItemLibrary({ actor, type: 'unknown', beforeCopy: async () => false, afterCopy() {} });
    assert.equal(invalid.type, '');
    const first = await app._prepareContext();
    assert.equal(
      first.count,
      205
    );
    assert.equal(
      first.rows.length,
      100
    );
    assert.equal(
      first.pages,
      3
    );
    assert.ok(!first.sources.some((entry) => entry.value === 'hidden'));
    app.page = 2;
    assert.equal(
      (await app._prepareContext()).rows.length,
      5
    );
    app.sourceId = 'pack';
    app.query = '빛';
    app.type = 'spell';
    const result = await app._prepareContext();
    assert.equal(
      result.rows[0].id,
      'spell'
    );
    await app.constructor.DEFAULT_OPTIONS.actions.copy.call(
      app,
      { preventDefault() {} },
      { dataset: { itemId: 'spell' } },
    );
    assert.equal(
      copies,
      0
    );
    assert.equal(
      app.busy,
      false
    );
  } finally {
    Object.assign(
      globalThis,
      previous
    );
  }
}
);
