import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorFieldSections,
  buildActorFieldUpdate,
} from '../scripts/workbench/actor-fields.mjs';
import { ActorDraftStore } from '../scripts/workbench/actor-drafts.mjs';
import { actorItemGroups } from '../scripts/workbench/actor-item-groups.mjs';
import { readHabitatInputs } from '../scripts/workbench/actor-list-fields.mjs';

function fixture(type = 'character') {
  const source = {
    _id: 'actor',
    type,
    name: '대상',
    system: {
      attributes: {
        hp: { value: 20, max: 20, bonuses: { level: '', overall: '' } },
        concentration: {
          limit: 1,
          ability: '',
          bonuses: { save: '' },
          roll: { min: null, max: null, mode: 0 },
        },
        loyalty: { value: undefined },
        death: { success: 0, failure: 0, bonuses: { save: '' } },
        movement: { bonus: '', ignoredDifficultTerrain: [] },
      },
      details: {
        alignment: '중립',
        ideal: ' 첫 줄\n둘째 줄 ',
        biography: { value: '', public: '' },
        race: 'race',
        background: '옛 배경 이름',
        originalClass: 'class',
      },
      currency: { gp: 10 },
      traits: {
        size: 'med',
        weaponProf: {
          value: ['sim', 'custom'],
          custom: '',
          mastery: { value: ['longsword'], bonus: ['cleave'] },
        },
        armorProf: { value: ['lgt'], custom: '' },
      },
      tools: {},
      favorites: [{ type: 'item', id: 'Item.class', sort: 1000 }],
      extension: { opaque: ['keep'] },
    },
    items: [
      {
        _id: 'class',
        name: '전사',
        type: 'class',
        system: { identifier: 'fighter', levels: 3 },
      },
      {
        _id: 'subclass',
        name: '챔피언',
        type: 'subclass',
        system: { classIdentifier: 'fighter' },
      },
      { _id: 'race', name: '인간', type: 'race', system: {} },
      { _id: 'background', name: '병사', type: 'background', system: {} },
      {
        _id: 'weapon',
        name: '검',
        type: 'weapon',
        system: { quantity: 1, equipped: true, attuned: true },
      },
      { _id: 'extension', name: '확장', type: 'custom', system: {} },
    ],
    flags: { unrelated: { keep: true } },
  };
  const actor = {
    id: source._id,
    type,
    name: source.name,
    items: source.items,
    toObject: () => structuredClone(source),
  };
  return { actor, source };
}

function configured(run) {
  const previous = globalThis.CONFIG;
  const previousGame = globalThis.game;
  globalThis.CONFIG = {
    DND5E: {
      tools: { thief: { ability: 'dex' } },
      weaponProficiencies: { sim: '간이 무기', mar: '군용 무기' },
      armorProficiencies: { lgt: '경갑' },
      weaponIds: { longsword: 'Compendium.weapon' },
      weaponMasteries: {
        cleave: { label: '가르기' },
        nick: { label: '연속 공격' },
      },
      actorSizes: { med: { label: '중형' } },
      currencies: { gp: { label: '금화' } },
      difficultTerrainTypes: { snow: { label: '눈' } },
    },
  };
  globalThis.game = {
    system: {
      documentTypes: {
        Item: {
          class: {},
          subclass: {},
          race: {},
          background: {},
          weapon: {},
          spell: {},
          custom: {},
        },
      },
    },
  };
  try {
    return run();
  } finally {
    globalThis.CONFIG = previous;
    globalThis.game = previousGame;
  }
}

test(
  'Known PC fields leave advanced, with no duplicate descriptors or derived level writes',
  () =>
  configured(() => {
    const { actor } = fixture();
    const sections = actorFieldSections(actor);
    const fields = sections.flatMap((section) => section.fields);
    assert.equal(
      new Set(fields.map((field) => field.path)).size,
      fields.length,
    );
    for (const [path, tab] of [
      ['system.details.ideal', 'background'],
      ['system.currency.gp', 'items'],
      ['system.traits.weaponProf.value', 'traits'],
      ['system.attributes.loyalty.value', 'combat'],
      ['system.attributes.movement.ignoredDifficultTerrain', 'combat'],
      ['system.details.originalClass', 'growth'],
    ])
      assert.ok(
        sections.some(
          (section) =>
            section.tab === tab &&
            section.fields.some((field) => field.path === path),
        ),
      );
    assert.ok(!fields.some((field) => field.path === 'system.details.level'));
    assert.ok(
      sections
        .find((section) => section.title === '즐겨찾기')
        .fields.some((field) => field.path === 'system.favorites'),
    );
  }),
);

test(
  'Multiline background and optional loyalty preserve whitespace and null, without touching unknown data',
  () =>
  configured(() => {
    const { actor, source } = fixture();
    const original = structuredClone(source);
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        {
          'system.details.ideal': ' 변경\n내용 ',
          'system.attributes.loyalty.value': '',
          'system.currency.gp': '12',
        },
      ),
      {
        'system.details.ideal': ' 변경\n내용 ',
        'system.attributes.loyalty.value': null,
        'system.currency.gp': 12,
      },
    );
    assert.deepEqual(
      source,
      original,
    );
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { 'system.currency.gp': '-1' },
      ),
    );
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { 'system.attributes.loyalty.value': '21' },
      ),
    );
  }),
);

test(
  'Weapon mastery choice lists distinguish weapon bases from bonus mastery properties',
  () =>
  configured(() => {
    const { actor } = fixture();
    const fields = actorFieldSections(actor).flatMap(
      (section) => section.fields,
    );
    const selected = fields.find(
      (field) => field.path === 'system.traits.weaponProf.mastery.value',
    );
    const bonus = fields.find(
      (field) => field.path === 'system.traits.weaponProf.mastery.bonus',
    );
    assert.equal(
      selected.options.find((option) => option.value === 'longsword').label,
      '장검',
    );
    assert.equal(
      bonus.options.find((option) => option.value === 'cleave').label,
      '가르기',
    );
    assert.ok(!bonus.options.some((option) => option.value === 'longsword'));
    assert.ok(
      fields
        .find((field) => field.path === 'system.traits.weaponProf.value')
        .options.some((option) => option.value === 'custom' && option.selected),
    );
  }),
);

test(
  'Registering tool proficiency applies its configured ability, retaining other tool and system data',
  () =>
  configured(() => {
    const { actor, source } = fixture();
    const original = structuredClone(source);
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        { 'system.tools.thief.value': '1' },
      ),
      {
        'system.tools.thief.value': 1,
        'system.tools.thief.ability': 'dex',
      },
    );
    source.system.tools.thief = {
      value: 1,
      ability: 'wis',
      bonuses: { check: '2' },
    };
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        { 'system.tools.thief.value': '2' },
      ),
      { 'system.tools.thief.value': 2 },
    );
    source.system.tools = {};
    assert.deepEqual(
      source,
      original,
    );
  }),
);

test(
  'Origin connections use owned IDs, retaining legacy names and rejecting newly invented references',
  () =>
  configured(() => {
    const { actor } = fixture();
    const fields = actorFieldSections(actor).flatMap(
      (section) => section.fields,
    );
    const background = fields.find(
      (field) => field.path === 'system.details.background',
    );
    assert.ok(
      background.options.some(
        (option) => option.value === '옛 배경 이름' && option.selected,
      ),
    );
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        {
          'system.details.background': 'background',
        },
      ),
      { 'system.details.background': 'background' },
    );
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { 'system.details.background': 'class' },
      ),
    );
  }),
);

test(
  'Roll bounds allow clearing one override but reject crossed ranges',
  () =>
  configured(() => {
    const { actor, source } = fixture();
    source.system.attributes.concentration.roll = { min: 5, max: 15, mode: 0 };
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        {
          'system.attributes.concentration.roll.min': '16',
        },
      ),
    );
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        {
          'system.attributes.concentration.roll.min': '',
          'system.attributes.concentration.roll.max': '3',
        },
      ),
      {
        'system.attributes.concentration.roll.min': null,
        'system.attributes.concentration.roll.max': 3,
      },
    );
  }),
);

test(
  'NPC death saves, lair state and price use purpose tabs with PC-only fields excluded',
  () =>
  configured(() => {
    const { actor, source } = fixture('npc');
    source.system.resources = { lair: { inside: false } };
    source.system.attributes.price = { value: null, denomination: 'gp' };
    source.system.traits.important = false;
    const sections = actorFieldSections(actor);
    for (const [path, tab] of [
      ['system.attributes.death.success', 'combat'],
      ['system.resources.lair.inside', 'legendary'],
      ['system.attributes.price.denomination', 'npc'],
      ['system.traits.important', 'npc'],
    ])
      assert.ok(
        sections.some(
          (section) =>
            section.tab === tab &&
            section.fields.some((field) => field.path === path),
        ),
      );
    assert.ok(!sections.some((section) => section.tab === 'growth'));
  }),
);

test(
  'Owned items group all types exactly once and resolve subclass links without altering documents',
  () =>
  configured(() => {
    const { actor, source } = fixture();
    const original = structuredClone(source);
    const growth = actorItemGroups(
      actor,
      'growth',
    );
    assert.deepEqual(
      growth.map((group) => group.type),
      ['class', 'subclass', 'race', 'background'],
    );
    assert.equal(
      growth[0].rows[0].summary,
      '3레벨',
    );
    assert.equal(
      growth[1].rows[0].summary,
      '전사',
    );
    const groups = actorItemGroups(
      actor,
      'items',
    );
    assert.equal(
      groups.flatMap((group) => group.rows).length,
      source.items.length,
    );
    assert.ok(groups.find((group) => group.type === 'custom').canCreate);
    assert.equal(
      groups.find((group) => group.type === 'weapon').rows[0].summary,
      '수량 1 | 장착 | 조율',
    );
    source.items[1].system.classIdentifier = 'missing';
    assert.match(
      actorItemGroups(
        actor,
        'growth',
      )[1].rows[0].summary,
      /연결 클래스 없음/,
    );
    source.items[1].system.classIdentifier = 'fighter';
    assert.deepEqual(
      source,
      original,
    );
  }),
);

test(
  'Background drafts survive tab changes, preserve foreign fields and detect same-field conflicts',
  () =>
  configured(() => {
    const { actor, source } = fixture();
    const store = new ActorDraftStore();
    store.capture(
      actor,
      { 'field:system.details.ideal': '새 이상' },
      { 'field:system.details.ideal': source.system.details.ideal },
    );
    source.system.currency.gp = 30;
    assert.deepEqual(
      store.prepare(actor),
      {
        update: { 'system.details.ideal': '새 이상' },
        conflicts: [],
      },
    );
    source.system.details.ideal = '다른 클라이언트';
    assert.deepEqual(
      store.prepare(actor).conflicts,
      ['system.details.ideal'],
    );
  }),
);
test(
  'Favorites retain existing order and metadata while adding only owned item or activity references',
  () =>
  configured(() => {
    const { actor, source } = fixture();
    source.system.favorites[0].extra = 'keep';
    source.items[0].system.activities = {
      strike: { _id: 'strike', name: '공격' },
    };
    const update = buildActorFieldUpdate(
      actor,
      {
        'system.favorites': [
          '.Item.class.Activity.strike',
          'Item.class',
          '.Item.race',
        ],
      },
    );
    assert.deepEqual(
      update['system.favorites'][0],
      source.system.favorites[0],
    );
    assert.equal(
      update['system.favorites'][1].type,
      'activity',
    );
    assert.equal(
      update['system.favorites'][2].type,
      'item',
    );
    assert.ok(
      update['system.favorites'][1].sort > source.system.favorites[0].sort,
    );
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { 'system.favorites': ['.Item.foreign'] },
      ),
    );
  }),
);

test(
  'Habitat rows preserve unknown keys, read modified subtypes and reject malformed or unknown new types',
  () =>
  configured(() => {
    const { actor, source } = fixture('npc');
    globalThis.CONFIG.DND5E.habitats = {
      arctic: { label: '극지' },
      forest: { label: '숲' },
    };
    const original = [{ type: 'arctic', subtype: '눈', extra: { keep: true } }];
    source.system.details.habitat = { value: original, custom: '' };
    const container = {
      querySelector: () => ({ value: JSON.stringify(original) }),
      querySelectorAll: () => [
        {
          querySelector: (selector) => ({
            value: selector === '[data-habitat-type]' ? 'arctic' : '얼음',
          }),
        },
      ],
    };
    const rows = readHabitatInputs({ querySelector: () => container });
    assert.deepEqual(
      rows,
      [
        { type: 'arctic', subtype: '얼음', extra: { keep: true } },
      ],
    );
    assert.deepEqual(
      buildActorFieldUpdate(
        actor,
        {
          'system.details.habitat.value': JSON.stringify(rows),
        },
      ),
      { 'system.details.habitat.value': rows },
    );
    for (const invalid of [
      [{ type: '' }],
      [{ type: 'invented' }],
      [{ type: 'arctic', subtype: 3 }],
    ]) {
      assert.throws(() =>
        buildActorFieldUpdate(
          actor,
          {
            'system.details.habitat.value': JSON.stringify(invalid),
          },
        ),
      );
    }
    assert.deepEqual(
      source.system.details.habitat.value,
      original,
    );
  }),
);
