import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbeddedItemContext } from '../scripts/workbench/item-document-context.mjs';
import { formInputEntries } from '../scripts/workbench/form-inputs.mjs';
import { itemEditSnapshot } from '../scripts/workbench/document-fields.mjs';
import { rebaseItemDraftSnapshot } from '../scripts/workbench/save-state.mjs';

const event = {
  preventDefault() {},
};
class NumberField {}
class StringField {}

async function fixture(run) {
  const previous = {
    foundry: globalThis.foundry,
    game: globalThis.game,
    ui: globalThis.ui,
    CONFIG: globalThis.CONFIG,
    CSS: globalThis.CSS,
  };
  class ApplicationV2 {
    render() {
      return this;
    }
    async close() {
      this.closed = true;
      return this;
    }
    _onRender() {}
    async _prepareContext() {
      return {};
    }
  }
  const errors = [];
  globalThis.foundry = {
    utils: {
      randomID: () => 'newItem1234567890',
    },
    applications: {
      api: {
        ApplicationV2,
        HandlebarsApplicationMixin: (base) => base,
        DialogV2: {
          confirm: async () => true,
        },
      },
    },
  };
  globalThis.game = {
    user: {
      id: 'rXB1GcSui4mDsgAn',
    },
    items: new Map(),
    actors: new Map(),
    folders: new Map(),
    modules: new Map(),
  };
  globalThis.CONFIG = {};
  globalThis.CSS = {
    escape: (value) => value,
  };
  globalThis.ui = {
    notifications: {
      error: (message) => errors.push(message),
      info() {},
      warn() {},
    },
  };
  try {
    await run(errors);
  } finally {
    Object.assign(
      globalThis,
      previous,
    );
  }
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
    type: 'text',
    tagName: 'INPUT',
    disabled: false,
  };
}

function form(controls) {
  return {
    elements: {
      namedItem: (name) => controls.find((entry) => entry.name === name),
    },
    querySelector: (selector) =>
      selector.startsWith('[data-type-field]')
        ? (controls.find((entry) => selector.includes(`"${entry.dataset.typePath}"`)) ?? null)
        : null,
    querySelectorAll: (selector) => {
      if (selector === '[data-advancement-field]')
        return controls.filter((entry) => entry.dataset.advancementPath);
      if (selector === '[data-activity-common-field], [data-activity-specific-field]')
        return controls.filter((entry) => entry.dataset.activityPath);
      if (
        selector.includes('damage-row') ||
        selector.includes('complex') ||
        selector.includes('recovery')
      )
        return [];
      return controls;
    },
  };
}

async function fresh(file) {
  return import(`${new URL(
    file,
    import.meta.url,
  ).href}?audit=${Date.now()}-${Math.random()}`);
}

function setPath(
  source,
  path,
  value,
) {
  const keys = path.split('.');
  let target = source;
  for (const key of keys.slice(
    0,
    -1,
  )) target = target[key] ??= {};
  target[keys.at(-1)] = structuredClone(value);
}

async function itemFixture(controls) {
  const source = {
    name: '원본',
    type: 'weapon',
    img: '',
    system: {
      magicalBonus: 0,
      activities: {},
    },
    flags: {},
  };
  const writes = [];
  const item = {
    id: 'item',
    type: 'weapon',
    isOwner: true,
    img: '',
    get name() {
      return source.name;
    },
    system: {
      magicalBonus: 0,
      schema: {
        fields: {
          magicalBonus: new NumberField(),
        },
      },
      activities: new Map(),
    },
    toObject: () => structuredClone(source),
    update: async (patch) => {
      writes.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        setPath(
          source,
          path,
          value,
        );
        if (path.startsWith('system.')) setPath(
          item,
          path,
          value,
        );
      }
      return item;
    },
  };
  game.items.set(
    item.id,
    item,
  );
  const { openWorkbench } = await fresh('../scripts/workbench/workbench-app.mjs');
  const app = openWorkbench(item.id);
  app.form = form(controls);
  app.initialInputs = new Map(formInputEntries(app.form).map(({ key, value }) => [key, value]));
  app.renderedSource = itemEditSnapshot(item);
  app.renderedInputKey = app.inputKey;
  return {
    app,
    item,
    source,
    writes,
  };
}

test(
  'AUD-01 owned duplication rewrites self references and preserves sibling, provenance and original',
  async () => {
    await fixture(async () => {
      for (const actorType of ['character', 'npc']) {
        const source = {
          _id: 'original',
          name: '원본',
          type: 'weapon',
          folder: 'world',
          ownership: {
            default: 3,
          },
          _stats: {
            compendiumSource: 'Compendium.library.Item.source',
          },
          system: {
            container: 'bag',
            activities: {
              attack: {
                effects: [
                  {
                    _id: 'effect',
                  },
                ],
                consumption: {
                  targets: [
                    {
                      type: 'itemUses',
                      target: 'original',
                    },
                    {
                      type: 'itemUses',
                      target: 'sibling',
                    },
                    {
                      type: 'material',
                      target: 'Actor.other.Item.external',
                    },
                  ],
                },
              },
            },
            advancement: [
              {
                type: 'ItemGrant',
                value: {
                  added: {
                    original: 'Item.library',
                    sibling: 'Item.sibling',
                  },
                },
              },
            ],
          },
          effects: [
            {
              _id: 'effect',
              origin: 'Actor.owner.Item.original',
            },
          ],
          flags: {
            custom: {
              reference: 'original',
            },
          },
        };
        const original = structuredClone(source);
        let write;
        const actor = {
          id: 'owner',
          uuid: 'Actor.owner',
          type: actorType,
          items: new Map([['sibling', {}]]),
          createEmbeddedDocuments: async (
            type,
            documents,
            options,
          ) => {
            write = {
              documents,
              options,
            };
            return [
              {
                id: documents[0]._id,
                parent: actor,
              },
            ];
          },
        };
        const item = {
          id: 'original',
          uuid: 'Actor.owner.Item.original',
          name: source.name,
          parent: actor,
          toObject: () => structuredClone(source),
        };
        const copy = await createEmbeddedItemContext(
          actor,
          item,
        ).duplicate();
        const data = write.documents[0];
        assert.equal(
          data.system.activities.attack.consumption.targets[0].target,
          copy.id,
        );
        assert.equal(
          data.effects[0].origin,
          `Actor.owner.Item.${copy.id}`,
        );
        assert.equal(
          data.system.activities.attack.consumption.targets[1].target,
          'sibling',
        );
        assert.equal(
          data.system.container,
          'bag',
        );
        assert.equal(
          data.system.advancement[0].value.added[copy.id],
          'Item.library',
        );
        assert.equal(
          data.system.advancement[0].value.added.sibling,
          'Item.sibling',
        );
        assert.deepEqual(
          data._stats,
          {
            compendiumSource: source._stats.compendiumSource,
          },
        );
        assert.deepEqual(
          data.flags.custom,
          source.flags.custom,
        );
        assert.deepEqual(
          write.options,
          {
            keepId: true,
            keepEmbeddedIds: true,
          },
        );
        assert.deepEqual(
          source,
          original,
        );
      }
    });
  },
);

test(
  'AUD-02 cancelled world and owned deletion retains selection and reports failure',
  async () => {
    await fixture(async (errors) => {
      for (const owned of [false, true]) {
        const { app, item } = await itemFixture([]);
        if (owned) {
          const actor = {
            id: 'owner',
            items: new Map([[item.id, item]]),
            isOwner: true,
            deleteEmbeddedDocuments: async () => [],
          };
          item.parent = actor;
          game.actors.set(
            actor.id,
            actor,
          );
          app.selectEmbeddedItem(
            actor,
            item,
          );
        } else item.delete = async () => undefined;
        const target = app.selectedItem;
        await app.constructor.DEFAULT_OPTIONS.actions.deleteItem.call(
          app,
          event,
        );
        assert.equal(
          app.selectedItem,
          target,
        );
        assert.match(
          errors.at(-1),
          /취소/,
        );
      }
    });
  },
);

test(
  'AUD-03 actor delayed save serializes writes, locks inputs and rejects closing or target changes',
  async () => {
    await fixture(async () => {
      const source = {
        name: '원본',
        type: 'npc',
        system: {},
      };
      let resolve,
        writes = 0;
      const actor = {
        id: 'actor',
        type: 'npc',
        isOwner: true,
        system: {},
        toObject: () => structuredClone(source),
        update: async (patch) => {
          writes++;
          await new Promise((done) => {
            resolve = done;
          });
          Object.assign(
            source,
            patch,
          );
          return actor;
        },
      };
      game.actors.set(
        actor.id,
        actor,
      );
      const { openActorWorkbench } = await fresh('../scripts/workbench/actor-workbench-app.mjs');
      const app = openActorWorkbench({
        actorId: actor.id,
      });
      const input = control(
        'actorName',
        '첫 입력',
      );
      app.form = form([input]);
      app.renderedActorId = actor.id;
      app.renderedActorDocument = actor;
      app.initialControls = {
        actorName: '원본',
      };
      app.captureEditorDraft();
      const pending = app.saveActorDraft(actor);
      assert.equal(
        input.disabled,
        true,
      );
      assert.equal(
        await app.saveActorDraft(actor),
        false,
      );
      assert.equal(
        await app.close(),
        app,
      );
      assert.ok(!app.closed);
      app.selectActor({
        ...actor,
        id: 'other',
      });
      assert.equal(
        app.selectedActor,
        actor,
      );
      assert.equal(
        writes,
        1,
      );
      resolve();
      assert.equal(
        await pending,
        true,
      );
      assert.equal(
        input.disabled,
        false,
      );
      assert.equal(
        source.name,
        '첫 입력',
      );
    });
  },
);

test(
  'AUD-03 item delayed save rejects duplicate submit and unlocks the original controls',
  async () => {
    await fixture(async () => {
      const input = control(
        'itemName',
        '원본',
      );
      const { app, item } = await itemFixture([input]);
      let resolve,
        writes = 0;
      item.update = async () => {
        writes++;
        await new Promise((done) => {
          resolve = done;
        });
        return item;
      };
      input.value = '수정';
      const handler = app.constructor.DEFAULT_OPTIONS.form.handler;
      const pending = handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        input.disabled,
        true,
      );
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        await app.guardItemTransition(),
        false,
      );
      assert.equal(
        writes,
        1,
      );
      resolve();
      await pending;
      assert.equal(
        input.disabled,
        false,
      );
      assert.equal(
        app.savingForm,
        false,
      );
    });
  },
);

test(
  'AUD-04 basic and type edits use one atomic Item write',
  async () => {
    await fixture(async () => {
      const name = control(
        'itemName',
        '원본',
      );
      const bonus = control(
        '',
        '0',
        {
          typePath: 'magicalBonus',
        },
      );
      const { app, source, writes } = await itemFixture([name, bonus]);
      name.value = '수정';
      bonus.value = '2';
      await app.constructor.DEFAULT_OPTIONS.form.handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        writes.length,
        1,
      );
      assert.deepEqual(
        writes[0],
        {
          name: '수정',
          'system.magicalBonus': 2,
        },
      );
      assert.equal(
        source.name,
        '수정',
      );
      assert.equal(
        app.submissionSucceeded,
        true,
      );
    });
  },
);

test(
  'AUD-04 confirmed basic write then cancelled activity can retry without discarding input',
  async () => {
    await fixture(async (errors) => {
      const name = control(
        'itemName',
        '원본',
      );
      const duration = control(
        '',
        'old',
        {
          activityPath: 'duration.units',
        },
      );
      const { app, item, source, writes } = await itemFixture([name, duration]);
      const data = {
        _id: 'activity',
        type: 'utility',
        duration: {
          units: 'old',
        },
      };
      class SchemaField {
        constructor(fields) {
          this.fields = fields;
        }
      }
      let cancelled = true;
      const activity = {
        id: 'activity',
        type: 'utility',
        schema: {
          fields: {
            duration: new SchemaField({
              units: new StringField(),
            }),
          },
        },
        toObject: () => structuredClone(data),
        update: async (patch) => {
          if (cancelled) return undefined;
          for (const [path, value] of Object.entries(patch)) setPath(
            data,
            path,
            value,
          );
          source.system.activities.activity = structuredClone(data);
          return activity;
        },
      };
      source.system.activities.activity = structuredClone(data);
      item.system.activities.set(
        activity.id,
        activity,
      );
      app.selectedActivityId = activity.id;
      app.renderedSource = itemEditSnapshot(item);
      name.value = '수정';
      duration.value = 'new';
      const handler = app.constructor.DEFAULT_OPTIONS.form.handler;
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        source.name,
        '수정',
      );
      assert.equal(
        app.submissionSucceeded,
        false,
      );
      assert.match(
        errors.at(-1),
        /일부|부분/,
      );
      cancelled = false;
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        app.submissionSucceeded,
        true,
      );
      assert.equal(
        data.duration.units,
        'new',
      );
      assert.equal(
        writes.length,
        1,
      );
    });
  },
);

test(
  'AUD-04 acknowledged fields rebase without blessing concurrent external flags or sibling advancements',
  () => {
    const baseline = {
      name: '원본',
      system: {
        advancement: [
          {
            _id: 'selected',
            hint: 'old',
          },
          {
            _id: 'sibling',
            hint: 'keep',
          },
        ],
      },
      flags: {
        external: 'old',
      },
    };
    const current = structuredClone(baseline);
    current.name = 'saved';
    current.flags.external = 'another writer';
    current.system.advancement[0].hint = 'saved';
    current.system.advancement[1].hint = 'another writer';
    const snapshot = itemEditSnapshot({
      toObject: () => baseline,
    });
    const rebased = JSON.parse(
      rebaseItemDraftSnapshot(
        snapshot,
        {
          toObject: () => current,
        },
        [
          'name',
          {
            advancementId: 'selected',
          },
        ],
      ),
    );
    assert.equal(
      rebased.name,
      'saved',
    );
    assert.equal(
      rebased.system.advancement[0].hint,
      'saved',
    );
    assert.equal(
      rebased.system.advancement[1].hint,
      'keep',
    );
    assert.equal(
      rebased.flags.external,
      'old',
    );
    assert.notEqual(
      JSON.stringify(rebased),
      itemEditSnapshot({
        toObject: () => current,
      }),
    );
  },
);

test(
  'AUD-04 native derived riders do not create false conflicts; actual references and other flags still do',
  () => {
    const source = {
      name: '원본',
      system: {
        activities: {
          activity: {
            effects: [],
          },
        },
      },
      flags: {},
    };
    const item = {
      toObject: () => structuredClone(source),
    };
    const baseline = itemEditSnapshot(item);
    source.flags.dnd5e = {
      riders: {
        activity: [],
      },
    };
    assert.equal(
      itemEditSnapshot(item),
      baseline,
    );
    assert.deepEqual(
      source.flags.dnd5e.riders,
      {
        activity: [],
      },
    );
    source.flags.dnd5e.advancementOrigin = 'another-item.growth';
    assert.notEqual(
      itemEditSnapshot(item),
      baseline,
    );
    delete source.flags.dnd5e.advancementOrigin;
    source.system.activities.activity.effects.push({
      _id: 'effect',
    });
    assert.notEqual(
      itemEditSnapshot(item),
      baseline,
    );
  },
);

test(
  'AUD-04 cancelled combined Item write retains both basic and type input for same-form retry',
  async () => {
    await fixture(async (errors) => {
      const name = control(
        'itemName',
        '원본',
      );
      const bonus = control(
        '',
        '0',
        {
          typePath: 'magicalBonus',
        },
      );
      const { app, item, source, writes } = await itemFixture([name, bonus]);
      const original = item.update;
      item.update = async () => undefined;
      name.value = '수정';
      bonus.value = '2';
      const handler = app.constructor.DEFAULT_OPTIONS.form.handler;
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        source.name,
        '원본',
      );
      assert.equal(
        source.system.magicalBonus,
        0,
      );
      assert.equal(
        app.submissionSucceeded,
        false,
      );
      assert.match(
        errors.at(-1),
        /취소/,
      );
      assert.equal(
        name.disabled,
        false,
      );
      item.update = original;
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        app.submissionSucceeded,
        true,
      );
      assert.equal(
        writes.length,
        1,
      );
      assert.equal(
        source.name,
        '수정',
      );
      assert.equal(
        source.system.magicalBonus,
        2,
      );
    });
  },
);

test(
  'AUD-04 cancelled growth after confirmed Item save retries selected advancement and retains siblings',
  async () => {
    await fixture(async () => {
      const name = control(
        'itemName',
        '원본',
      );
      const hint = control(
        '',
        'old',
        {
          advancementPath: 'hint',
        },
      );
      const { app, item, source, writes } = await itemFixture([name, hint]);
      const data = {
        _id: 'growth',
        type: 'ScaleValue',
        title: 'scale',
        hint: 'old',
        configuration: {
          type: 'number',
          identifier: 'scale',
          scale: {},
        },
        value: {},
      };
      const growth = {
        id: 'growth',
        type: 'ScaleValue',
        item,
        constructor: {
          schema: {
            fields: {
              hint: new StringField(),
            },
          },
        },
        toObject: () => structuredClone(data),
      };
      item.advancement = {
        byId: {
          growth,
        },
      };
      source.system.advancement = [
        structuredClone(data),
        {
          _id: 'other',
          hint: 'keep',
        },
      ];
      let cancelled = true,
        growthWrites = 0;
      item.updateAdvancement = async (
        id,
        patch,
      ) => {
        growthWrites++;
        assert.equal(
          id,
          'growth',
        );
        if (cancelled) return undefined;
        for (const [path, value] of Object.entries(patch)) setPath(
          data,
          path,
          value,
        );
        source.system.advancement[0] = structuredClone(data);
        return item;
      };
      app.selectedAdvancementId = 'growth';
      app.renderedSource = itemEditSnapshot(item);
      name.value = '수정';
      hint.value = 'new';
      const handler = app.constructor.DEFAULT_OPTIONS.form.handler;
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        app.submissionSucceeded,
        false,
      );
      assert.equal(
        source.name,
        '수정',
      );
      cancelled = false;
      await handler.call(
        app,
        event,
        app.form,
      );
      assert.equal(
        app.submissionSucceeded,
        true,
      );
      assert.equal(
        data.hint,
        'new',
      );
      assert.equal(
        source.system.advancement[1].hint,
        'keep',
      );
      assert.equal(
        writes.length,
        1,
      );
      assert.equal(
        growthWrites,
        2,
      );
    });
  },
);

test(
  'AUD-03 failed Actor save unlocks controls and keeps the draft for retry',
  async () => {
    await fixture(async () => {
      const source = {
        name: '원본',
        type: 'npc',
        system: {},
      };
      const actor = {
        id: 'actor',
        type: 'npc',
        isOwner: true,
        system: {},
        toObject: () => structuredClone(source),
        update: async () => undefined,
      };
      game.actors.set(
        actor.id,
        actor,
      );
      const { openActorWorkbench } = await fresh('../scripts/workbench/actor-workbench-app.mjs');
      const app = openActorWorkbench({
        actorId: actor.id,
      });
      const input = control(
        'actorName',
        '수정',
      );
      const protectedInput = {
        ...control(
          'actorImg',
          '',
        ),
        disabled: true,
      };
      app.form = form([input, protectedInput]);
      app.drafts.records.set(
        actor.id,
        {
          values: {
            actorName: '수정',
          },
          source,
        },
      );
      await assert.rejects(
        app.saveActorDraft(actor),
        /취소/,
      );
      assert.equal(
        input.disabled,
        false,
      );
      assert.equal(
        protectedInput.disabled,
        true,
      );
      assert.equal(
        app.savingActor,
        false,
      );
      assert.equal(
        app.drafts.records.get(actor.id).values.actorName,
        '수정',
      );
      actor.update = async (patch) => {
        Object.assign(
          source,
          patch,
        );
        return actor;
      };
      assert.equal(
        await app.saveActorDraft(actor),
        true,
      );
      assert.equal(
        source.name,
        '수정',
      );
    });
  },
);
