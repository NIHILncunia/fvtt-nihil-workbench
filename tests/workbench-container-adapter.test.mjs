import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containerDestinationOptions,
  containerItems,
  containerParentId,
  moveContainerItem,
  readContainerManagement,
  validateContainerMove,
} from '../scripts/workbench/container-adapter.mjs';
import { saveBasicItem } from '../scripts/workbench/item-adapter.mjs';
import { formInputEntries } from '../scripts/workbench/form-inputs.mjs';

function fixture(
  id,
  overrides = {},
) {
  const source = {
    name: id,
    type: overrides.type ?? 'container',
    folder: 'unchanged-folder',
    flags: { extension: { untouched: true } },
    system: {
      container: null,
      quantity: 1,
      weight: { value: 2, units: 'lb' },
      capacity: { count: 0, weight: { value: 0, units: 'lb' } },
      ...overrides.system,
    },
  };
  const writes = [];
  const item = {
    id,
    name: source.name,
    type: source.type,
    isOwner: true,
    ...overrides,
    system: { ...source.system, properties: new Set(), contentsWeight: 10, totalWeight: 12 },
    toObject: () => structuredClone(source),
    update: async (update) => {
      writes.push(update);
      if (Object.hasOwn(
        update,
        'system.container'
      )) source.system.container = update['system.container'];
      return item;
    },
    writes,
    source,
  };
  return item;
}

test(
  'container moves change only the parent reference and preserve nested items and unrelated source',
  async () => {
    const bag = fixture('bag');
    const child = fixture(
      'child',
      { system: { container: 'bag' } }
    );
    const loot = fixture(
      'loot',
      { type: 'loot', system: { container: 'child', quantity: 7 } }
    );
    const target = fixture('target');
    const items = [bag, child, loot, target];
    const original = structuredClone(bag.source);
    await moveContainerItem(
      bag,
      target.id,
      { items, expectedParent: '' }
    );
    assert.deepEqual(
      bag.writes,
      [{ 'system.container': 'target' }]
    );
    assert.deepEqual(
      bag.source,
      { ...original, system: { ...original.system, container: 'target' } }
    );
    assert.equal(
      containerParentId(child),
      'bag'
    );
    assert.equal(
      containerParentId(loot),
      'child'
    );
    assert.equal(
      loot.source.system.quantity,
      7
    );
    assert.equal(
      child.writes.length + loot.writes.length,
      0
    );
    await moveContainerItem(
      bag,
      null,
      { items, expectedParent: 'target' }
    );
    assert.deepEqual(
      bag.writes.at(-1),
      { 'system.container': null }
    );
  },
);

test(
  'container destinations reject self, descendants, missing and nonphysical targets before writes',
  async () => {
    const root = fixture('root');
    const child = fixture(
      'child',
      { system: { container: 'root' } }
    );
    const loot = fixture(
      'loot',
      { type: 'loot' }
    );
    const items = [root, child, loot];
    for (const target of ['root', 'child', 'missing', 'loot']) {
      await assert.rejects(moveContainerItem(
        root,
        target,
        { items }
      ));
    }
    assert.deepEqual(
      root.writes,
      []
    );
    assert.deepEqual(
      containerDestinationOptions(
        root,
        items
      ).map((option) => option.value),
      ['']
    );
    const spell = fixture(
      'spell',
      { type: 'spell' }
    );
    delete spell.source.system.container;
    assert.throws(() => validateContainerMove(
      spell,
      'root',
      [...items, spell]
    ));
  },
);

test(
  'maximum nesting validates the entire moved subtree and permits exactly five parents',
  () => {
    const chain = Array.from({ length: 6 }, (
      _,
      index
    ) => fixture(`box${index}`, {
      system: { container: index ? `box${index - 1}` : null },
    }));
    const destination = fixture('destination');
    assert.doesNotThrow(() => validateContainerMove(
      chain[5],
      chain[4].id,
      chain
    ));
    assert.throws(
      () => validateContainerMove(
        chain[0],
        destination.id,
        [...chain, destination]
      ),
      /최대 5/
    );
    assert.doesNotThrow(() => validateContainerMove(
      chain[1],
      destination.id,
      [...chain, destination]
    ));
  },
);

test(
  'owned container collections stay within one Actor even when world or other Actor IDs collide',
  async () => {
    const previous = globalThis.game;
    const actor = { items: new Map(), isOwner: true };
    const otherActor = { items: new Map(), isOwner: true };
    const loot = fixture(
      'loot',
      { type: 'loot', actor }
    );
    const owned = fixture(
      'bag',
      { actor }
    );
    const foreign = fixture(
      'foreign',
      { actor: otherActor }
    );
    const world = fixture('bag');
    actor.items.set(
      'loot',
      loot
    );
    actor.items.set(
      'bag',
      owned
    );
    globalThis.game = { items: new Map([['bag', world]]) };
    try {
      assert.deepEqual(
        containerItems(loot),
        [loot, owned]
      );
      await assert.rejects(
        moveContainerItem(
          loot,
          'foreign',
          { items: [loot, owned, foreign] }
        ),
        /범위/
      );
      await assert.rejects(
        moveContainerItem(
          loot,
          'bag',
          { items: [loot, world] }
        ),
        /범위/
      );
      await moveContainerItem(
        loot,
        'bag'
      );
      assert.deepEqual(
        loot.writes,
        [{ 'system.container': 'bag' }]
      );
      assert.deepEqual(
        world.writes,
        []
      );
      assert.deepEqual(
        containerItems({ pack: 'pack' }),
        []
      );
    } finally { globalThis.game = previous; }
  },
);

test(
  'ownership and stale parent checks block source, current parent, target and Actor edits',
  async () => {
    const loot = fixture(
      'loot',
      { type: 'loot', system: { container: 'bag' } }
    );
    const bag = fixture('bag');
    const target = fixture('target');
    const items = [loot, bag, target];
    await assert.rejects(
      moveContainerItem(
        loot,
        target.id,
        { items, expectedParent: '' }
      ),
      /다른 곳/
    );
    for (const blocked of [loot, bag, target]) {
      blocked.isOwner = false;
      await assert.rejects(
        moveContainerItem(
          loot,
          target.id,
          { items }
        ),
        /권한/
      );
      blocked.isOwner = true;
    }
    const actor = { isOwner: false, items: new Map() };
    loot.actor = actor;
    target.actor = actor;
    await assert.rejects(
      moveContainerItem(
        loot,
        target.id,
        { items }
      ),
      /권한/
    );
    assert.deepEqual(
      loot.writes,
      []
    );
  },
);

test(
  'legacy orphan and cycle links remain visible without no-op writes and can be repaired by removing them',
  async () => {
    const orphan = fixture(
      'orphan',
      { system: { container: 'deleted' } }
    );
    const options = containerDestinationOptions(
      orphan,
      [orphan]
    );
    assert.equal(
      options.at(-1).selected,
      true
    );
    assert.equal(
      options.at(-1).legacy,
      true
    );
    await moveContainerItem(
      orphan,
      'deleted',
      { items: [orphan] }
    );
    assert.deepEqual(
      orphan.writes,
      []
    );
    await moveContainerItem(
      orphan,
      null,
      { items: [orphan] }
    );
    assert.equal(
      containerParentId(orphan),
      null
    );
    const a = fixture(
      'a',
      { system: { container: 'b' } }
    );
    const b = fixture(
      'b',
      { system: { container: 'a' } }
    );
    await moveContainerItem(
      a,
      null,
      { items: [a, b] }
    );
    assert.equal(
      containerParentId(a),
      null
    );
    assert.equal(
      containerParentId(b),
      'a'
    );
  },
);

test(
  'container summary includes nested paths, quantities, native weight and count-first capacity',
  async () => {
    const bag = fixture(
      'bag',
      { system: { capacity: { count: 10, weight: { value: 1, units: 'lb' } } } }
    );
    bag.system.contentsWeight = 14;
    bag.system.totalWeight = 16;
    const child = fixture(
      'child',
      { system: { container: 'bag' } }
    );
    const loot = fixture(
      'loot',
      { type: 'loot', system: { container: 'child', quantity: 7 } }
    );
    const other = fixture(
      'other',
      { type: 'equipment' }
    );
    const items = [bag, child, loot, other];
    const summary = await readContainerManagement(
      bag,
      items
    );
    assert.equal(
      summary.directCount,
      1
    );
    assert.equal(
      summary.count,
      '8'
    );
    assert.equal(
      summary.contentsWeight,
      '14'
    );
    assert.equal(
      summary.totalWeight,
      '16'
    );
    assert.equal(
      summary.overCapacity,
      false
    );
    assert.deepEqual(
      summary.entries[1].path,
      ['child']
    );
    assert.equal(
      summary.entries[1].nested,
      true
    );
    assert.deepEqual(
      summary.candidates.map((item) => item.id),
      ['loot', 'other']
    );
    assert.deepEqual(
      (await readContainerManagement(
        child,
        items
      )).ancestors,
      [{ id: 'bag', name: 'bag' }]
    );
    bag.source.system.capacity.count = 7;
    assert.equal(
      (await readContainerManagement(
        bag,
        items
      )).overCapacity,
      true
    );
  },
);

test(
  'weight capacity converts native units and weightless containers retain native carried weight',
  async () => {
    const previous = globalThis.CONFIG;
    globalThis.CONFIG = { DND5E: { weightUnits: { lb: { conversion: 1 }, kg: { conversion: 2.5 } } } };
    const bag = fixture(
      'bag',
      { system: { capacity: { count: 0, weight: { value: 3, units: 'kg' }, volume: { value: 10, units: 'cuft' } } } }
    );
    bag.system.properties.add('weightlessContents');
    bag.system.totalWeight = 2;
    try {
      const summary = await readContainerManagement(
        bag,
        [bag]
      );
      assert.equal(
        summary.overCapacity,
        true
      );
      assert.equal(
        summary.totalWeight,
        '2'
      );
      assert.equal(
        summary.weightless,
        true
      );
      assert.equal(
        summary.volumeLimit,
        '10 cuft'
      );
      bag.source.system.capacity.weight.value = 4;
      assert.equal(
        (await readContainerManagement(
          bag,
          [bag]
        )).overCapacity,
        false
      );
    } finally { globalThis.CONFIG = previous; }
  },
);

test(
  'corrupt container graphs never invoke recursive native weight getters',
  async () => {
    const a = fixture(
      'a',
      { system: { container: 'b' } }
    );
    const b = fixture(
      'b',
      { system: { container: 'a' } }
    );
    let reads = 0;
    Object.defineProperty(
      a.system,
      'contentsWeight',
      { get() { reads++; throw new Error('recursive getter'); } }
    );
    const summary = await readContainerManagement(
      a,
      [a, b]
    );
    assert.ok(summary.warnings.length);
    assert.equal(
      summary.contentsWeight,
      '—'
    );
    assert.equal(
      summary.count,
      '—'
    );
    assert.equal(
      reads,
      0
    );
  },
);

test(
  'basic save validates a changed container before writing any name or other basic fields',
  async () => {
    const previous = globalThis.game;
    const bag = fixture('bag');
    const child = fixture(
      'child',
      { system: { container: 'bag' } }
    );
    globalThis.game = { items: new Map([['bag', bag], ['child', child]]) };
    try {
      await assert.rejects(
        saveBasicItem(
          bag,
          { name: '새 이름', inventory: { containerId: 'child' } }
        ),
        /하위/
      );
      assert.deepEqual(
        bag.writes,
        []
      );
    } finally { globalThis.game = previous; }
  },
);

test(
  'immediate container selectors never become saved form fields or trigger draft discard guards',
  () => {
    const control = { name: 'itemName', type: 'text', tagName: 'INPUT', value: '가방', dataset: {} };
    const transient = { tagName: 'SELECT', value: 'loot', hasAttribute: (name) => name === 'data-workbench-transient' };
    const entries = formInputEntries({ querySelectorAll: () => [control, transient] });
    assert.equal(
      entries.length,
      1
    );
    assert.equal(
      entries[0].control,
      control
    );
  },
);

test(
  'full workbench save retains both drafts when a container relation is invalid',
  async () => {
    const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
    const bag = fixture('bag');
    const child = fixture(
      'child',
      { system: { container: 'bag' } }
    );
    class ApplicationV2 { render() { return this; } }
    const errors = [];
    globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } } };
    globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([['bag', bag], ['child', child]]) };
    globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
    try {
      const url = new URL(
        '../scripts/workbench/workbench-app.mjs',
        import.meta.url
      );
      url.searchParams.set(
        'containerSaveTest',
        Date.now()
      );
      const { openWorkbench } = await import(url.href);
      const { itemEditSnapshot } = await import('../scripts/workbench/document-fields.mjs');
      const app = openWorkbench('bag');
      const name = { name: 'itemName', type: 'text', tagName: 'INPUT', value: 'bag', dataset: {} };
      const parent = { name: 'containerId', type: 'select-one', tagName: 'SELECT', value: '', dataset: {} };
      const form = {
        elements: { namedItem: (nameValue) => nameValue === 'itemName' ? name : nameValue === 'containerId' ? parent : null },
        querySelectorAll: (selector) => selector === 'input, textarea, select' ? [name, parent] : [],
        querySelector: (selector) => selector.includes('itemName') ? name : selector.includes('containerId') ? parent : null,
      };
      app.form = form;
      app.initialInputs = new Map(formInputEntries(form).map(({ key, value }) => [key, value]));
      app.renderedSource = itemEditSnapshot(bag);
      name.value = '새 가방';
      parent.value = 'child';
      await app.constructor.DEFAULT_OPTIONS.form.handler.call(
        app,
        { preventDefault() {} },
        form
      );
      assert.equal(
        app.submissionSucceeded,
        false
      );
      assert.equal(
        app.inputDraft.size,
        2
      );
      assert.deepEqual(
        bag.writes,
        []
      );
      assert.ok(errors.some((message) => message.includes('하위')));
    } finally {
      globalThis.game = previous.game;
      globalThis.foundry = previous.foundry;
      globalThis.ui = previous.ui;
    }
  },
);
