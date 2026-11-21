import assert from 'node:assert/strict';
import test from 'node:test';
import { itemEditSnapshot } from '../scripts/workbench/document-fields.mjs';

for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
  test(
    `${hook} synchronizes World and owned Items, preserves drafts, and registers once`,
    async () => {
      const previous = {
        Hooks: globalThis.Hooks,
        foundry: globalThis.foundry,
        game: globalThis.game,
      };
      const listeners = new Map();
      const once = new Map();
      const renders = [];
      const source = { name: '주문', system: {}, flags: {}, effects: [] };
      class ApplicationV2 {
        static RENDER_STATES = { CLOSED: -1 };
        state = 1;
        render() {
          this.testRenders?.push(this);
          if (this.control) {
            this.control.value = this.testSource.name;
            this._onRender(
              {},
              {},
            );
          }
          return this;
        }
        _onRender() {}
      }
      globalThis.foundry = {
        applications: {
          api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base },
        },
      };
      globalThis.Hooks = {
        on: (
          name,
          callback,
        ) => {
          const callbacks = listeners.get(name) ?? [];
          callbacks.push(callback);
          listeners.set(
            name,
            callbacks,
          );
        },
        once: (
          name,
          callback,
        ) => once.set(
          name,
          callback,
        ),
        callAll() {},
      };
      const world = {
        id: 'same-id', uuid: 'Item.same-id', documentName: 'Item',
        toObject: () => structuredClone(source),
      };
      const actor = { id: 'actor', documentName: 'Actor', items: new Map() };
      const owned = {
        ...world, uuid: 'Actor.actor.Item.same-id', parent: actor,
      };
      actor.items.set(
        owned.id,
        owned,
      );
      globalThis.game = {
        user: { id: 'rXB1GcSui4mDsgAn' },
        items: new Map([[world.id, world]]),
      };
      let app;
      let actorApp;
      try {
        const moduleUrl = new URL(
          '../scripts/module.mjs',
          import.meta.url,
        );
        moduleUrl.searchParams.set(
          'effectSync',
          hook,
        );
        await import(moduleUrl.href);
        once.get('init')();
        once.get('ready')();
        for (const name of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
          assert.equal(
            listeners.get(name).length,
            1,
          );
        }
        const { openWorkbench, openEmbeddedItemWorkbench, syncUpdatedItemEffect } = await import(
          '../scripts/workbench/workbench-app.mjs'
        );
        const { openActorWorkbench } = await import(
          '../scripts/workbench/actor-workbench-app.mjs'
        );
        actorApp = openActorWorkbench();
        app = openWorkbench(world.id);
        actorApp.testRenders = renders;
        app.testRenders = renders;
        app.testSource = source;
        await app.render();
        const control = {
          name: 'itemName', type: 'text', tagName: 'INPUT',
          value: source.name, dataset: {}, disabled: false,
        };
        app.control = control;
        app.form = {
          querySelectorAll: (selector) => selector === 'input, textarea, select' ? [control] : [],
          querySelector: () => null,
        };
        const scroll = { scrollTop: 420 };
        app.element = {
          querySelector: (selector) => selector === '.ncm-workbench__scroll' ? scroll : null,
          querySelectorAll: () => [],
        };
        await app.render();
        control.value = '저장 전 이름';
        app.activityWorkspaceDraft = { name: '작성 중인 액티비티' };
        app.sectionOpenState.set(
          'passive.list',
          true,
        );
        source.effects = [{ name: '외부에서 변경한 효과' }];
        renders.length = 0;
        listeners.get(hook)[0]({ parent: world });
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(
          renders,
          [app],
        );
        assert.equal(
          control.value,
          '저장 전 이름',
        );
        assert.equal(
          app.inputDraft.size,
          1,
        );
        assert.equal(
          app.draftSource,
          itemEditSnapshot(world),
        );
        assert.equal(
          app.activityWorkspaceDraft.name,
          '작성 중인 액티비티',
        );
        assert.equal(
          app.sectionOpenState.get('passive.list'),
          true,
        );
        assert.equal(
          scroll.scrollTop,
          420,
        );

        // The same embedded ID in another document must not redraw this form.
        renders.length = 0;
        listeners.get(hook)[0]({ parent: owned });
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(
          renders,
          [actorApp],
        );

        app.inputDraft.clear();
        control.value = source.name;
        openEmbeddedItemWorkbench(
          actor,
          owned,
        );
        await new Promise((resolve) => setImmediate(resolve));
        renders.length = 0;
        listeners.get(hook)[0]({ parent: owned });
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(renders.includes(app));
        assert.ok(renders.includes(actorApp));

        renders.length = 0;
        listeners.get(hook)[0]({ parent: world });
        assert.deepEqual(
          renders,
          [],
        );
        listeners.get(hook)[0]({ parent: {
          ...owned,
          uuid: 'Actor.other.Item.same-id',
          parent: { id: 'other', documentName: 'Actor' },
        } });
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(
          renders,
          [actorApp],
        );
        renders.length = 0;
        listeners.get(hook)[0]({ parent: actor });
        assert.deepEqual(
          renders,
          [actorApp],
        );
        renders.length = 0;
        listeners.get(hook)[0]({});
        listeners.get(hook)[0]({ parent: { documentName: 'Scene' } });
        assert.deepEqual(
          renders,
          [],
        );

        // Own writes render on completion; a hook must not race the active save.
        app.savingForm = true;
        assert.equal(
          syncUpdatedItemEffect(owned),
          true,
        );
        assert.deepEqual(
          renders,
          [],
        );
        app.savingForm = false;
        app.isSavingActivityWorkspace = true;
        assert.equal(
          syncUpdatedItemEffect(owned),
          true,
        );
        assert.deepEqual(
          renders,
          [],
        );
        app.isSavingActivityWorkspace = false;
        app.state = ApplicationV2.RENDER_STATES.CLOSED;
        assert.equal(
          syncUpdatedItemEffect(owned),
          false,
        );
        assert.deepEqual(
          renders,
          [],
        );
      } finally {
        if (app) app.state = -1;
        if (actorApp) actorApp.state = -1;
        Object.assign(
          globalThis,
          previous,
        );
      }
    },
  );
}
