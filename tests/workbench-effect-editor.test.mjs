import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentPatch } from '../scripts/workbench/document-fields.mjs';
import {
  effectFields,
  effectStatusOptions,
  validateEffectPatch,
} from '../scripts/workbench/effect-fields.mjs';
import { editEffect } from '../scripts/workbench/effect-workbench-app.mjs';
import { getDocumentWorkbenchClass } from '../scripts/workbench/document-workbench-app.mjs';

const source = {
  name: '방어 효과',
  img: 'icons/svg/shield.svg',
  tint: '#ffffff',
  description: '<p>설명</p>\r\n<p>유지</p>',
  disabled: false,
  transfer: true,
  origin: 'Item.original',
  statuses: ['custom', 'prone'],
  // Foundry v14 구조: 변경값은 system.changes(문자열 type), 지속시간은 { value, units, expiry }, 시작은 start.
  duration: {
    value: 2,
    units: 'rounds',
    expiry: 'turnStart',
    expired: false,
  },
  start: {
    combat: 'old',
    combatant: null,
    initiative: null,
    round: null,
    turn: 0,
    time: 10,
  },
  flags: {
    dae: {
      enableCondition: '',
      disableCondition: '@abilities.str.value < 10',
      other: true,
    },
    other: {
      custom: 1,
    },
  },
  system: {
    extension: true,
    changes: [
      {
        key: 'system.attributes.ac.bonus',
        type: 'add',
        value: '1',
        phase: 'initial',
        priority: null,
        extension: true,
      },
    ],
  },
};

test(
  'Effect normal fields preserve missing flags and duration, and patch only changed values',
  () => {
    const fields = effectFields(source);
    const values = Object.fromEntries(
      fields.map((field) => [field.path, field.initial]),
    );
    assert.deepEqual(
      buildDocumentPatch(
        fields,
        values,
        source,
      ).patch,
      {},
    );
    assert.equal(
      fields.find((field) => field.path === 'description').initial,
      '<p>설명</p>\n<p>유지</p>',
    );
    values['duration.value'] = '3';
    values['flags.dae.disableCondition'] = '@abilities.str.value < 12';
    assert.deepEqual(
      buildDocumentPatch(
        fields,
        values,
        source,
      ).patch,
      {
        'duration.value': 3,
        'flags.dae.disableCondition': '@abilities.str.value < 12',
      },
    );
    const absent = {
      name: '효과',
      system: { changes: [] },
      statuses: [],
      flags: {},
    };
    const absentFields = effectFields(
      absent,
      {
        dae: true,
      },
    );
    assert.deepEqual(
      buildDocumentPatch(
        absentFields,
        Object.fromEntries(
          absentFields.map((field) => [field.path, field.initial]),
        ),
        absent,
      ).patch,
      {},
    );
  },
);

test(
  'Effect durations reject negative and fractional values, require integer world time and allow clearing to null',
  () => {
    const fields = effectFields(source);
    for (const value of ['-1', '1.5', 'oops']) {
      assert.throws(
        () =>
          buildDocumentPatch(
            fields,
            {
              'duration.value': value,
            },
            source,
          ),
        /숫자/,
      );
    }
    assert.deepEqual(
      buildDocumentPatch(
        fields,
        {
          'start.time': '12',
          'duration.value': '',
        },
        source,
      ).patch,
      {
        'start.time': 12,
        'duration.value': null,
      },
    );
    assert.throws(
      () => buildDocumentPatch(fields, { 'start.time': '12.75' }, source),
      /숫자/,
    );
  },
);

test(
  'Effect fields retain unavailable combat references and DAE conditions only when relevant',
  () => {
    const fields = effectFields(
      source,
      {
        combats: [
          {
            id: 'new',
            name: '전투',
          },
        ],
      },
    );
    assert.ok(
      fields
        .find((field) => field.path === 'start.combat')
        .options.some((entry) => entry.value === 'old' && entry.selected),
    );
    assert.ok(
      !effectFields({
        flags: {},
      }).some((field) => field.group === 'conditions'),
    );
    assert.ok(
      effectFields(
        {
          flags: {},
        },
        {
          dae: true,
        },
      ).some((field) => field.path === 'flags.dae.enableCondition'),
    );
  },
);

test(
  'Effect changes preserve multiline values, null priority and unknown row extensions',
  () => {
    const fields = effectFields(source);
    const changes = structuredClone(source.system.changes);
    changes[0].value = 'line 1\nline 2';
    const patch = buildDocumentPatch(
      fields,
      {
        'system.changes': JSON.stringify(changes),
      },
      source,
    ).patch;
    assert.deepEqual(
      patch['system.changes'],
      [
        {
          ...source.system.changes[0],
          value: 'line 1\nline 2',
        },
      ],
    );
  },
);

test(
  'Effect edits detect conflicts without rejecting unrelated external changes',
  () => {
    const fields = effectFields(source);
    const current = structuredClone(source);
    current.flags.other.custom = 2;
    assert.deepEqual(
      buildDocumentPatch(
        fields,
        {
          name: '보호',
        },
        current,
      ).conflicts,
      [],
    );
    current.name = '외부 수정';
    assert.deepEqual(
      buildDocumentPatch(
        fields,
        {
          name: '보호',
        },
        current,
      ).conflicts,
      ['name'],
    );
  },
);

test(
  'Status choices preserve selected order and unknown IDs while merging registered labels',
  () => {
    const options = effectStatusOptions(
      source.statuses,
      [
        {
          id: 'prone',
          name: '넘어짐',
        },
        {
          id: 'stunned',
          name: '기절',
        },
      ],
    );
    assert.deepEqual(
      options.filter((option) => option.checked).map((option) => option.id),
      source.statuses,
    );
    assert.equal(
      options[1].label,
      '넘어짐',
    );
    assert.equal(
      options[2].checked,
      false,
    );
  },
);

test(
  'Effect validation rejects unsafe paths, blank statuses and malformed colors',
  () => {
    assert.throws(
      () =>
        validateEffectPatch({
          'system.changes': [
            {
              key: 'system.__proto__.a',
              type: 'add',
            },
          ],
        }),
      /변경 경로/,
    );
    assert.throws(
      () =>
        validateEffectPatch({
          'system.changes': [
            {
              key: 'system..a',
              type: 'add',
            },
          ],
        }),
      /변경 경로/,
    );
    assert.throws(
      () =>
        validateEffectPatch({
          statuses: [''],
        }),
      /상태 ID/,
    );
    assert.throws(
      () =>
        validateEffectPatch({
          tint: 'red',
        }),
      /색조/,
    );
    assert.throws(
      () => validateEffectPatch({ 'system.changes': [{ key: 'system.attributes.ac.bonus', type: '2' }] }),
      /적용 방식/,
    );
    assert.throws(
      () => validateEffectPatch({ origin: '임의 텍스트' }),
      /원본 UUID/,
    );
    assert.doesNotThrow(() => validateEffectPatch({ origin: null }));
    assert.doesNotThrow(() =>
      validateEffectPatch({
        tint: '#ABCdef',
        'system.changes': [
          {
            key: 'system.attributes.ac.bonus',
            type: 'dnd5e.bonus',
          },
        ],
      }),
    );
  },
);

test(
  'Dedicated effect editor preserves drafts on row changes, blocks conflicts and revoked/deleted targets',
  async () => {
    const previous = {
      foundry: globalThis.foundry,
      game: globalThis.game,
      ui: globalThis.ui,
    };
    class ApplicationV2 {
      render() {
        return this;
      }
      async close() {
        this.closed = true;
        return this;
      }
    }
    const errors = [];
    globalThis.foundry = {
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
      modules: new Map([
        [
          'dae',
          {
            active: true,
          },
        ],
      ]),
    };
    globalThis.ui = {
      notifications: {
        error: (message) => errors.push(message),
        warn: (message) => errors.push(message),
        info() {},
      },
    };
    const current = structuredClone(source);
    const patches = [];
    let permission = true;
    const effects = new Map();
    const effect = {
      id: 'effect',
      name: current.name,
      isOwner: true,
      parent: {
        name: '액터',
        isOwner: true,
        effects,
      },
      toObject: () => structuredClone(current),
      update: async (patch) => patches.push(patch),
    };
    effects.set(
      effect.id,
      effect,
    );
    try {
      const app = editEffect(
        effect,
        {
          canEdit: () => permission,
        },
      );
      const Base = getDocumentWorkbenchClass();
    const crlfEffect = editEffect({
      ...effect,
      parent: null,
      toObject: () => ({ ...source, system: { ...source.system, changes: [{ ...source.system.changes[0], value: 'first\r\nsecond' }] } }),
    });
    const rowControls = {
      '[data-change-key]': { value: source.system.changes[0].key },
      '[data-change-type]': { value: 'add' },
      '[data-change-value]': { value: 'first\nsecond' },
      '[data-change-priority]': { value: '' },
    };
    crlfEffect.element = {
      querySelector: (selector) => selector === '[data-effect-changes]' ? {} : null,
      querySelectorAll: (selector) => selector === '[data-effect-change]'
        ? [{ querySelector: (key) => rowControls[key] }] : [],
    };
    assert.equal(
      JSON.parse(crlfEffect.values()['system.changes'])[0].value,
      'first\r\nsecond',
    );
      let controls = {
        name: '보호 효과',
        'duration.value': '60',
      };
      app.values = () => ({
        ...Object.fromEntries(
          app.fields.map((field) => [field.path, field.value]),
        ),
        ...controls,
      });
      await Base.DEFAULT_OPTIONS.actions.addChange.call(
        app,
        {
          preventDefault() {},
        },
      );
      assert.equal(
        app.fields.find((field) => field.path === 'name').value,
        '보호 효과',
      );
      assert.equal(
        (await app._prepareContext()).changeRows.length,
        2,
      );
      await Base.DEFAULT_OPTIONS.actions.removeChange.call(
        app,
        {
          preventDefault() {},
        },
        {
          dataset: {
            changeIndex: '1',
          },
        },
      );
      assert.deepEqual(
        JSON.parse(app.fields.find((field) => field.path === 'system.changes').value),
        source.system.changes,
      );
      current.name = '외부 변경';
      await Base.DEFAULT_OPTIONS.form.handler.call(
        app,
        {
          preventDefault() {},
        },
      );
      assert.equal(
        patches.length,
        0,
      );
      assert.match(
        errors.at(-1),
        /입력을 보존/,
      );
      assert.equal(
        app.closed,
        undefined,
      );
      current.name = source.name;
      permission = false;
      await Base.DEFAULT_OPTIONS.form.handler.call(
        app,
        {
          preventDefault() {},
        },
      );
      assert.equal(
        patches.length,
        0,
      );
      permission = true;
      effects.delete(effect.id);
      assert.equal(
        app.config.canEdit(),
        false,
      );
      effects.set(
        effect.id,
        effect,
      );
      await Base.DEFAULT_OPTIONS.form.handler.call(
        app,
        {
          preventDefault() {},
        },
      );
      assert.deepEqual(
        patches,
        [
          {
            name: '보호 효과',
            'duration.value': 60,
          },
        ],
      );
      assert.equal(
        app.closed,
        true,
      );
      const cancelled = editEffect({ ...effect, parent: null, update: async () => undefined });
      cancelled.values = () => ({ name: '취소된 저장' });
      await Base.DEFAULT_OPTIONS.form.handler.call(
        cancelled,
        { preventDefault() {} },
      );
      assert.equal(
        cancelled.closed,
        undefined,
      );
      assert.match(
        errors.at(-1),
        /저장이 취소/,
      );
      const itemEffect = {
        ...effect,
        parent: {
          isOwner: true,
          parent: {
            isOwner: false,
          },
        },
      };
      assert.equal(
        editEffect(itemEffect).config.canEdit(),
        false,
      );
    } finally {
      Object.assign(
        globalThis,
        previous,
      );
    }
  },
);
