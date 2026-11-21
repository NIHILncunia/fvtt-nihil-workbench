import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/item-document-context.mjs', import.meta.url);

async function loadContext() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('World Item context saves partial updates through Item.update', async () => {
  const { createWorldItemContext } = await loadContext();
  const calls = [];
  const item = {
    id: 'item-1',
    name: '검',
    update: async update => calls.push(update),
    delete: async () => calls.push('delete'),
    clone: async (changes, options) => {
      calls.push(['clone', changes, options]);
      return { id: 'item-copy' };
    },
  };

  const context = createWorldItemContext(item);
  await context.update({ name: '수정됨' });
  await context.duplicate();
  await context.remove();

  assert.equal(context.kind, 'world');
  assert.deepEqual(calls, [
    { name: '수정됨' },
    ['clone', { name: '검 (복제)' }, { save: true }],
    'delete',
  ]);
});

test('World Item context creates through the World Item API only', async () => {
  const { createWorldItemContext } = await loadContext();
  const calls = [];
  const originalItem = globalThis.Item;
  globalThis.Item = {
    create: async source => {
      calls.push(source);
      return { id: 'item-created' };
    },
  };

  try {
    const created = await createWorldItemContext({ id: 'item-1' }).create({ name: '새 아이템', type: 'feat' });
    assert.equal(created.id, 'item-created');
    assert.deepEqual(calls, [{ name: '새 아이템', type: 'feat' }]);
  } finally {
    globalThis.Item = originalItem;
  }
});

test('Embedded Item context saves partial updates through Actor.updateEmbeddedDocuments', async () => {
  const { createEmbeddedItemContext } = await loadContext();
  const calls = [];
  const actor = {
    id: 'actor-1',
    updateEmbeddedDocuments: async (...args) => calls.push(args),
  };
  const item = {
    id: 'embedded-1',
    parent: actor,
    toObject: () => ({ _id: 'embedded-1', name: '검' }),
  };

  const context = createEmbeddedItemContext(actor, item);
  await context.update({ name: '수정됨' });

  assert.equal(context.kind, 'embedded');
  assert.deepEqual(calls, [['Item', [{ _id: 'embedded-1', name: '수정됨' }]]]);
});

test('Embedded Item context fixes the target id instead of accepting a partial _id override', async () => {
  const { createEmbeddedItemContext } = await loadContext();
  const calls = [];
  const actor = {
    id: 'actor-1',
    updateEmbeddedDocuments: async (...args) => calls.push(args),
  };
  const item = { id: 'embedded-1', parent: actor };

  await createEmbeddedItemContext(actor, item).update({ _id: 'other-item', name: '수정됨' });

  assert.deepEqual(calls, [['Item', [{ _id: 'embedded-1', name: '수정됨' }]]]);
});

test('Embedded Item context creates, duplicates, and deletes only inside its Actor', async (t) => {
  const previous = globalThis.foundry;
  globalThis.foundry = { utils: { randomID: () => 'copy123456789012' } };
  t.after(() => { globalThis.foundry = previous; });
  const { createEmbeddedItemContext } = await loadContext();
  const calls = [];
  const actor = {
    id: 'actor-1',
    createEmbeddedDocuments: async (...args) => {
      calls.push(args);
      return [{ id: 'created-item' }];
    },
    deleteEmbeddedDocuments: async (...args) => calls.push(args),
  };
  const item = {
    id: 'embedded-1',
    name: '검',
    parent: actor,
    toObject: () => ({
      _id: 'embedded-1',
      _stats: { modifiedTime: 1 },
      folder: 'world-folder',
      name: '검',
      type: 'weapon',
      system: { damage: { base: { number: 1 } } },
    }),
  };

  const context = createEmbeddedItemContext(actor, item);
  await context.create({ name: '빈 특성', type: 'feat' });
  await context.duplicate();
  await context.remove();

  assert.deepEqual(calls, [
    ['Item', [{ name: '빈 특성', type: 'feat' }]],
    ['Item', [{
      _id: 'copy123456789012',
      name: '검 (복제)',
      type: 'weapon',
      system: { damage: { base: { number: 1 } } },
    }], { keepId: true, keepEmbeddedIds: true }],
    ['Item', ['embedded-1']],
  ]);
});

test('Embedded Item context rejects an Item owned by a different Actor', async () => {
  const { createEmbeddedItemContext } = await loadContext();
  const actor = { id: 'actor-1' };
  const otherActor = { id: 'actor-2' };

  assert.throws(
    () => createEmbeddedItemContext(actor, { id: 'embedded-1', parent: otherActor }),
    /소유 Actor와 Embedded Item이 일치하지 않습니다/,
  );
  assert.throws(
    () => createEmbeddedItemContext(actor, { id: 'world-item' }),
    /소유 Actor와 Embedded Item이 일치하지 않습니다/,
  );
});
