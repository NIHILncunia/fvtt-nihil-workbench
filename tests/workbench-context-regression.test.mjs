import assert from 'node:assert/strict';
import test from 'node:test';
import { formInputEntries } from '../scripts/workbench/form-inputs.mjs';
import { itemEditSnapshot } from '../scripts/workbench/document-fields.mjs';

test(
  'An externally changed Item cannot be overwritten by a pending Workbench draft',
  async () => {
  const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
  class ApplicationV2 { render() { return this; } }
  const source = { name: '검', img: 'icon', type: 'weapon', system: { quantity: 1 }, flags: {} };
  let writes = 0;
  const item = { id: 'item', isOwner: true, toObject: () => structuredClone(source), update: async () => { writes++; } };
  const errors = [];
  globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } } };
  globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' }, items: new Map([['item', item]]) };
  globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
  try {
    const url = new URL(
      '../scripts/workbench/workbench-app.mjs',
      import.meta.url
    );
    url.searchParams.set(
      'draftConflictTest',
      Date.now()
    );
    const { openWorkbench, shouldRefreshAfterItemUpdate } = await import(url.href);
    const app = openWorkbench('item');
    const control = { name: 'itemName', type: 'text', value: '검', dataset: {}, disabled: false };
    app.form = { querySelectorAll: (selector) => selector.includes('[data-type-complex-root]') ? [] : [control] };
    app.initialInputs = new Map(formInputEntries(app.form).map(({ key, value }) => [key, value]));
    app.renderedSource = itemEditSnapshot(item);
    control.value = '새 검';
    app.captureInputs();
    source.system.quantity = 2;
    await app.constructor.DEFAULT_OPTIONS.form.handler.call(
      app,
      { preventDefault() {} },
      app.form
    );
    assert.equal(
      writes,
      0
    );
    assert.equal(
      app.submissionSucceeded,
      false
    );
    assert.equal(
      app.inputDraft.size,
      1
    );
    assert.ok(errors.some((message) => message.includes('다른 곳에서 변경')));
    assert.equal(
      shouldRefreshAfterItemUpdate(
      { savingForm: true, selectedItemId: 'item' },
      item
    ),
      false
    );
  } finally { Object.assign(
    globalThis,
    previous
  ); }
}
);

test(
  'Owned Item reselection stays within the Actor and owned creation never creates a World Folder or Item',
  async () => {
    const previous = {
      game: globalThis.game,
      foundry: globalThis.foundry,
      Item: globalThis.Item,
      Folder: globalThis.Folder,
    };
    const rendered = [];
    const foreground = [];
    class ApplicationV2 {
      render() {
        rendered.push(this);
        return this;
      }
      bringToFront() {
        foreground.push(this);
      }
    }
    globalThis.foundry = {
      applications: {
        api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base },
      },
    };
    const owner = { id: 'owner', items: new Map(), createEmbeddedDocuments: async (
      type,
      sources
    ) => {
      createOptions = { parent: owner, type, sources };
      return [other];
    } };
    const item = { id: 'bite', parent: owner };
    const other = { id: 'claw', parent: owner };
    owner.items.set(
      item.id,
      item,
    );
    owner.items.set(
      other.id,
      other,
    );
    globalThis.game = {
      user: { id: 'rXB1GcSui4mDsgAn' },
      items: new Map([['world', { id: 'world' }]]),
      system: { documentTypes: { Item: ['feat', 'moduleType'] } },
    };
    let folderCreates = 0;
    let createOptions;
    globalThis.Folder = {
      createDialog: () => {
        folderCreates++;
      },
    };
    globalThis.Item = {
      createDialog: async (
        _data,
        options,
      ) => {
        createOptions = options;
        return other;
      },
    };
    try {
      const url = new URL(
        '../scripts/workbench/workbench-app.mjs',
        import.meta.url,
      );
      url.searchParams.set(
        'contextTest',
        Date.now(),
      );
      const { openEmbeddedItemWorkbench } = await import(url.href);
      const app = openEmbeddedItemWorkbench(
        owner,
        item,
      );
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      assert.equal(
        foreground.at(-1),
        app
      );
      app.selectItem(other.id);
      assert.equal(
        app.selectedItem,
        other,
      );
      assert.equal(
        app.documentContext.kind,
        'embedded',
      );
      app.selectItem('world');
      assert.equal(
        app.selectedItem,
        other,
      );
      const event = { preventDefault() {} };
      await app.constructor.DEFAULT_OPTIONS.actions.createFolder.call(
        app,
        event,
      );
      await app.constructor.DEFAULT_OPTIONS.actions.createItem.call(
        app,
        event,
      );
      const editor = rendered.find((entry) => entry.config?.roots?.includes('itemType'));
      await editor.config.save({ name: '모듈 아이템', itemType: 'moduleType' });
      assert.equal(
        folderCreates,
        0,
      );
      assert.equal(
        createOptions.parent,
        owner,
      );
      assert.deepEqual(
        createOptions.sources,
        [{ name: '모듈 아이템', type: 'moduleType' }]
      );
      owner.items.delete(other.id);
      assert.equal(
        app.selectedItem,
        null,
      );
    } finally {
      Object.assign(
        globalThis,
        previous,
      );
    }
  },
);

test(
  'Settings launcher inserts once above the resource manager regardless of hook order',
  async () => {
    const previous = globalThis.game;
    globalThis.game = { user: { id: 'rXB1GcSui4mDsgAn' } };
    const { injectSettingsWorkbenchButton } = await import(
      '../scripts/workbench/launcher-app.mjs'
    );
    const elements = [];
    const placeBefore = (
      reference,
      element,
    ) => {
      const old = elements.indexOf(element);
      if (old !== -1) elements.splice(
        old,
        1,
      );
      elements.splice(
        elements.indexOf(reference),
        0,
        element,
      );
    };
    const resource = {
      dataset: { action: 'open-luxterra-resource-manager' },
      before(element) {
        placeBefore(
          this,
          element,
        );
      },
    };
    const first = {
      before(element) {
        placeBefore(
          this,
          element,
        );
      },
    };
    elements.push(first);
    const root = {
      ownerDocument: {
        createElement: () => ({ dataset: {}, addEventListener() {} }),
      },
      querySelector(selector) {
        if (selector === 'button') return elements[0];
        const action = /data-action="([^"]+)"/.exec(selector)?.[1];
        return elements.find((element) => element.dataset?.action === action);
      },
      querySelectorAll: () => [],
    };
    try {
      injectSettingsWorkbenchButton(root);
      elements.unshift(resource);
      injectSettingsWorkbenchButton(root);
      injectSettingsWorkbenchButton(root);
      assert.equal(
        elements.filter(
          (element) => element.dataset?.action === 'open-ncm-workbench',
        ).length,
        1,
      );
      assert.equal(
        elements[0].dataset.action,
        'open-ncm-workbench',
      );
      assert.equal(
        elements[1],
        resource,
      );
    } finally {
      globalThis.game = previous;
    }
  },
);
