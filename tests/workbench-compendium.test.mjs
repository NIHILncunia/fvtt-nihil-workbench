import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPackDocument,
  loadPackDocuments,
  modulePackChoices,
  requireModulePack,
  requirePackDocument,
} from '../scripts/workbench/compendium-adapter.mjs';
import { requireWritableItem } from '../scripts/workbench/write-result.mjs';
import { canEditWorkbenchEffect } from '../scripts/workbench/effect-workbench-app.mjs';
import { formInputEntries } from '../scripts/workbench/form-inputs.mjs';
import { itemEditSnapshot } from '../scripts/workbench/document-fields.mjs';
import {
  containerItems,
  validateContainerMove,
} from '../scripts/workbench/container-adapter.mjs';

const event = { preventDefault() {} };
class NumberField {}

test(
  'Pack loading batches missing IDs and preserves the active document identity',
  async () => {
    const cached = { id: 'cached' };
    const freshDoc = { id: 'fresh' };
    const pack = new Map([['cached', cached]]);
    let queries = 0;
    pack.getIndex = async () => new Map([
      ['cached', { _id: 'cached' }],
      ['fresh', { _id: 'fresh' }],
    ]);
    pack.getDocuments = async (query) => {
      queries++;
      assert.deepEqual(
        query,
        { _id__in: ['fresh'] },
      );
      pack.set(
        'fresh',
        freshDoc,
      );
    };
    assert.deepEqual(
      await loadPackDocuments(pack),
      [cached, freshDoc],
    );
    assert.equal(
      queries,
      1,
    );
    assert.equal(
      pack.get('cached'),
      cached,
    );
    await loadPackDocuments(pack);
    assert.equal(
      queries,
      1,
    );
  },
);

async function fixture(run) {
  const previous = Object.fromEntries(
    ['game', 'foundry', 'ui', 'CONFIG', 'CSS', 'Actor', 'Item'].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  class App {
    render() {
      this.rendered = true;
      return this;
    }
    close() {
      this.rendered = false;
      return this;
    }
    bringToFront() {}
    _onRender() {}
    async _prepareContext() {
      return {};
    }
  }
  globalThis.foundry = {
    utils: { randomID: () => 'newOwnedItem00001' },
    applications: {
      api: {
        ApplicationV2: App,
        HandlebarsApplicationMixin: (base) => base,
        DialogV2: { confirm: async () => true },
      },
    },
  };
  globalThis.game = {
    user: { id: 'rXB1GcSui4mDsgAn', isGM: true },
    system: {
      id: 'dnd5e',
      documentTypes: { Item: ['feat', 'weapon', 'spell'] },
    },
    modules: new Map([
      [
        'nihil-compendium-module',
        {
          packFolders: [
            { name: '공통', packs: ['one', 'actors'], folders: [] },
            { name: '해양', packs: ['two'], folders: [] },
          ],
        },
      ],
    ]),
    packs: new Map(),
    actors: new Map(),
    items: new Map(),
    folders: new Map(),
  };
  globalThis.CONFIG = {};
  globalThis.CSS = { escape: (value) => value };
  const errors = [];
  globalThis.ui = {
    notifications: {
      error: (message) => errors.push(message),
      info() {},
      warn() {},
    },
  };
  const writes = [];
  const addPack = (
    name,
    documentName = 'Item',
  ) => {
    const pack = new Map();
    Object.assign(
      pack,
      {
        collection: `nihil-compendium-module.${name}`,
        title: name,
        documentName,
        metadata: { system: 'dnd5e' },
        visible: true,
        locked: false,
        folders: new Map(),
        testUserPermission: () => true,
        getIndex: async () =>
          new Map(
            Array.from(pack.values()).map((doc) => [
              doc.id,
              { _id: doc.id, name: doc.name, type: doc.type },
            ]),
          ),
        getDocument: async (id) => pack.get(id),
        configure: async (settings) => Object.assign(
          pack,
          settings,
        ),
      },
    );
    pack.documentClass = {
      create: async (
        source,
        options,
      ) => {
        writes.push({ source: structuredClone(source), options });
        return document(
          pack,
          `new-${pack.size}`,
          source,
        );
      },
    };
    game.packs.set(
      pack.collection,
      pack,
    );
    return pack;
  };
  function document(
    pack,
    id,
    data = {},
  ) {
    const source = {
      _id: id,
      name: '원본',
      type: pack.documentName === 'Actor' ? 'npc' : 'weapon',
      img: '',
      system: { magicalBonus: 0, activities: {} },
      flags: {},
      ...data,
    };
    const doc = {
      id,
      documentName: pack.documentName,
      pack: pack.collection,
      type: source.type,
      isOwner: true,
      uuid: `Compendium.${pack.collection}.${pack.documentName}.${id}`,
      get name() {
        return source.name;
      },
      img: '',
      system: {
        ...structuredClone(source.system),
        schema: { fields: { magicalBonus: new NumberField() } },
        activities: new Map(),
      },
      items: new Map(),
      effects: new Map(),
      toObject: () => structuredClone(source),
      canUserModify: () => true,
      update: async (patch) => {
        writes.push({ id, pack: pack.collection, patch });
        for (const [path, value] of Object.entries(patch)) {
          const keys = path.split('.');
          let target = source;
          for (const key of keys.slice(
            0,
            -1,
          )) target = target[key] ??= {};
          target[keys.at(-1)] = structuredClone(value);
          if (path.startsWith('system.')) doc.system[keys.at(-1)] = value;
        }
        return doc;
      },
    };
    pack.set(
      id,
      doc,
    );
    return doc;
  }
  try {
    await run({ addPack, document, writes, errors });
  } finally {
    Object.assign(
      globalThis,
      previous,
    );
  }
}

function form(controls) {
  return {
    elements: {
      namedItem: (name) => controls.find((control) => control.name === name),
    },
    querySelector: (selector) => {
      if (selector.startsWith('[data-type-field]'))
        return controls.find(
          (control) =>
            control.dataset?.typePath &&
            selector.includes(control.dataset.typePath),
        );
      return controls.find((control) =>
        selector.includes(`name=${control.name}`),
      );
    },
    querySelectorAll: (selector) => {
      if (selector.includes('[data-type-field]'))
        return controls.filter((control) => control.dataset?.typePath);
      if (
        selector.startsWith('[data-') ||
        selector.includes('complex') ||
        selector.includes('recovery')
      )
        return [];
      return controls;
    },
  };
}

function control(
  name,
  value,
  dataset = {},
) {
  return {
    name,
    value,
    dataset,
    disabled: false,
    type: 'text',
    tagName: 'INPUT',
  };
}

async function fresh(file) {
  return import(
    `${new URL(
      file,
      import.meta.url,
    ).href}?compendium=${Math.random()}`
  );
}

test(
  'Compendium concepts come from module folders and exclude external, unsupported, hidden and wrong-system packs',
  async () => {
    await fixture(async ({ addPack }) => {
      const one = addPack('one'),
        two = addPack('two');
      const other = addPack('other');
      other.collection = 'another-module.other';
      const hidden = addPack('hidden');
      hidden.visible = false;
      const wrong = addPack('wrong');
      wrong.metadata.system = 'pf2e';
      addPack(
        'journal',
        'JournalEntry',
      );
      assert.deepEqual(
        modulePackChoices().map(({ id, concept }) => ({ id, concept })),
        [
          { id: one.collection, concept: '공통' },
          { id: two.collection, concept: '해양' },
        ],
      );
      assert.throws(
        () => requireModulePack(
          other.collection,
          'Item',
        ),
        /다시 선택/,
      );
      assert.throws(
        () => requireModulePack(
          one.collection,
          'Actor',
        ),
        /다시 선택/,
      );
    });
  },
);

test(
  'Registration targets the chosen pack with native create context and never creates a world document',
  async () => {
    await fixture(async ({ addPack, writes }) => {
      const pack = addPack('one');
      const doc = await createPackDocument(
        pack.collection,
        'Item',
        {
          name: ' 새 주문 ',
          type: 'spell',
        },
      );
      assert.equal(
        doc.pack,
        pack.collection,
      );
      assert.equal(
        doc.name,
        '새 주문',
      );
      assert.deepEqual(
        writes[0].options,
        { pack: pack.collection },
      );
      assert.equal(
        game.items.size,
        0,
      );
      assert.equal(
        game.actors.size,
        0,
      );
      assert.throws(
        () => requirePackDocument({ ...doc, id: 'deleted' }),
        /삭제/,
      );
      assert.equal(
        (await loadPackDocuments(pack))[0],
        doc,
      );
      assert.equal(
        (await loadPackDocuments(pack))[0],
        doc,
      );
    });
  },
);

test(
  'Locked, unauthorized and removed packs reject registration and direct updates without writing',
  async () => {
    await fixture(async ({ addPack, document, writes }) => {
      const pack = addPack('one'),
        doc = document(
          pack,
          'same',
        );
      pack.locked = true;
      await assert.rejects(
        createPackDocument(
          pack.collection,
          'Item',
          {
            name: '거부',
            type: 'feat',
          },
        ),
        /잠겨/,
      );
      assert.throws(
        () => requireWritableItem(
          doc,
          true,
        ),
        /잠겨/,
      );
      pack.locked = false;
      pack.testUserPermission = () => false;
      await assert.rejects(
        createPackDocument(
          pack.collection,
          'Item',
          {
            name: '거부',
            type: 'feat',
          },
        ),
        /권한/,
      );
      pack.testUserPermission = () => true;
      game.user.id = 'ordinary';
      assert.throws(
        () => requireWritableItem(
          doc,
          true,
        ),
        /권한/,
      );
      game.user.id = 'rXB1GcSui4mDsgAn';
      game.packs.delete(pack.collection);
      assert.throws(
        () => requireWritableItem(
          doc,
          true,
        ),
        /다시 선택/,
      );
      assert.equal(
        writes.length,
        0,
      );
    });
  },
);

test(
  'Same IDs in two packs and the world remain separate Item workbench targets and writes',
  async () => {
    await fixture(async ({ addPack, document, writes }) => {
      const one = addPack('one'),
        two = addPack('two');
      const a = document(
        one,
        'same',
      ),
        b = document(
          two,
          'same',
        );
      const world = { id: 'same', name: '월드 원본' };
      game.items.set(
        'same',
        world,
      );
      const { openPackItemWorkbench } = await fresh(
        '../scripts/workbench/workbench-app.mjs',
      );
      const appA = await openPackItemWorkbench(
        one.collection,
        a.id,
      );
      const appB = await openPackItemWorkbench(
        two.collection,
        b.id,
      );
      assert.notEqual(
        appA,
        appB,
      );
      assert.notEqual(
        appA.inputKey,
        appB.inputKey,
      );
      assert.equal(
        appA.selectedItem,
        a,
      );
      assert.equal(
        appB.selectedItem,
        b,
      );
      const name = control(
        'itemName',
        '원본',
      );
      appA.form = form([name]);
      appA.initialInputs = new Map(
        formInputEntries(appA.form).map(({ key, value }) => [key, value]),
      );
      appA.renderedSource = itemEditSnapshot(a);
      appA.renderedInputKey = appA.inputKey;
      name.value = '팩 수정';
      await appA.constructor._submitForm.call(
        appA,
        event,
        appA.form,
      );
      assert.equal(
        appA.submissionSucceeded,
        true,
      );
      assert.equal(
        a.name,
        '팩 수정',
      );
      assert.equal(
        b.name,
        '원본',
      );
      assert.equal(
        world.name,
        '월드 원본',
      );
      assert.equal(
        writes.at(-1).pack,
        one.collection,
      );
    });
  },
);

test(
  'Item pack relocking and external change retain draft and prevent writes',
  async () => {
    await fixture(async ({ addPack, document, writes }) => {
      const pack = addPack('one'),
        doc = document(
          pack,
          'same',
        );
      const { openPackItemWorkbench } = await fresh(
        '../scripts/workbench/workbench-app.mjs',
      );
      const app = await openPackItemWorkbench(
        pack.collection,
        doc.id,
      );
      const name = control(
        'itemName',
        '원본',
      );
      app.form = form([name]);
      app.initialInputs = new Map(
        formInputEntries(app.form).map(({ key, value }) => [key, value]),
      );
      app.renderedSource = itemEditSnapshot(doc);
      app.renderedInputKey = app.inputKey;
      name.value = '초안';
      pack.locked = true;
      await app.constructor._submitForm.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        name.value,
        '초안',
      );
      assert.equal(
        app.inputDraft.size,
        1,
      );
      assert.equal(
        writes.length,
        0,
      );
      pack.locked = false;
      await doc.update({ name: '외부 수정' });
      await app.constructor._submitForm.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        doc.name,
        '외부 수정',
      );
      assert.equal(
        app.submissionSucceeded,
        false,
      );
      assert.equal(
        name.value,
        '초안',
      );
      assert.equal(
        writes.length,
        1,
      );
    });
  },
);

test(
  'Actor pack editor saves the pack document with a world ID collision and keeps cancelled drafts',
  async () => {
    await fixture(async ({ addPack, document, writes }) => {
      const pack = addPack(
        'actors',
        'Actor',
      ),
        actor = document(
          pack,
          'same',
        );
      game.actors.set(
        'same',
        { id: 'same', name: '월드 액터' },
      );
      const { openPackActorWorkbench } = await fresh(
        '../scripts/workbench/actor-workbench-app.mjs',
      );
      const app = await openPackActorWorkbench(
        pack.collection,
        actor.id,
      );
      assert.equal(
        app.selectedActor,
        actor,
      );
      app.drafts.records.set(
        actor.id,
        {
          source: actor.toObject(),
          values: { actorName: '수정 액터' },
        },
      );
      const originalUpdate = actor.update;
      actor.update = async () => undefined;
      await assert.rejects(
        app.saveActorDraft(actor),
        /취소/,
      );
      assert.equal(
        app.drafts.records.size,
        1,
      );
      actor.update = originalUpdate;
      assert.equal(
        await app.saveActorDraft(actor),
        true,
      );
      assert.equal(
        actor.name,
        '수정 액터',
      );
      assert.equal(
        game.actors.get('same').name,
        '월드 액터',
      );
      assert.equal(
        writes.at(-1).pack,
        pack.collection,
      );
      app.drafts.records.set(
        actor.id,
        {
          source: actor.toObject(),
          values: { actorName: '다음 입력' },
        },
      );
      pack.locked = true;
      await assert.rejects(
        app.saveActorDraft(actor),
        /권한|잠겨/,
      );
      assert.equal(
        app.drafts.records.size,
        1,
      );
    });
  },
);

test(
  'Actor pack owned Items and effects obey pack lock and ownership while same-pack containers retain scope',
  async () => {
    await fixture(async ({ addPack, document }) => {
      const pack = addPack(
        'actors',
        'Actor',
      ),
        actor = document(
          pack,
          'actor',
        );
      const item = {
        id: 'child',
        documentName: 'Item',
        parent: actor,
        isOwner: true,
        effects: new Map(),
      };
      actor.items.set(
        item.id,
        item,
      );
      const effect = { id: 'effect', parent: item, isOwner: true };
      item.effects.set(
        effect.id,
        effect,
      );
      assert.equal(
        requireWritableItem(
          item,
          true,
        ),
        item,
      );
      assert.equal(
        canEditWorkbenchEffect(effect),
        true,
      );
      pack.locked = true;
      assert.equal(
        canEditWorkbenchEffect(effect),
        false,
      );
      assert.throws(
        () => requireWritableItem(
          item,
          true,
        ),
        /잠겨/,
      );
      pack.locked = false;
      actor.items.delete(item.id);
      assert.throws(
        () => requireWritableItem(
          item,
          true,
        ),
        /소유 문서/,
      );
      const items = addPack('one');
      const bag = document(
        items,
        'bag',
        {
          type: 'container',
          system: { container: null },
        },
      );
      const held = document(
        items,
        'held',
        {
          type: 'loot',
          system: { container: null },
        },
      );
      assert.equal(
        containerItems(bag).length,
        2,
      );
      assert.doesNotThrow(() => validateContainerMove(
        held,
        bag.id,
      ));
      assert.throws(
        () => validateContainerMove(
          held,
          'world-bag',
        ),
        /보관용품/,
      );
    });
  },
);

test(
  'Compendium manager keeps creation drafts per pack even when changing concepts',
  async () => {
    await fixture(async ({ addPack }) => {
      const one = addPack('one'),
        two = addPack('two');
      const { getCompendiumWorkbenchClass } = await fresh(
        '../scripts/workbench/compendium-workbench-app.mjs',
      );
      const app = new (getCompendiumWorkbenchClass())();
      app.packId = one.collection;
      app.element = form([
        control(
          'packEntryName',
          '공통 초안',
        ),
        control(
          'packEntryType',
          'feat',
        ),
        control(
          'packEntryImg',
          '',
        ),
        control(
          'packConcept',
          '해양',
        ),
        control(
          'packTarget',
          two.collection,
        ),
        control(
          'packSearch',
          '',
        ),
      ]);
      await app.constructor._choose.call(
        app,
        event,
      );
      assert.equal(
        app.packId,
        two.collection,
      );
      assert.equal(
        app.drafts.get(one.collection).name,
        '공통 초안',
      );
      assert.equal(
        app.drafts.has(two.collection),
        false,
      );
      const context = await app._prepareContext();
      assert.equal(
        context.draft.name,
        '',
      );
      assert.equal(
        context.packs.length,
        1,
      );
      assert.equal(
        context.packs[0].id,
        two.collection,
      );
    });
  },
);

test(
  'Compendium manager cancelled registration retains form and retry serializes one native write',
  async () => {
    await fixture(async ({ addPack, writes }) => {
      const pack = addPack('one');
      const { getCompendiumWorkbenchClass } = await fresh(
        '../scripts/workbench/compendium-workbench-app.mjs',
      );
      const app = new (getCompendiumWorkbenchClass())();
      app.packId = pack.collection;
      const name = control(
        'packEntryName',
        '신규',
      );
      app.element = form([
        name,
        control(
          'packEntryType',
          'feat',
        ),
        control(
          'packEntryImg',
          '',
        ),
      ]);
      app.editEntry = async () => {};
      const create = pack.documentClass.create;
      pack.documentClass.create = async () => undefined;
      await app.constructor._create.call(
        app,
        event,
      );
      assert.match(
        app.error,
        /취소/,
      );
      assert.equal(
        app.drafts.get(pack.collection).name,
        '신규',
      );
      let release;
      pack.documentClass.create = async (...args) => {
        await new Promise((resolve) => {
          release = resolve;
        });
        return create(...args);
      };
      const pending = app.constructor._create.call(
        app,
        event,
      );
      assert.equal(
        name.disabled,
        true,
      );
      await app.constructor._create.call(
        app,
        event,
      );
      release();
      await pending;
      assert.equal(
        writes.length,
        1,
      );
      assert.equal(
        name.disabled,
        false,
      );
      assert.equal(
        app.drafts.has(pack.collection),
        false,
      );
      assert.equal(
        game.items.size,
        0,
      );
    });
  },
);

test(
  'First compendium launch brings the window forward only after rendering completes',
  async () => {
    await fixture(async ({ addPack }) => {
      addPack('one');
      const { getCompendiumWorkbenchClass, openCompendiumWorkbench } =
        await fresh('../scripts/workbench/compendium-workbench-app.mjs');
      const Class = getCompendiumWorkbenchClass();
      let release,
        brought = 0;
      Class.prototype.render = function () {
        return new Promise((resolve) => {
          release = () => {
            this.rendered = true;
            resolve(this);
          };
        });
      };
      Class.prototype.bringToFront = function () {
        assert.equal(
          this.rendered,
          true,
        );
        brought++;
      };
      openCompendiumWorkbench();
      assert.equal(
        brought,
        0,
      );
      release();
      await Promise.resolve();
      assert.equal(
        brought,
        1,
      );
    });
  },
);

test(
  'Pack Actor updates and deletions cannot retarget a world editor with the same ID',
  async () => {
    await fixture(async ({ addPack, document }) => {
      const pack = addPack(
        'actors',
        'Actor',
      ),
        actor = document(
          pack,
          'same',
        );
      const world = {
        ...actor,
        pack: null,
        uuid: 'Actor.same',
        folder: { id: 'world-folder' },
      };
      game.actors.set(
        world.id,
        world,
      );
      const { openActorWorkbench, syncUpdatedActor, syncDeletedActor } =
        await fresh('../scripts/workbench/actor-workbench-app.mjs');
      const app = openActorWorkbench({ actorId: world.id });
      assert.equal(
        app.selectedActor,
        world,
      );
      assert.equal(
        syncUpdatedActor(actor),
        false,
      );
      assert.equal(
        syncDeletedActor(
          actor.id,
          null,
          actor.pack,
        ),
        false,
      );
      assert.equal(
        app.selectedActor,
        world,
      );
      assert.equal(
        app.browserStateFor(app.activeType).folderId,
        'world-folder',
      );
    });
  },
);

test(
  'Pack Item updates cannot change a world editor folder or discard its retained input',
  async () => {
    await fixture(async ({ addPack, document }) => {
      const pack = addPack('one'),
        item = document(
          pack,
          'same',
        );
      const world = {
        ...item,
        pack: null,
        uuid: 'Item.same',
        folder: { id: 'world-folder' },
      };
      game.items.set(
        world.id,
        world,
      );
      const { openWorkbench, syncUpdatedItem } = await fresh(
        '../scripts/workbench/workbench-app.mjs',
      );
      const app = openWorkbench(world.id);
      app.inputDraft.set(
        'itemName:INPUT:0',
        '보관 입력',
      );
      assert.equal(
        syncUpdatedItem(item),
        false,
      );
      assert.equal(
        app.selectedItem,
        world,
      );
      assert.equal(
        app.currentFolderId,
        'world-folder',
      );
      assert.equal(
        app.inputDraft.get('itemName:INPUT:0'),
        '보관 입력',
      );
    });
  },
);
