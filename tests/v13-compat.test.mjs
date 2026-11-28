import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ClassicLevel } from 'classic-level';
import Handlebars from 'handlebars';
import { sceneBackgroundSource } from '../scripts/chat-log/export.mjs';
import { buildArmorClass, buildEffectChange, buildSenses } from '../scripts/content/builders.mjs';
import { buildEffectDuration } from '../scripts/content/effect-duration.mjs';
import { buildRangedFireBurn } from '../scripts/content/examples/ranged-fire.mjs';
import { registerResolveStatuses } from '../scripts/resolve/index.mjs';
import { injectResolveSheet } from '../scripts/resolve/sheet.mjs';
import { getActorResourceStore, setActorResourceValue } from '../scripts/resources/actor-resources.mjs';
import { injectSettingsResourceButton, openResourceManager, registerResourceManager } from '../scripts/resources/index.mjs';
import { migrateLegacyResources } from '../scripts/resources/migration.mjs';
import { registerSecretHp } from '../scripts/secret-hp/secret-hp.mjs';
import { appendAdvancementSource } from '../scripts/shared/advancement-source.mjs';
import {
  applyEffectTiming,
  directoryContextOption,
  effectSourceWithChanges,
  foundryGeneration,
  isDnd5e6,
  isFoundry14,
  resolvePcEffectDisplay,
  saveSceneLevelBackground,
  sceneBackgroundBeforeSave,
} from '../scripts/shared/compat.mjs';
import { addDeletion } from '../scripts/shared/deletion.mjs';
import { buildActorFieldUpdate } from '../scripts/workbench/actor-fields.mjs';
import { getDocumentWorkbenchClass } from '../scripts/workbench/document-workbench-app.mjs';
import { buildDocumentPatch, readDocumentFields } from '../scripts/workbench/document-fields.mjs';
import { effectFields, migrateLegacyShowIcon, validateEffectPatch } from '../scripts/workbench/effect-fields.mjs';
import { effectStartPatch } from '../scripts/workbench/effect-workbench-app.mjs';
import { ownershipPatch } from '../scripts/workbench/ownership-workbench-app.mjs';
import { readSceneState, refreshSceneThumbnail, sceneCreateData, sceneUpdateData } from '../scripts/workbench/scene-fields.mjs';
import { buildV13, createV13Manifest } from '../tools/build-v13.mjs';

const MODULE_ID = 'nihil-compendium-module';
const LEGACY_RESOURCE_ID = 'luxterra-resource-manager';
const repository = fileURLToPath(new URL(
  '../',
  import.meta.url,
));

beforeEach(() => {
  globalThis.game = {
    release: { generation: 13 },
    system: { id: 'dnd5e', version: '5.2.4' },
    user: { isGM: true },
    modules: new Map(),
  };
  globalThis.CONFIG = {
    DND5E: {
      armorClasses: { default: {}, flat: {}, natural: {}, custom: {}, mage: {} },
      movementUnits: { ft: {}, m: {} },
    },
  };
  delete globalThis._del;
  delete globalThis._replace;
});

test(
  'v13 uses the scene and system versions independently and keeps the old context menu contract',
  () => {
    assert.equal(
      foundryGeneration(),
      13,
    );
    assert.equal(
      isFoundry14(),
      false,
    );
    assert.equal(
      isDnd5e6(),
      false,
    );
    game.system.version = '6.1.1';
    assert.equal(
      isDnd5e6(),
      true,
    );
    assert.equal(
      isFoundry14(),
      false,
    );
    let opened = null;
    const entry = { dataset: { entryId: 'scene' } };
    const option = directoryContextOption({
      label: '편집',
      icon: '',
      visible: (target) => target === entry,
      onClick: (
        _event,
        target,
      ) => {
        opened = target;
      },
    });
    assert.deepEqual(
      Object.keys(option),
      ['name', 'icon', 'condition', 'callback'],
    );
    assert.equal(
      option.name,
      '편집',
    );
    assert.equal(
      option.condition(entry),
      true,
    );
    option.callback(entry);
    assert.equal(
      opened,
      entry,
    );
  },
);

test(
  'v13 content helpers and ranged-fire write numeric effect modes and string values',
  () => {
    const change = buildEffectChange({ key: 'system.attributes.ac.bonus', type: 'subtract', value: 3 });
    assert.deepEqual(
      change,
      { key: 'system.attributes.ac.bonus', mode: 2, value: '-3' },
    );
    assert.throws(
      () => buildEffectChange({ key: 'system.attributes.ac.flat', type: 'dnd5e.formula', value: '15' }),
      /지원하지 않는 효과/,
    );
    const burn = buildRangedFireBurn('Actor.actor.Item.item');
    assert.equal(
      burn.changes[0].key,
      'flags.midi-qol.OverTime',
    );
    assert.equal(
      burn.changes[0].mode,
      5,
    );
    assert.equal(
      burn.system?.changes,
      undefined,
    );
    const effect = { system: { changes: [change] }, showIcon: 2, flags: { dae: { stackable: 'multi' } } };
    effectSourceWithChanges(
      effect,
      [change],
    );
    assert.deepEqual(
      effect,
      { system: {}, changes: [change], flags: { dae: { stackable: 'multi', showIcon: true } } },
    );
  },
);

test(
  'v13 effects retain legacy duration, combat and DAE fields when edited',
  () => {
    const source = {
      name: '효과',
      duration: { rounds: 2, turns: 1, startTime: 125, startRound: 3, combat: 'firstCombat' },
      changes: [{ key: 'system.bonuses.abilities.save', mode: 2, value: '1', priority: 20 }],
      flags: { dae: { showIcon: true } },
    };
    const fields = effectFields(
      source,
      { dae: true },
    );
    assert.equal(
      fields.find((field) => field.path === 'flags.dae.showIcon').value,
      true,
    );
    assert.equal(
      fields.find((field) => field.path === 'duration.combat').value,
      'firstCombat',
    );
    assert.equal(
      fields.find((field) => field.path === 'duration.startRound').value,
      3,
    );
    assert.ok(!fields.some((field) => field.path === 'showIcon' || field.path.startsWith('start.')));
    const { patch, conflicts } = buildDocumentPatch(
      fields,
      { 'duration.rounds': '4', 'flags.dae.showIcon': false },
      source,
    );
    assert.deepEqual(
      conflicts,
      [],
    );
    assert.deepEqual(
      validateEffectPatch(patch),
      undefined,
    );
    assert.deepEqual(
      migrateLegacyShowIcon(
        effectStartPatch(
          patch,
          source,
        ),
        source,
      ),
      { 'duration.rounds': 4, 'flags.dae.showIcon': false },
    );
    assert.deepEqual(
      buildEffectDuration(source.duration),
      { duration: source.duration, start: null },
    );
    const next = { start: { combat: 'firstCombat', round: 3, time: 125 } };
    applyEffectTiming(
      next,
      buildEffectDuration(
        { value: 2, units: 'minutes' },
        next.start,
      ),
    );
    assert.deepEqual(
      next,
      { duration: { seconds: 120, startTime: 125, startRound: 3, combat: 'firstCombat' } },
    );
    assert.throws(
      () => buildEffectDuration({ value: 2, units: 'turns', expiry: 'turnEnd' }),
      /만료 시점/,
    );
  },
);

test(
  'v13 effect editor reads a numeric mode and writes the selected mode back to changes',
  async () => {
    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2: class {},
          HandlebarsApplicationMixin: (Base) => Base,
        },
      },
    };
    const source = { changes: [{ key: 'system.bonuses.abilities.save', mode: 2, value: '1', priority: 20 }] };
    const editor = new (getDocumentWorkbenchClass())({ fields: effectFields(source), canEdit: () => true });
    const context = await editor._prepareContext();
    assert.equal(
      context.changeRows[0].types.find((option) => option.selected).value,
      'add',
    );
    assert.ok(context.changeRows[0].types.every((option) => option.value !== 'subtract'));
    const inputs = {
      '[data-change-key]': { value: 'system.bonuses.abilities.save' },
      '[data-change-type]': { value: 'override' },
      '[data-change-value]': { value: '2' },
      '[data-change-priority]': { value: '30' },
    };
    editor.element = {
      querySelector: () => true,
      querySelectorAll: (selector) => selector === '[data-effect-change]'
        ? [{ querySelector: (key) => inputs[key] }]
        : [],
    };
    const { patch } = buildDocumentPatch(
      editor.fields,
      editor.values(),
      source,
    );
    assert.doesNotThrow(() => validateEffectPatch(patch));
    assert.deepEqual(
      patch,
      { changes: [{ key: 'system.bonuses.abilities.save', mode: 5, value: '2', priority: 30 }] },
    );
  },
);

test(
  'v13 NPC armor, senses and token changes stay in the 5.2.4 and 13.351 source shapes',
  () => {
    assert.deepEqual(
      buildArmorClass({ calc: 'natural', flat: 13 }),
      { calc: 'natural', flat: 13 },
    );
    assert.deepEqual(
      buildArmorClass({ override: 17 }),
      { calc: 'flat', flat: 17 },
    );
    assert.deepEqual(
      buildArmorClass({ calcs: ['unarmored', 'armored', 'mage'] }),
      { calc: 'mage' },
    );
    assert.deepEqual(
      buildArmorClass({ formulas: [{ formula: '13 + @abilities.dex.mod' }] }),
      { calc: 'custom', formula: '13 + @abilities.dex.mod' },
    );
    assert.throws(
      () => buildArmorClass({ formulas: [{ formula: '12' }, { formula: '16' }] }),
      /하나만/,
    );
    assert.deepEqual(
      buildSenses({ darkvision: 60, ranges: { tremorsense: 20 }, units: 'ft' }),
      { darkvision: 60, tremorsense: 20, units: 'ft' },
    );
    const actor = {
      type: 'npc',
      toObject: () => ({
        type: 'npc',
        system: { attributes: { ac: { calc: 'natural', flat: 13 }, senses: { darkvision: 60 } } },
        prototypeToken: { detectionModes: [{ id: 'seeAll', enabled: true, range: 20 }] },
      }),
    };
    const update = buildActorFieldUpdate(
      actor,
      {
        'system.attributes.ac.calc': 'custom',
        'system.attributes.ac.formula': '12 + @abilities.dex.mod',
        'system.attributes.senses.darkvision': '90',
        'prototypeToken.detectionModes': '[]',
      },
    );
    assert.deepEqual(
      update,
      {
      'system.attributes.ac.calc': 'custom',
      'system.attributes.ac.formula': '12 + @abilities.dex.mod',
      'system.attributes.senses.darkvision': 90,
      'prototypeToken.detectionModes': [],
    },
    );
  },
);

test(
  'v13 deletions and permission edits use legacy keys and keep unrelated users',
  () => {
    globalThis._del = Symbol('forced deletion');
    globalThis._replace = () => assert.fail('v13 must not use _replace');
    assert.deepEqual(
      addDeletion(
        {},
        'flags.dae.showIcon',
      ),
      { 'flags.dae.-=showIcon': null },
    );
    const ownership = { default: 0, removed: 3, changed: 1, keep: 2 };
    const fields = [{ path: 'ownership.removed' }, { path: 'ownership.changed' }];
    assert.deepEqual(
      ownershipPatch(
        { 'ownership.removed': -1, 'ownership.changed': 2 },
        fields,
        ownership,
      ),
      { 'ownership.-=removed': null, 'ownership.changed': 2 },
    );
    const source = { ownership };
    assert.deepEqual(
      buildDocumentPatch(
        readDocumentFields(
          source,
          {},
          ['ownership'],
        ),
        { ownership: JSON.stringify({ default: 0, changed: 2, keep: 2 }) },
        source,
      ).patch,
      { 'ownership.-=removed': null, 'ownership.changed': 2 },
    );
  },
);

test(
  'v13 native advancement remains an ordered array on first insert and subsequent copy',
  () => {
    const hp = { _id: 'hp', type: 'HitPoints', value: {} };
    const size = { _id: 'size', type: 'Size', value: {} };
    assert.deepEqual(
      appendAdvancementSource(
        undefined,
        hp,
      ),
      [hp],
    );
    assert.deepEqual(
      appendAdvancementSource(
        [hp],
        size,
      ),
      [hp, size],
    );
  },
);

test(
  'v13 scene workbench and chat log use the scene background and make level-free thumbnails',
  async () => {
    const input = { name: '장면', src: 'map.webp', width: 1000, height: 750, columns: 20 };
    const create = sceneCreateData(input);
    assert.deepEqual(
      create.background,
      { src: 'map.webp' },
    );
    assert.equal(
      create.backgroundColor,
      '#000000',
    );
    assert.equal(
      create.active,
      false,
    );
    assert.equal(
      create.levels,
      undefined,
    );
    const thumbnailCalls = [];
    const scene = {
      ...create,
      _id: 'scene',
      background: { src: 'old.webp', offsetX: 12 },
      thumb: 'old-thumb.webp',
      createThumbnail: async (options) => {
        thumbnailCalls.push(options);
        return { thumb: 'new-thumb.webp' };
      },
      update: async (patch) => thumbnailCalls.push(patch),
    };
    const before = readSceneState(scene);
    assert.equal(
      before.src,
      'old.webp',
    );
    assert.equal(
      before.backgroundColor,
      '#000000',
    );
    assert.equal(
      before.levelId,
      null,
    );
    assert.equal(
      sceneBackgroundSource(
        scene,
        'ignored',
      ),
      'old.webp',
    );
    const patch = sceneUpdateData(input);
    assert.equal(
      patch['background.src'],
      'map.webp',
    );
    assert.equal(
      patch.backgroundColor,
      '#000000',
    );
    const saved = await saveSceneLevelBackground(
      scene,
      {},
      sceneBackgroundBeforeSave(scene),
    );
    assert.deepEqual(
      saved,
      { levelId: null, previousSrc: 'old.webp' },
    );
    assert.deepEqual(
      await refreshSceneThumbnail(
        scene,
        { ...saved, nextSrc: input.src },
      ),
      { updated: true, reason: null },
    );
    assert.deepEqual(
      thumbnailCalls,
      [{}, { thumb: 'new-thumb.webp' }],
    );
  },
);

test(
  'v13 resolve block mounts once after the NPC header meter and registers native status IDs',
  () => {
    globalThis.CONFIG.statusEffects = [{ id: 'prone' }];
    registerResolveStatuses();
    registerResolveStatuses();
    assert.equal(
      globalThis.CONFIG.statusEffects.length,
      7,
    );
    assert.deepEqual(
      resolvePcEffectDisplay('nihil-resolve-white-oath'),
      { img: 'icons/svg/angel.svg' },
    );
    let block;
    const hp = { after: (element) => { block = element; } };
    const root = {
      ownerDocument: { createElement: () => ({
        setAttribute: () => {},
        addEventListener: () => {},
        remove: () => { block = null; },
      }) },
      querySelector: (selector) => {
        if (selector === '.ncm-resolve-block') return block;
        assert.match(
          selector,
          /\.sheet-header \.meter\.hit-points\.sectioned/,
        );
        return hp;
      },
    };
    const app = { actor: { type: 'npc', items: [] } };
    assert.equal(
      injectResolveSheet(
        app,
        root,
      ),
      true,
    );
    const original = block;
    assert.equal(
      injectResolveSheet(
        app,
        root,
      ),
      true,
    );
    assert.notEqual(
      block,
      original,
    );
    assert.match(
      block.innerHTML,
      /투지·의지 설정/,
    );
  },
);

test(
  'v13 overlapping modules register no workbench settings or feature hooks and notify only the GM once',
  async () => {
    game.modules = new Map([
      ['nihil-secret-hp', { active: true }],
      [LEGACY_RESOURCE_ID, { active: true }],
    ]);
    game.settings = { register: () => assert.fail('workbench setting registered while legacy module is active') };
    const ready = [];
    const notices = [];
    globalThis.Hooks = {
      on: () => assert.fail('workbench feature hook registered while legacy module is active'),
      once: (
        name,
        callback,
      ) => {
        assert.equal(
          name,
          'ready',
        );
        ready.push(callback);
      },
    };
    globalThis.ui = { notifications: { warn: (message) => notices.push(message) } };
    assert.equal(
      registerSecretHp(),
      false,
    );
    assert.equal(
      registerResourceManager(),
      false,
    );
    assert.equal(
      injectSettingsResourceButton({}),
      false,
    );
    assert.equal(
      openResourceManager(),
      null,
    );
    const launcher = Handlebars.compile(await readFile(
      new URL(
        '../templates/workbench/launcher.hbs',
        import.meta.url,
      ),
      'utf8',
    ));
    assert.doesNotMatch(
      launcher({ legacyResourceManagerActive: true }),
      /openResourceManager/,
    );
    assert.match(
      launcher({ legacyResourceManagerActive: false }),
      /openResourceManager/,
    );
    game.user.isGM = false;
    for (const callback of ready) callback();
    assert.deepEqual(
      notices,
      [],
    );
    game.user.isGM = true;
    for (const callback of [...ready, ...ready]) callback();
    assert.deepEqual(
      notices,
      [
        '옛 모듈이 켜져 있어 워크벤치의 비밀 HP 기능을 쉽니다.',
        '옛 모듈이 켜져 있어 워크벤치의 자원 관리 기능을 쉽니다.',
      ],
    );
  },
);

test(
  'v13 resolve can use the active legacy resource data and migration waits until it is disabled',
  async () => {
    const resource = { id: 'stress', name: '스트레스', max: 100, startFromZero: true };
    const actorFlags = { [LEGACY_RESOURCE_ID]: { resources: { stress: { value: 30 } } } };
    const actor = {
      type: 'character',
      _source: { flags: actorFlags },
      getFlag: (
        scope,
        key,
      ) => actorFlags[scope]?.[key],
      setFlag: async (
        scope,
        key,
        value,
      ) => {
        (actorFlags[scope] ??= {})[key] = value;
      },
    };
    const legacy = { active: true };
    game.modules.set(
      LEGACY_RESOURCE_ID,
      legacy,
    );
    game.actors = [actor];
    const settings = new Map([[LEGACY_RESOURCE_ID + '.resourceDefinitions', { stress: resource }]]);
    game.settings = {
      get: (
        id,
        key,
      ) => settings.get(`${id}.${key}`),
      set: async (
        id,
        key,
        value,
      ) => settings.set(
        `${id}.${key}`,
        value,
      ),
      storage: new Map([['world', { getSetting: (key) => ({ value: settings.get(key) }) }]]),
    };
    globalThis.foundry = { utils: { deepClone: structuredClone } };
    await setActorResourceValue(
      actor,
      'stress',
      35,
    );
    assert.equal(
      getActorResourceStore(actor).stress.value,
      35,
    );
    assert.equal(
      await migrateLegacyResources(),
      null,
    );
    assert.equal(
      actorFlags[MODULE_ID],
      undefined,
    );
    assert.equal(
      settings.has(MODULE_ID + '.resourceMigrationVersion'),
      false,
    );
    legacy.active = false;
    assert.deepEqual(
      await migrateLegacyResources(),
      { definitions: 1, managed: 0, actors: 1 },
    );
    assert.deepEqual(
      actorFlags[MODULE_ID].resources,
      { stress: { value: 35 } },
    );
    assert.deepEqual(
      settings.get(MODULE_ID + '.resourceDefinitions'),
      { stress: resource },
    );
    assert.equal(
      await migrateLegacyResources(),
      null,
    );
  },
);

test(
  'v13 build generates both matching manifests, the shared runtime and only the packed v13 actors',
  async () => {
    const temp = await mkdtemp(path.join(
      os.tmpdir(),
      'ncm-v13-test-',
    ));
    try {
      const rootJson = await readFile(
        new URL(
          '../module.json',
          import.meta.url,
        ),
        'utf8',
      );
      const rootManifest = JSON.parse(rootJson);
      const manifest = await buildV13({ outputRoot: temp });
      const output = path.join(
        temp,
        'v13',
      );
      assert.equal(
        await readFile(
          new URL(
            '../module.json',
            import.meta.url,
          ),
          'utf8',
        ),
        rootJson,
      );
      assert.equal(
        rootManifest.compatibility.minimum,
        '14',
      );
      assert.equal(
        manifest.id,
        rootManifest.id,
      );
      assert.equal(
        manifest.version,
        rootManifest.version,
      );
      assert.deepEqual(
        manifest.compatibility,
        { minimum: '13', verified: '13.351', maximum: '13' },
      );
      assert.deepEqual(
        manifest.relationships.systems[0].compatibility,
        { minimum: '5.2.4', verified: '6.1.1' },
      );
      assert.equal(
        manifest.manifest,
        `${rootManifest.url}/releases/latest/download/module-v13.json`,
      );
      assert.equal(
        manifest.download,
        `${rootManifest.url}/releases/download/v${manifest.version}/module-v13.zip`,
      );
      assert.deepEqual(
        manifest.packs,
        rootManifest.packs.map((pack) => ({ ...pack, path: `packs-v13/${pack.name}` })),
      );
      assert.equal(
        await readFile(
          path.join(
            output,
            'module.json',
          ),
          'utf8',
        ),
        await readFile(
          path.join(
            temp,
            'module-v13.json',
          ),
          'utf8',
        ),
      );
      assert.deepEqual(
        (await readdir(output)).sort(),
        ['assets', 'data', 'module.json', 'packs-v13', 'scripts', 'styles', 'templates'],
      );
      assert.deepEqual(
        await readdir(path.join(
          output,
          'packs-v13',
        )),
        ['common-monsters'],
      );
      for (const relative of [
        'scripts/shared/compat.mjs',
        'styles/workbench.css',
        'templates/workbench/effect-workbench.hbs',
        'data/common-monster-templates.json',
      ]) {
        assert.deepEqual(
          await readFile(path.join(
            output,
            relative,
          )),
          await readFile(path.join(
            repository,
            relative,
          )),
        );
      }
      const packed = path.join(
        output,
        manifest.packs[0].path,
      );
      assert.ok((await readdir(packed)).every((entry) => !['LOCK', 'LOG', 'LOG.old'].includes(entry)));
      const database = new ClassicLevel(
        packed,
        { keyEncoding: 'utf8', valueEncoding: 'json' },
      );
      await database.open({ readOnly: true });
      try {
        let actors = 0;
        for await (const [key, value] of database.iterator()) {
          if (!key.startsWith('!actors!')) continue;
          assert.ok(Object.hasOwn(
            value.system.attributes.ac,
            'calc',
          ));
          assert.ok(Array.isArray(value.prototypeToken.detectionModes));
          actors += 1;
        }
        assert.equal(
          actors,
          90,
        );
      } finally {
        await database.close();
      }
      const next = createV13Manifest(
        { ...rootManifest, version: '1.2.3' },
        { tag: 'v1.2.3' },
      );
      assert.equal(
        next.download,
        `${rootManifest.url}/releases/download/v1.2.3/module-v13.zip`,
      );
      assert.throws(
        () => createV13Manifest(
          rootManifest,
          { tag: 'v999.0.0' },
        ),
        /태그.*다릅니다/,
      );
    } finally {
      await rm(
        temp,
        { recursive: true, force: true },
      );
    }
  },
);
