import assert from 'node:assert/strict';
import test from 'node:test';
import { installAutoAnimationsWorldEffectGuard } from '../scripts/workbench/autoanimations-compat.mjs';

function fixture(t) {
  const previous = {
    game: globalThis.game,
    Hooks: globalThis.Hooks,
  };
  t.after(() => Object.assign(
    globalThis,
    previous,
  ));
  const calls = [],
    updates = [];
  globalThis.game = {
    user: {
      id: 'user',
    },
    system: {
      id: 'dnd5e',
    },
    modules: new Map([
      [
        'autoanimations',
        {
          active: true,
          version: '6.5.2',
        },
      ],
    ]),
    settings: {
      get: () => false,
    },
  };
  function createActiveEffects(effect) {
    calls.push(['create', effect]);
    return 'created';
  }
  function toggleActiveEffects(effect) {
    calls.push(['toggle', effect]);
    return 'updated';
  }
  function deleteActiveEffects(effect) {
    calls.push(['delete', effect]);
    return 'deleted';
  }
  globalThis.Hooks = {
    events: {
      createActiveEffect: [
        {
          id: 1,
          fn: function (
            effect,
            options,
            userId,
          ) {
            if (game.user.id !== userId) return;
            return createActiveEffects(effect);
          },
        },
      ],
      updateActiveEffect: [
        {
          id: 2,
          fn: function (
            effect,
            changes,
            options,
            userId,
          ) {
            if (game.user.id !== userId) return;
            return toggleActiveEffects(effect);
          },
        },
      ],
      preDeleteActiveEffect: [
        {
          id: 3,
          fn: function (
            effect,
            options,
            userId,
          ) {
            if (game.user.id !== userId) return;
            return deleteActiveEffects(effect);
          },
        },
      ],
    },
  };
  const worldEffect = {
    parent: {
      documentName: 'Item',
      actor: null,
      flags: {
        autoanimations: {
          animation: 'keep',
        },
      },
    },
    update: async (patch) => {
      updates.push(patch);
      return worldEffect;
    },
  };
  return {
    calls,
    updates,
    worldEffect,
  };
}

test(
  'AUD-05 AA world Item create/toggle/delete guards preserve inherited flags and hook identities',
  async (t) => {
    const { calls, updates, worldEffect } = fixture(t);
    const unaffected = {
      id: 4,
      fn: () => 'another module',
    };
    Hooks.events.createActiveEffect.push(unaffected);
    assert.equal(
      installAutoAnimationsWorldEffectGuard(),
      3,
    );
    assert.equal(
      installAutoAnimationsWorldEffectGuard(),
      0,
    );
    await Hooks.events.createActiveEffect[0].fn(
      worldEffect,
      {},
      'user',
    );
    Hooks.events.updateActiveEffect[0].fn(
      worldEffect,
      {
        disabled: true,
      },
      {},
      'user',
    );
    Hooks.events.preDeleteActiveEffect[0].fn(
      worldEffect,
      {},
      'user',
    );
    assert.equal(
      calls.length,
      0,
    );
    assert.deepEqual(
      updates,
      [
        {
          'flags.autoanimations': {
            animation: 'keep',
          },
        },
      ],
    );
    assert.equal(
      Hooks.events.createActiveEffect[0].id,
      1,
    );
    assert.equal(
      Hooks.events.createActiveEffect[1],
      unaffected,
    );
    assert.equal(
      unaffected.fn(),
      'another module',
    );
  },
);

test(
  'AUD-05 Actor and owned Item animation callbacks still run with the original arguments',
  (t) => {
    const { calls } = fixture(t);
    installAutoAnimationsWorldEffectGuard();
    for (const parent of [
      {
        documentName: 'Actor',
      },
      {
        documentName: 'Item',
        actor: {},
      },
    ]) {
      const effect = {
        parent,
      };
      assert.equal(
        Hooks.events.createActiveEffect[0].fn(
          effect,
          {},
          'user',
        ),
        'created',
      );
      assert.equal(
        Hooks.events.updateActiveEffect[0].fn(
          effect,
          {},
          {},
          'user',
        ),
        'updated',
      );
      assert.equal(
        Hooks.events.preDeleteActiveEffect[0].fn(
          effect,
          {},
          'user',
        ),
        'deleted',
      );
    }
    assert.equal(
      calls.length,
      6,
    );
  },
);

test(
  'AUD-05 inactive, other-version and other-system modules are untouched',
  (t) => {
    fixture(t);
    const original = Hooks.events.createActiveEffect[0].fn;
    const module = game.modules.get('autoanimations');
    module.active = false;
    assert.equal(
      installAutoAnimationsWorldEffectGuard(),
      0,
    );
    module.active = true;
    module.version = '6.5.3';
    assert.equal(
      installAutoAnimationsWorldEffectGuard(),
      0,
    );
    module.version = '6.5.2';
    game.system.id = 'pf2e';
    assert.equal(
      installAutoAnimationsWorldEffectGuard(),
      0,
    );
    assert.equal(
      Hooks.events.createActiveEffect[0].fn,
      original,
    );
  },
);

test(
  'AUD-05 AA disabled animation setting and other user do not copy flags',
  async (t) => {
    const { worldEffect, updates } = fixture(t);
    installAutoAnimationsWorldEffectGuard();
    await Hooks.events.createActiveEffect[0].fn(
      worldEffect,
      {},
      'another',
    );
    game.settings.get = () => true;
    await Hooks.events.createActiveEffect[0].fn(
      worldEffect,
      {},
      'user',
    );
    assert.equal(
      updates.length,
      0,
    );
  },
);
