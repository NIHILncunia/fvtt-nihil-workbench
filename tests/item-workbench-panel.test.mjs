import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/item-workbench-panel.mjs', import.meta.url);

async function loadPanel() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('Item Workbench panel retains basic partial update behavior through a World context', async () => {
  const { createItemWorkbenchPanel } = await loadPanel();
  const calls = [];
  const item = {
    name: '기존 검',
    system: {},
  };
  const context = {
    kind: 'world',
    item,
    update: async update => {
      calls.push(update);
      Object.assign(item, update);
      return item;
    },
  };
  const panel = createItemWorkbenchPanel({ context, onReturn: () => {} });

  await panel.saveBasic({ itemName: '수정된 검' });
  await panel.saveBasic({ itemName: '수정된 검' });

  assert.deepEqual(calls, [{ name: '수정된 검' }]);
});

test('Item Workbench panel applies the same partial basic update through an Embedded context', async () => {
  const { createItemWorkbenchPanel } = await loadPanel();
  const calls = [];
  const context = {
    kind: 'embedded',
    item: {
      name: '기존 발톱',
      system: {},
    },
    update: async update => calls.push(update),
  };
  const panel = createItemWorkbenchPanel({ context, onReturn: () => {} });

  await panel.saveBasic({ itemName: '발톱 공격' });

  assert.deepEqual(calls, [{ name: '발톱 공격' }]);
});

test('Item Workbench panel returns without modifying its Item context', async () => {
  const { createItemWorkbenchPanel } = await loadPanel();
  let returned = 0;
  const panel = createItemWorkbenchPanel({
    context: { item: { name: '검', system: {} }, update: async () => {} },
    onReturn: () => { returned += 1; },
  });

  panel.returnToOwner();

  assert.equal(returned, 1);
});
