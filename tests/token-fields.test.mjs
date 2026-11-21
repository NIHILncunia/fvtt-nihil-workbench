import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorFieldSections,
  buildActorFieldUpdate,
} from '../scripts/workbench/actor-fields.mjs';
import { ActorDraftStore } from '../scripts/workbench/actor-drafts.mjs';
import {
  detectionModeList,
  detectionModeDeletions,
  tokenDetectionRows,
  readTokenDetectionInputs,
  validateTokenDetectionModes,
  applyTokenVisionDefaults,
} from '../scripts/workbench/token-fields.mjs';

function fixture(type = 'npc') {
  const source = {
    type,
    name: '검증',
    system: {},
    flags: { module: { retained: true } },
    prototypeToken: {
      sight: { visionMode: 'basic', angle: 360, color: null, brightness: 0 },
      light: {
        alpha: 0.5,
        color: '#123456',
        priority: 0,
        animation: {
          type: 'torch',
          speed: 5,
          intensity: 5,
          reverse: false,
          extension: true,
        },
        darkness: { min: 0, max: 1 },
      },
      // Foundry v14: detectionModes는 { [모드 ID]: { enabled, range } } 객체다.
      detectionModes: {
        custom: {
          enabled: true,
          range: null,
          extension: { retained: true },
        },
      },
    },
  };
  return {
    source,
    actor: { id: 'test', type, toObject: () => structuredClone(source) },
  };
}

test(
  'PC and NPC token forms expose registered choices and all perception sections',
  () => {
    const previous = globalThis.CONFIG;
    globalThis.CONFIG = {
      Canvas: {
        visionModes: {
          basic: { label: '기본', tokenConfig: true },
          hidden: { label: '숨김', tokenConfig: false },
        },
        lightAnimations: { torch: { label: '횃불' } },
        detectionModes: { custom: { label: '사용자 감지', tokenConfig: true } },
      },
    };
    try {
      for (const type of ['character', 'npc']) {
        const { actor } = fixture(type);
        const sections = actorFieldSections(actor).filter(
          (section) => section.tab === 'token',
        );
        const fields = sections.flatMap((section) => section.fields);
        assert.equal(
          new Set(fields.map((field) => field.path)).size,
          fields.length,
        );
        const vision = fields.find(
          (field) => field.path === 'prototypeToken.sight.visionMode',
        );
        assert.deepEqual(
          vision.options.map((option) => option.value),
          ['basic'],
        );
        assert.ok(sections.some((section) => section.isDetectionModes));
        assert.ok(
          fields.some(
            (field) => field.path === 'prototypeToken.light.animation.speed',
          ),
        );
        assert.ok(
          fields.some(
            (field) => field.path === 'prototypeToken.light.darkness.max',
          ),
        );
      }
    } finally {
      globalThis.CONFIG = previous;
    }
  }
);

test(
  'Token partial saves normalize empty color and animation while preserving other source values',
  () => {
    const { actor, source } = fixture();
    const before = structuredClone(source);
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        {
          'prototypeToken.light.color': '',
          'prototypeToken.light.animation.type': '',
          'prototypeToken.light.animation.speed': '6',
        }
      ),
      {
        'prototypeToken.light.color': null,
        'prototypeToken.light.animation.type': null,
        'prototypeToken.light.animation.speed': 6,
      },
    );
    assert.deepEqual(
      source,
      before
    );
  }
);

test(
  'Token validation rejects invalid bounds, fractions, colors and inconsistent darkness',
  () => {
    const { actor } = fixture();
    for (const [path, raw] of [
      ['sight.angle', '361'],
      ['sight.brightness', '-1.1'],
      ['light.alpha', '1.1'],
      ['light.animation.speed', '1.5'],
      ['light.animation.intensity', '0'],
      ['light.priority', '-1'],
      ['light.color', 'red'],
      ['light.dim', 'Infinity'],
    ])
      assert.throws(() =>
        buildActorFieldUpdate(
          actor,
          { [`prototypeToken.${path}`]: raw }
        ),
      );
    assert.throws(
      () => {
        buildActorFieldUpdate(
          actor,
          {
            'prototypeToken.light.darkness.min': '0.8',
            'prototypeToken.light.darkness.max': '0.2',
          },
        );
      },
      /최소 어둠/,
    );
  }
);

test(
  'Detection rows retain unknown modes, empty infinite range and extension data',
  () => {
    const { source } = fixture();
    const rows = tokenDetectionRows(source.prototypeToken.detectionModes);
    assert.equal(
      rows[0].range,
      ''
    );
    assert.ok(
      rows[0].options.some(
        (option) => option.value === 'custom' && option.selected,
      ),
    );
    assert.deepEqual(
      validateTokenDetectionModes([
        { ...detectionModeList(source.prototypeToken.detectionModes)[0], range: '' },
      ]),
      source.prototypeToken.detectionModes,
    );
  }
);

test(
  'Detection validation rejects duplicate modes and invalid ranges before saving',
  () => {
    assert.deepEqual(validateTokenDetectionModes({}), {});
    assert.deepEqual(
      validateTokenDetectionModes([{ id: 'feel', enabled: 1, range: '30' }]),
      { feel: { enabled: true, range: 30 } },
    );
    assert.deepEqual(
      detectionModeDeletions({ a: {}, b: {} }, { a: {} }),
      { 'prototypeToken.detectionModes.-=b': null },
    );
    for (const value of [
      null,
      [{ id: '' }],
      [{ id: 'a.b' }],
      [{ id: 'x', range: -1 }],
      [{ id: 'x', range: 'NaN' }],
      [{ id: 'x' }, { id: 'x' }],
    ]) {
      assert.throws(() => validateTokenDetectionModes(value));
    }
  }
);

test(
  'Detection DOM reader preserves source extensions and reads row controls only',
  () => {
    const originals = [
      { id: 'custom', range: null, enabled: true, extension: 42 },
    ];
    const controls = {
      '[data-detection-id]': { value: 'custom' },
      '[data-detection-enabled]': { checked: false },
      '[data-detection-range]': { value: '30' },
    };
    const container = {
      querySelector: () => ({ value: JSON.stringify(originals) }),
      querySelectorAll: () => [
        { querySelector: (selector) => controls[selector] },
      ],
    };
    assert.deepEqual(
      readTokenDetectionInputs({ querySelector: () => container }),
      [{ id: 'custom', range: '30', enabled: false, extension: 42 }],
    );
    assert.equal(
      readTokenDetectionInputs({}),
      undefined
    );
  }
);

test(
  'Detection drafts persist through rerender, clear reverted input and detect external array changes',
  () => {
    const { actor, source } = fixture();
    const store = new ActorDraftStore();
    const key = 'field:prototypeToken.detectionModes';
    const initial = {
      [key]: JSON.stringify(detectionModeList(source.prototypeToken.detectionModes)),
    };
    const modes = [
      ...detectionModeList(source.prototypeToken.detectionModes),
      { id: 'feel', enabled: true, range: '30' },
    ];
    store.capture(
      actor,
      { [key]: JSON.stringify(modes) },
      initial
    );
    store.capture(
      actor,
      { [key]: JSON.stringify(modes) },
      initial
    );
    assert.equal(
      store.prepare(actor).update['prototypeToken.detectionModes'].feel.range,
      30,
    );
    source.prototypeToken.detectionModes.custom.enabled = false;
    assert.deepEqual(
      store.prepare(actor).conflicts,
      [
        'prototypeToken.detectionModes',
      ]
    );
    store.capture(
      actor,
      initial,
      initial
    );
    assert.equal(
      store.records.size,
      0
    );
  }
);

test(
  'Vision defaults only apply the configured fields to form controls',
  () => {
    const previous = globalThis.CONFIG;
    globalThis.CONFIG = {
      Canvas: {
        visionModes: {
          dark: { vision: { defaults: { brightness: 0.5, color: null } } },
        },
      },
    };
    const controls = {
      visionMode: { value: 'dark' },
      brightness: { value: 0 },
      color: { value: '#123456' },
      contrast: { value: 0.2 },
    };
    try {
      applyTokenVisionDefaults({
        querySelector: (selector) =>
          controls[selector.match(/sight\.(\w+)/)?.[1]],
      });
      assert.equal(
        controls.brightness.value,
        0.5
      );
      assert.equal(
        controls.color.value,
        ''
      );
      assert.equal(
        controls.contrast.value,
        0.2
      );
    } finally {
      globalThis.CONFIG = previous;
    }
  }
);
