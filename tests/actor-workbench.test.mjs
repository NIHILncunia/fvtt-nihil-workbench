import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/actor-workbench-app.mjs', import.meta.url);
const ACTOR_WORKBENCH_PATH = new URL('../scripts/workbench/actor-workbench-app.mjs', import.meta.url);

async function loadActorWorkbench() {
  const url = new URL(MODULE_URL);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function actor({
  id,
  type,
  name,
  folderId = null,
} = {}) {
  return {
    id,
    type,
    name,
    folder: folderId ? { id: folderId } : null,
  };
}

test('Actor Workbench keeps separate PC and NPC Browser state and filters unsupported Actors', async () => {
  const { buildActorBrowserModel } = await loadActorWorkbench();
  const pcActor = actor({ id: 'pc-1', type: 'character', name: '가람' });
  const npcActor = actor({ id: 'npc-1', type: 'npc', name: '고블린' });
  const vehicleActor = actor({ id: 'vehicle-1', type: 'vehicle', name: '마차' });

  const model = buildActorBrowserModel({
    actors: [pcActor, npcActor, vehicleActor],
    activeType: 'npc',
    folderId: null,
  });

  assert.deepEqual(model.rows.map(row => row.id), ['npc-1']);
  assert.deepEqual(model.typeTabs, [
    { value: 'all', label: '전체', selected: false },
    { value: 'character', label: 'PC', selected: false },
    { value: 'npc', label: 'NPC', selected: true },
  ]);
});

test(
  'All Actors view combines PC and NPC while preserving folder and search filters',
  async () => {
    const { buildActorBrowserModel, ActorWorkbenchState } = await loadActorWorkbench();
    const model = buildActorBrowserModel({
      actors: [
        actor({ id: 'pc', type: 'character', name: '눈의 기사', folderId: 'snow' }),
        actor({ id: 'npc', type: 'npc', name: '눈결정 곰', folderId: 'snow' }),
        actor({ id: 'other', type: 'npc', name: '눈의 정령', folderId: 'elsewhere' }),
        actor({ id: 'vehicle', type: 'vehicle', name: '눈썰매', folderId: 'snow' }),
      ],
      activeType: 'all',
      folderId: 'snow',
      search: '눈',
    });
    assert.deepEqual(
      model.rows.map(row => row.id).sort(),
      ['npc', 'pc'],
    );
    assert.equal(model.isAll, true);
    const state = new ActorWorkbenchState({ activeType: 'all' });
    state.setBrowserState(
      'all',
      { folderId: 'snow', selectedActorId: 'pc', search: '눈' },
    );
    state.selectActorType('npc');
    state.selectActorType('all');
    assert.equal(state.browserStateFor('all').selectedActorId, 'pc');
    state.syncDeletedFolder('snow');
    assert.equal(state.browserStateFor('all').folderId, null);
    assert.equal(state.beginActorCreation('all'), null);
  },
);

test(
  'NPC row summaries retain zero and fractional CR and localize creature types',
  async () => {
    const previous = { CONFIG: globalThis.CONFIG, game: globalThis.game };
    globalThis.CONFIG = { DND5E: { creatureTypes: { beast: { label: 'CreatureBeast' } } } };
    globalThis.game = { i18n: { localize: key => key === 'CreatureBeast' ? '야수' : key } };
    try {
      const { actorBrowserSummary } = await loadActorWorkbench();
      for (const [cr, expected] of [[0, '0'], [0.125, '1/8'], [0.25, '1/4'], [0.5, '1/2'], [2, '2']]) {
        assert.equal(
          actorBrowserSummary({ type: 'npc', system: { details: { cr, type: { value: 'beast' } } } }),
          `CR ${expected} | 야수`,
        );
      }
      assert.equal(
        actorBrowserSummary({ type: 'npc', system: { details: { cr: 3, type: { value: 'custom', custom: '눈의 정령' } } } }),
        'CR 3 | 눈의 정령',
      );
      assert.equal(actorBrowserSummary({ type: 'npc' }), 'CR — | —');
    } finally {
      Object.assign(globalThis, previous);
    }
  },
);

test(
  'PC row summaries use total level, every class and resolved species without exposing an Item object',
  async () => {
    const { actorBrowserSummary } = await loadActorWorkbench();
    const items = [
      { id: 'fighter', type: 'class', name: '파이터', system: { levels: 3 } },
      { id: 'wizard', type: 'class', name: '위저드', system: { levels: 2 } },
      { id: 'elf', type: 'race', name: '엘프' },
    ];
    const pc = { type: 'character', items, system: { details: { level: 5, race: items[2] } } };
    assert.equal(actorBrowserSummary(pc), '5레벨 | 파이터 / 위저드 | 엘프');
    pc.system.details = { race: 'elf' };
    assert.equal(actorBrowserSummary(pc), '5레벨 | 파이터 / 위저드 | 엘프');
    assert.equal(actorBrowserSummary({ type: 'character' }), '0레벨 | — | —');
  },
);

test('Actor Workbench Browser filters by current Folder and Korean name search', async () => {
  const { buildActorBrowserModel } = await loadActorWorkbench();
  const model = buildActorBrowserModel({
    actors: [
      actor({ id: 'npc-1', type: 'npc', name: '고블린', folderId: 'monster-folder' }),
      actor({ id: 'npc-2', type: 'npc', name: '오우거', folderId: 'monster-folder' }),
      actor({ id: 'npc-3', type: 'npc', name: '고블린 대장', folderId: 'other-folder' }),
    ],
    activeType: 'npc',
    folderId: 'monster-folder',
    search: '고블',
  });

  assert.deepEqual(model.rows.map(row => row.id), ['npc-1']);
});

test('Actor Workbench Browser exposes only Actor Folders at the current Folder level', async () => {
  const { buildActorBrowserModel } = await loadActorWorkbench();
  const model = buildActorBrowserModel({
    activeType: 'npc',
    folderId: 'parent-folder',
    folders: [
      { id: 'npc-folder', name: '괴물', type: 'Actor', folder: { id: 'parent-folder' } },
      { id: 'item-folder', name: '아이템', type: 'Item', folder: { id: 'parent-folder' } },
      { id: 'root-folder', name: '루트 Actor', type: 'Actor', folder: null },
    ],
  });

  assert.deepEqual(model.folders, [{ id: 'npc-folder', name: '괴물', parentId: 'parent-folder' }]);
});

test('Actor Workbench gives a new owned Item its localized type label', async () => {
  const previousConfig = globalThis.CONFIG;
  const previousGame = globalThis.game;
  globalThis.CONFIG = {
    DND5E: {
      itemTypes: {
        feat: 'DND5E.ItemTypeFeat',
      },
    },
  };
  globalThis.game = {
    i18n: {
      localize(key) {
        return key === 'DND5E.ItemTypeFeat' ? '특기' : key;
      },
    },
  };

  try {
    const { embeddedItemCreateName } = await loadActorWorkbench();
    assert.equal(embeddedItemCreateName('feat'), '새 특기 항목');
  } finally {
    globalThis.CONFIG = previousConfig;
    globalThis.game = previousGame;
  }
});

test('Actor Workbench no longer presents SBI import as an unimplemented next step', async () => {
  const source = await readFile(ACTOR_WORKBENCH_PATH, 'utf8');
  assert.doesNotMatch(source, /SBI 문자열 임포트는 다음 단계에서 연결됩니다/);
});

test('Actor Workbench lists only Items embedded in the selected Actor', async () => {
  const { buildEmbeddedItemBrowserModel } = await loadActorWorkbench();
  const owner = {
    items: [
      { id: 'claw', name: '발톱', type: 'weapon', img: 'claw.webp' },
      { id: 'roar', name: '포효', type: 'feat', img: 'roar.webp' },
    ],
  };

  assert.deepEqual(buildEmbeddedItemBrowserModel(owner), [
    { id: 'claw', name: '발톱', type: 'weapon', img: 'claw.webp' },
    { id: 'roar', name: '포효', type: 'feat', img: 'roar.webp' },
  ]);
});

test('switching Actor type preserves the other type folder and selection', async () => {
  const { ActorWorkbenchState } = await loadActorWorkbench();
  const workbench = new ActorWorkbenchState({ activeType: 'character' });
  workbench.setBrowserState('character', { folderId: 'pc-folder', selectedActorId: 'pc-1' });
  workbench.setBrowserState('npc', { folderId: 'npc-folder', selectedActorId: 'npc-1' });
  workbench.selectActorType('npc');

  assert.deepEqual(workbench.browserStateFor('npc'), {
    folderId: 'npc-folder',
    selectedActorId: 'npc-1',
    search: '',
  });
  assert.deepEqual(workbench.browserStateFor('character'), {
    folderId: 'pc-folder',
    selectedActorId: 'pc-1',
    search: '',
  });
});

test('Actor Workbench preserves a valid editor tab for each Actor type', async () => {
  const { ActorWorkbenchState } = await loadActorWorkbench();
  const workbench = new ActorWorkbenchState({ activeType: 'character' });

  assert.equal(workbench.selectEditorTab('growth'), 'growth');
  workbench.selectActorType('npc');
  assert.equal(workbench.selectEditorTab('legendary'), 'legendary');
  assert.equal(workbench.selectEditorTab('growth'), 'legendary');
  workbench.selectActorType('character');
  assert.equal(workbench.activeEditorTabFor('character'), 'growth');
});

test('Actor Workbench returns each browser from a deleted Folder to its parent Folder', async () => {
  const { ActorWorkbenchState } = await loadActorWorkbench();
  const workbench = new ActorWorkbenchState({ activeType: 'npc' });
  workbench.setBrowserState('character', { folderId: 'pc-folder', selectedActorId: 'pc-1' });
  workbench.setBrowserState('npc', { folderId: 'npc-folder', selectedActorId: 'npc-1' });

  workbench.syncDeletedFolder('npc-folder', 'npc-parent');

  assert.deepEqual(workbench.browserStateFor('npc'), {
    folderId: 'npc-parent',
    selectedActorId: null,
    search: '',
  });
  assert.equal(workbench.browserStateFor('character').folderId, 'pc-folder');
});

test('Actor Workbench exposes common and type-specific edit tabs only for supported types', async () => {
  const { actorEditorTabs } = await loadActorWorkbench();

  assert.deepEqual(actorEditorTabs('character').map(tab => tab.key), [
    'basic', 'combat', 'items', 'background', 'spells', 'token', 'effects', 'advanced', 'traits', 'growth',
  ]);
  assert.deepEqual(actorEditorTabs('npc').map(tab => tab.key), [
    'basic', 'combat', 'items', 'background', 'spells', 'token', 'effects', 'advanced', 'npc', 'traits', 'legendary',
  ]);
  assert.deepEqual(actorEditorTabs('vehicle'), []);
});

test('Actor Workbench reads only controls present in the active editor tab', async () => {
  const { readActorEditForm } = await loadActorWorkbench();
  const form = {
    elements: {
      namedItem(name) {
        return {
          actorName: { value: '산의 거인', type: 'text' },
          hpValue: { value: '105', type: 'number' },
          inspiration: { checked: true, type: 'checkbox' },
        }[name] ?? null;
      },
    },
  };

  assert.deepEqual(readActorEditForm(form), {
    name: '산의 거인',
    hpValue: '105',
    inspiration: true,
  });
});

test('new PC uses direct creation and an NPC can choose direct or SBI creation inside Workbench state', async () => {
  const { ActorWorkbenchState } = await loadActorWorkbench();
  const workbench = new ActorWorkbenchState({ activeType: 'character' });

  assert.deepEqual(workbench.beginActorCreation(), {
    type: 'character',
    method: 'direct',
    name: '',
    img: '',
    folderId: null,
    sbiPayload: '',
  });

  workbench.beginActorCreation('npc');
  assert.equal(workbench.selectNpcCreationMethod('sbi'), 'sbi');
  assert.equal(workbench.creationState.type, 'npc');
  assert.equal(workbench.creationState.method, 'sbi');
  assert.equal(workbench.selectNpcCreationMethod('invalid'), 'sbi');
});

test('cancelling Actor creation clears only Workbench creation state', async () => {
  const { ActorWorkbenchState } = await loadActorWorkbench();
  const workbench = new ActorWorkbenchState({ activeType: 'npc' });

  workbench.beginActorCreation();
  workbench.setActorCreationDraft({ name: '취소할 NPC', sbiPayload: 'payload' });
  workbench.cancelActorCreation();

  assert.equal(workbench.creationState, null);
  assert.equal(workbench.activeType, 'npc');
});

async function withWorkbench(run) {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    CONFIG: globalThis.CONFIG,
    Actor: globalThis.Actor,
    __ncmTestRendered: globalThis.__ncmTestRendered,
  };
  globalThis.__ncmTestRendered = [];
  class ApplicationV2 {
    render() { globalThis.__ncmTestRendered.push(this); return this; }
    _onRender() {}
    async _prepareContext() { return {}; }
  }
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base },
    },
  };
  globalThis.CONFIG = {};
  globalThis.game = {
    user: { id: 'rXB1GcSui4mDsgAn' },
    actors: new Map(),
    folders: new Map([
      ['parent', { id: 'parent', name: '상위', type: 'Actor', folder: null }],
      ['child', { id: 'child', name: '하위', type: 'Actor', folder: { id: 'parent' } }],
    ]),
    modules: new Map(),
  };
  try {
    const module = await loadActorWorkbench();
    const { openActorWorkbench } = module;
    const workbench = openActorWorkbench({ activeType: 'npc', creationMode: 'sbi' });
    await run(
      workbench,
      module,
    );
  } finally {
    Object.assign(
      globalThis,
      previous,
    );
  }
}

function formControls(controls) {
  return { elements: { namedItem: (name) => controls[name] ?? null } };
}

test(
  'Detection structural edits survive render capture and preserve unrelated Actor drafts',
  async () => {
    await withWorkbench(async (workbench) => {
      workbench.cancelActorCreation();
      const source = {
        name: '곰', type: 'npc', system: {},
        prototypeToken: { detectionModes: {}, light: { alpha: 0.5 } },
      };
      const npc = { id: 'npc', type: 'npc', isOwner: true, toObject: () => structuredClone(source) };
      globalThis.game.actors.set(npc.id, npc);
      workbench.selectActor(npc);
      workbench.renderedActorId = npc.id;
      workbench.editorTabs.npc = 'token';
      const hidden = { name: 'field:prototypeToken.detectionModes', value: '[]', type: 'hidden' };
      const alpha = { name: 'field:prototypeToken.light.alpha', value: '0.55', type: 'number' };
      const container = { querySelector: () => hidden, querySelectorAll: () => [] };
      workbench.form = {
        querySelector: selector => selector === '[data-token-detection]' ? container : hidden,
        querySelectorAll: () => [hidden, alpha],
      };
      workbench.initialControls = { [hidden.name]: '[]', [alpha.name]: '0.5' };
      await workbench.changeTokenDetection();
      const context = await workbench._prepareContext({});
      const detection = context.fieldSections.find(section => section.isDetectionModes);
      assert.equal(detection.rows.length, 1);
      assert.equal(detection.rows[0].id, '');
      assert.equal(workbench.drafts.records.get(npc.id).values[alpha.name], '0.55');
      assert.deepEqual(source.prototypeToken.detectionModes, {});
      assert.equal(workbench.changingDetectionRows, false);
    });
  },
);

test(
  'All view retains selection across PC and NPC and follows external moves and deletions',
  async () => {
    await withWorkbench(async (workbench, module) => {
      workbench.cancelActorCreation();
      workbench.selectActorType('all');
      const pc = actor({ id: 'pc', type: 'character', name: '기사', folderId: 'child' });
      const npc = actor({ id: 'npc', type: 'npc', name: '곰', folderId: 'child' });
      globalThis.game.actors.set(pc.id, pc);
      globalThis.game.actors.set(npc.id, npc);
      workbench.selectActor(pc);
      assert.equal(workbench.activeType, 'all');
      assert.equal(workbench.selectedActor, pc);
      workbench.selectActor(npc);
      assert.equal(workbench.activeType, 'all');
      assert.equal(workbench.selectedActor, npc);
      npc.folder = { id: 'parent' };
      module.syncUpdatedActor(npc);
      assert.equal(workbench.browserStateFor('all').folderId, 'parent');
      module.syncDeletedActor(npc.id);
      assert.equal(workbench.selectedActor, null);
      workbench.setBrowserState('all', { folderId: 'child' });
      await workbench.constructor.DEFAULT_OPTIONS.actions.newActor.call(
        workbench,
        { preventDefault() {} },
        { dataset: { actorType: 'character' } },
      );
      assert.equal(workbench.creationState.type, 'character');
      assert.equal(workbench.creationState.folderId, 'child');
    });
  },
);

test(
  'Actor creation input survives an external open request when cancellation is declined',
  async () => {
    await withWorkbench(async (workbench) => {
      workbench.setActorCreationDraft({ name: '작성 중인 NPC', sbiPayload: '입력' });
      globalThis.foundry.applications.api.DialogV2 = { confirm: async () => false };
      await workbench.open({ activeType: 'character' });
      assert.equal(
        workbench.creationState.name,
        '작성 중인 NPC',
      );
      assert.equal(
        workbench.activeType,
        'npc',
      );
    });
  },
);

test(
  'Actor effects use the selected owner, respect permissions and require confirmation to delete',
  async () => {
    await withWorkbench(async (workbench) => {
      const creates = [];
      const updates = [];
      let deletes = 0;
      let opened = 0;
      const effect = {
        id: 'effect', disabled: false,
        documentName: 'ActiveEffect',
        toObject: () => ({ name: '효과', system: { changes: [] }, duration: {}, flags: {} }),
        update: async (update) => updates.push(update),
        delete: async () => { deletes++; },
        sheet: { render: () => { opened++; } },
      };
      const owner = {
        id: 'npc', type: 'npc', name: 'NPC', isOwner: true,
        effects: new Map([['effect', effect]]),
        createEmbeddedDocuments: async (
          type,
          sources,
        ) => {
          creates.push({ type, sources });
          return [effect];
        },
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      workbench.cancelActorCreation();
      workbench.selectActor(owner);
      workbench.form = formControls({ effectName: { value: '냉기 효과' } });
      const actions = workbench.constructor.DEFAULT_OPTIONS.actions;
      const event = { preventDefault() {} };
      const target = { dataset: { effectId: 'effect' } };
      await actions.createActorEffect.call(
        workbench,
        event,
      );
      assert.equal(
        creates[0].type,
        'ActiveEffect',
      );
      assert.equal(
        creates[0].sources[0].name,
        '냉기 효과',
      );
      assert.equal(
        creates[0].sources[0].transfer,
        false,
      );
      assert.equal(
        opened,
        0,
      );
      assert.ok(globalThis.__ncmTestRendered.some((app) =>
        app.config?.submitLabel === '효과 저장' &&
        app.fields?.some((field) => field.path === 'system.changes') &&
        app.fields?.some((field) => field.path === 'duration.units'),
      ));
      await actions.toggleActorEffect.call(
        workbench,
        event,
        target,
      );
      assert.deepEqual(
        updates,
        [{ disabled: true }],
      );
      workbench.confirmChange = async () => false;
      await actions.deleteActorEffect.call(
        workbench,
        event,
        target,
      );
      assert.equal(
        deletes,
        0,
      );
      owner.isOwner = false;
      await actions.toggleActorEffect.call(
        workbench,
        event,
        target,
      );
      await actions.createActorEffect.call(
        workbench,
        event,
      );
      assert.equal(
        creates.length,
        1,
      );
      assert.equal(
        updates.length,
        1,
      );
    });
  },
);

test(
  'Actor folder deletion retains contents and the internal token editor updates only prototypeToken paths',
  async () => {
    await withWorkbench(async (workbench) => {
      const calls = [];
      const folder = globalThis.game.folders.get('child');
      folder.delete = async (options) => calls.push(options);
      workbench.setBrowserState(
        'npc',
        { folderId: 'child' },
      );
      workbench.confirmChange = async () => true;
      const actions = workbench.constructor.DEFAULT_OPTIONS.actions;
      const event = { preventDefault() {} };
      await actions.deleteActorFolder.call(
        workbench,
        event,
      );
      assert.deepEqual(
        calls,
        [{ deleteSubfolders: false, deleteContents: false }],
      );
      const prototypeToken = { name: 'NPC' };
      const owner = {
        id: 'npc', type: 'npc', name: 'NPC', prototypeToken, isOwner: true,
        toObject: () => ({ prototypeToken }),
        update: async (patch) => calls.push(patch),
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      workbench.cancelActorCreation();
      workbench.selectActor(owner);
      let config;
      globalThis.CONFIG.Token = {
        prototypeSheetClass: class {
          constructor(options) { config = options; }
          render() {}
        },
      };
      await actions.openTokenConfig.call(
        workbench,
        event,
      );
      assert.equal(
        config,
        undefined
      );
      const editor = globalThis.__ncmTestRendered.find((app) => app.config?.title?.includes('전체 토큰'));
      await editor.config.save({ 'sight.range': 60 });
      assert.deepEqual(
        calls.at(-1),
        { 'prototypeToken.sight.range': 60 }
      );
    });
  },
);

function dragTransfer(data = {}) {
  let payload = JSON.stringify(data);
  return {
    types: ['text/plain'],
    setData(
      type,
      value,
    ) {
      assert.equal(
        type,
        'text/plain',
      );
      payload = value;
    },
    getData() { return payload; },
  };
}

function actorDropEvent(
  transfer,
  folderId,
) {
  return {
    dataTransfer: transfer,
    currentTarget: { dataset: { actorDropFolder: folderId } },
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

test(
  'Actor rows use standard Foundry drag data for folder moves and token placement',
  async () => {
    await withWorkbench(async (workbench) => {
      const owner = {
        id: 'dragged', type: 'npc',
        toDragData: () => ({ type: 'Actor', uuid: 'Actor.dragged' }),
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      const transfer = dragTransfer();
      assert.equal(
        workbench.onActorDragStart({
          currentTarget: { dataset: { actorId: owner.id } },
          dataTransfer: transfer,
        }),
        true,
      );
      assert.deepEqual(
        JSON.parse(transfer.getData('text/plain')),
        owner.toDragData(),
      );
      assert.equal(
        transfer.effectAllowed,
        'copyMove',
      );
    });
  },
);

test(
  'dropping a selected Actor into a child folder moves only its folder and keeps the source browser open',
  async () => {
    await withWorkbench(async (
      workbench,
      module,
    ) => {
      const updates = [];
      const owner = {
        id: 'moved', type: 'npc', name: '이동 NPC', folder: globalThis.game.folders.get('parent'),
        async update(update) {
          updates.push(update);
          this.folder = globalThis.game.folders.get(update.folder);
          module.syncUpdatedActor(this);
          return this;
        },
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      workbench.cancelActorCreation();
      workbench.selectActor(owner);
      const event = actorDropEvent(
        dragTransfer({ type: 'Actor', uuid: 'Actor.moved' }),
        'child',
      );
      assert.equal(
        await workbench.onActorDrop(event),
        true,
      );
      assert.deepEqual(
        updates,
        [{ folder: 'child' }],
      );
      assert.equal(
        workbench.browserStateFor('npc').folderId,
        'parent',
      );
      assert.equal(
        workbench.browserStateFor('npc').selectedActorId,
        null,
      );
      assert.equal(
        (await workbench._prepareContext({})).browser.rows.length,
        0,
      );
      assert.ok(event.defaultPrevented && event.propagationStopped);
      assert.equal(
        workbench.movingActorIds.size,
        0,
      );
    });
  },
);

test(
  'Actor drops support parent and root moves and do not save when dropped in the same folder',
  async () => {
    await withWorkbench(async (workbench) => {
      const updates = [];
      const owner = {
        id: 'moved', type: 'character', name: '이동 PC', folder: globalThis.game.folders.get('child'),
        async update(update) {
          updates.push(update);
          this.folder = globalThis.game.folders.get(update.folder) ?? null;
          return this;
        },
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      const transfer = dragTransfer({ type: 'Actor', uuid: 'Actor.moved' });
      for (const folderId of ['parent', '']) {
        assert.equal(
          await workbench.onActorDrop(actorDropEvent(
            transfer,
            folderId,
          )),
          true,
        );
      }
      assert.equal(
        await workbench.onActorDrop(actorDropEvent(
          transfer,
          '',
        )),
        false,
      );
      assert.deepEqual(
        updates,
        [{ folder: 'parent' }, { folder: null }],
      );
    });
  },
);

test(
  'Actor drops ignore foreign documents, invalid destinations, and users without permission',
  async () => {
    await withWorkbench(async (workbench) => {
      let calls = 0;
      const owner = { id: 'moved', type: 'npc', folder: null, async update() { calls += 1; } };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      globalThis.game.folders.set(
        'item-folder',
        { id: 'item-folder', type: 'Item' },
      );
      for (const data of [
        { type: 'Item', uuid: 'Actor.moved' },
        { type: 'Actor', uuid: 'Compendium.example.pack.moved' },
        { type: 'Actor', uuid: 'Scene.scene.Token.token.Actor.moved' },
        { type: 'Actor', uuid: 'Actor.deleted' },
      ]) {
        assert.equal(
          await workbench.onActorDrop(actorDropEvent(
            dragTransfer(data),
            'child',
          )),
          false,
        );
      }
      const transfer = dragTransfer({ type: 'Actor', uuid: 'Actor.moved' });
      for (const folderId of ['deleted-folder', 'item-folder', undefined]) {
        assert.equal(
          await workbench.onActorDrop(actorDropEvent(
            transfer,
            folderId,
          )),
          false,
        );
      }
      owner.canUserModify = () => false;
      assert.equal(
        await workbench.onActorDrop(actorDropEvent(
          transfer,
          'child',
        )),
        false,
      );
      owner.canUserModify = () => true;
      globalThis.game.user.id = 'ordinary-user';
      assert.equal(
        await workbench.onActorDrop(actorDropEvent(
          transfer,
          'child',
        )),
        false,
      );
      assert.equal(
        calls,
        0,
      );
    });
  },
);

test(
  'a failed Actor move preserves the selected folder and releases the move state for retry',
  async () => {
    await withWorkbench(async (workbench) => {
      const owner = {
        id: 'moved', type: 'npc', folder: globalThis.game.folders.get('parent'),
        async update() { throw new Error('permission denied'); },
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      workbench.selectActor(owner);
      const before = workbench.browserStateFor('npc');
      assert.equal(
        await workbench.onActorDrop(actorDropEvent(
          dragTransfer({ type: 'Actor', uuid: 'Actor.moved' }),
          'child',
        )),
        false,
      );
      assert.deepEqual(
        workbench.browserStateFor('npc'),
        before,
      );
      assert.equal(
        workbench.movingActorIds.size,
        0,
      );
    });
  },
);

test(
  'SBI creation follows folder navigation, keeps the payload, and selects the imported Actor in that folder',
  async () => {
    await withWorkbench(async (workbench) => {
      const payload = '===STATBLOCK===\nTest Drake\n===LOCALIZATION===\n{}';
      workbench.form = formControls({
        sbiPayload: { value: payload },
        actorFolderId: { value: 'obsolete-folder' },
      });
      const actions = workbench.constructor.DEFAULT_OPTIONS.actions;
      await actions.openActorFolder.call(
        workbench,
        { preventDefault() {} },
        { dataset: { folderId: 'child' } },
      );
      assert.equal(
        workbench.creationState.folderId,
        'child',
      );
      assert.equal(
        workbench.creationState.sbiPayload,
        payload,
      );
      assert.equal(
        (await workbench._prepareContext({})).creation.folderName,
        '하위',
      );

      globalThis.game.modules.set(
        '5e-statblock-importer',
        {
          api: {
            parse: () => ({ actor: { name: 'Test Drake' } }),
            async import(
              statblock,
              folderId,
            ) {
              assert.equal(
                statblock,
                'Test Drake',
              );
              assert.equal(
                folderId,
                'child',
              );
              return {
                actor5e: { id: 'imported', type: 'npc', name: 'Test Drake', folder: { id: folderId }, items: [] },
              };
            },
          },
        },
      );
      workbench.selectEditorTab('legendary');
      await actions.importSbi.call(
        workbench,
        { preventDefault() {} },
      );
      assert.equal(
        workbench.sbiError,
        null,
      );
      assert.equal(
        workbench.creationState,
        null,
      );
      assert.equal(
        workbench.browserStateFor('npc').folderId,
        'child',
      );
      assert.equal(
        workbench.browserStateFor('npc').selectedActorId,
        'imported',
      );
      assert.equal(
        workbench.activeEditorTabFor('npc'),
        'basic',
      );
    });
  },
);

test(
  'direct creation follows navigation back to root and rejects missing folders',
  async () => {
    await withWorkbench(async (workbench) => {
      workbench.openActorFolder('parent');
      workbench.beginActorCreation();
      workbench.form = formControls({ actorName: { value: '새 NPC' } });
      const actions = workbench.constructor.DEFAULT_OPTIONS.actions;
      await actions.goActorParentFolder.call(
        workbench,
        { preventDefault() {} },
      );
      assert.equal(
        workbench.creationState.folderId,
        null,
      );
      globalThis.Actor = {
        async create(source) {
          assert.equal(
            source.folder,
            null,
          );
          return { id: 'direct', type: 'npc', name: source.name, folder: null };
        },
      };
      await actions.saveNewActor.call(
        workbench,
        { preventDefault() {} },
      );
      workbench.beginActorCreation();
      workbench.setBrowserState(
        'npc',
        { folderId: 'deleted-folder' },
      );
      assert.throws(
        () => workbench.actorCreationFolderId(),
        /액터 폴더를 찾을 수 없습니다/,
      );
    });
  },
);

test(
  'Workbench image picker fills the appropriate control and saves both images without changing token settings',
  async () => {
    await withWorkbench(async (workbench) => {
      const updates = [];
      const owner = {
        id: 'editable', type: 'npc', name: '이미지 NPC', folder: null,
        toObject: () => ({ img: 'old-portrait.webp', prototypeToken: { texture: { src: 'old-token.webp', scaleX: 2 }, width: 2 } }),
        async update(update) { updates.push(update); return this; },
      };
      globalThis.game.actors.set(
        owner.id,
        owner,
      );
      workbench.cancelActorCreation();
      workbench.selectActor(owner);
      const controls = {
        actorImg: { value: 'old-portrait.webp', dispatchEvent() {} },
        tokenImg: { value: 'old-token.webp', dispatchEvent() {} },
      };
      workbench.form = formControls(controls);
      // 2026-11-21: 초상화·토큰 칸은 기록보관소 이미지 갤러리를 연다. 초상화 칸은 portrait, 토큰 칸은 token 종류.
      const opened = [];
      globalThis.__ncmImageGalleryOpener = async (options) => {
        opened.push({ kind: options.kind, current: options.current });
        if (options.kind === 'portrait') await options.onSelect('https://nihilncunia-images.com/portrait.webp');
        else await options.onPickLocal();
      };
      const paths = ['token.webp'];
      globalThis.CONFIG.ux = {
        FilePicker: class {
          constructor(options) { this.options = options; }
          async browse() {
            assert.equal(
              this.options.type,
              'image',
            );
            this.options.callback(paths.shift());
          }
        },
      };
      const actions = workbench.constructor.DEFAULT_OPTIONS.actions;
      try {
        for (const name of ['actorImg', 'tokenImg']) {
          await actions.pickActorImage.call(
            workbench,
            { preventDefault() {} },
            { dataset: { imageField: name } },
          );
        }
      } finally {
        delete globalThis.__ncmImageGalleryOpener;
      }
      assert.deepEqual(opened, [
        { kind: 'portrait', current: 'old-portrait.webp' },
        { kind: 'token', current: 'old-token.webp' },
      ]);
      assert.deepEqual(
        updates,
        [],
      );
      await actions.saveActor.call(
        workbench,
        { preventDefault() {} },
      );
      assert.deepEqual(
        updates,
        [{ img: 'https://nihilncunia-images.com/portrait.webp', 'prototypeToken.texture.src': 'token.webp' }],
      );
    });
  },
);
test(
  'Habitat row additions and removals survive render capture without discarding other Actor input',
  async () => {
    await withWorkbench(async (workbench) => {
      workbench.cancelActorCreation();
      const source = {
        name: '곰',
        type: 'npc',
        system: { details: { habitat: { value: [], custom: '' } } },
      };
      const npc = {
        id: 'npc',
        type: 'npc',
        isOwner: true,
        toObject: () => structuredClone(source),
      };
      globalThis.game.actors.set(
        npc.id,
        npc,
      );
      workbench.selectActor(npc);
      workbench.renderedActorId = npc.id;
      workbench.editorTabs.npc = 'npc';
      const hidden = {
        name: 'field:system.details.habitat.value',
        value: '[]',
        type: 'hidden',
      };
      const name = { name: 'actorName', value: '흰 곰', type: 'text' };
      const container = {
        querySelector: () => hidden,
        querySelectorAll: () => [],
      };
      workbench.form = {
        querySelector: (selector) =>
          selector === '[data-actor-habitat]' ? container : null,
        querySelectorAll: () => [hidden, name],
      };
      workbench.initialControls = { [hidden.name]: '[]', [name.name]: '곰' };
      workbench.render = async () => {
        workbench.captureEditorDraft();
        return workbench;
      };
      await workbench.changeActorHabitat();
      const context = await workbench._prepareContext({});
      assert.equal(
        context.fieldSections.find((section) => section.isHabitats).rows.length,
        1,
      );
      assert.equal(
        workbench.drafts.records.get(npc.id).values.actorName,
        '흰 곰',
      );
      assert.equal(
        workbench.changingDetectionRows,
        false,
      );
      hidden.value = '[{"type":"","subtype":""}]';
      container.querySelectorAll = () => [
        { querySelector: () => ({ value: '' }) },
      ];
      await workbench.changeActorHabitat(0);
      assert.deepEqual(
        workbench.drafts.prepare(npc).update,
        { name: '흰 곰' },
      );
      assert.deepEqual(
        source.system.details.habitat.value,
        [],
      );
    });
  },
);
test(
  'Rendered habitat drafts compare against document rows instead of their rendered draft value',
  async () => {
    await withWorkbench(async (workbench) => {
      workbench.cancelActorCreation();
      const source = {
        name: '곰',
        type: 'npc',
        system: { details: { habitat: { value: [], custom: '' } } },
      };
      const npc = {
        id: 'npc',
        type: 'npc',
        isOwner: true,
        toObject: () => structuredClone(source),
      };
      globalThis.CONFIG.DND5E = { habitats: { arctic: { label: '극지' } } };
      globalThis.game.actors.set(
        npc.id,
        npc,
      );
      workbench.selectActor(npc);
      const name = 'field:system.details.habitat.value';
      const rows = [{ type: 'arctic', subtype: '눈' }];
      workbench.drafts.capture(
        npc,
        { [name]: JSON.stringify(rows) },
        { [name]: '[]' },
      );
      const hidden = { name, value: JSON.stringify(rows), type: 'hidden' };
      const container = {
        querySelector: () => hidden,
        querySelectorAll: () => [
          {
            querySelector: (selector) => ({
              value: selector === '[data-habitat-type]' ? 'arctic' : '눈',
            }),
          },
        ],
      };
      workbench.form = {
        elements: { namedItem: () => hidden },
        querySelector: (selector) =>
          selector === '[data-actor-habitat]' ? container : null,
        querySelectorAll: () => [hidden],
      };
      workbench.element = {
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      workbench.bindActorDragDrop = () => {};
      workbench.refreshCombatPreview = () => {};
      workbench._onRender(
        {},
        {},
      );
      assert.equal(
        workbench.initialControls[name],
        '[]',
      );
      workbench.captureEditorDraft();
      assert.deepEqual(
        workbench.drafts.prepare(npc).update,
        {
          'system.details.habitat.value': rows,
        },
      );
    });
  },
);
