import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorFieldSections,
  actorAbilityCards,
  previewActorAbilityCards,
  actorSkillCards,
  previewActorCombatCards,
  buildActorFieldUpdate,
} from '../scripts/workbench/actor-fields.mjs';
import {
  ActorDraftStore,
  actorControlsToForm,
} from '../scripts/workbench/actor-drafts.mjs';

function fixture() {
  const source = {
    name: '곰',
    img: 'bear.webp',
    type: 'npc',
    prototypeToken: {
      name: '곰',
      actorLink: false,
      width: 2,
      height: 2,
      sight: { enabled: false },
      texture: { src: 'token.webp', scaleX: 1, scaleY: 1 },
    },
    system: {
      abilities: { str: { value: 20, proficient: 1 } },
      attributes: {
        ac: { calcs: ['natural'], flat: 15 },
        hp: { value: 100, max: 100, temp: 0 },
        senses: { ranges: { darkvision: 60 } },
      },
      skills: { ath: { value: 1, ability: 'str' } },
      traits: {
        dr: { value: ['cold', 'homebrew'], custom: '얼음', bypasses: ['mgc'] },
      },
      spells: { spell1: { value: 2, override: null } },
      resources: { lair: { inside: false } },
      currency: { gp: 11 },
    },
    flags: { otherModule: { retained: true } },
    items: [{ _id: 'bite', name: '물기' }],
  };
  return {
    source,
    actor: {
      id: 'bear',
      name: '곰',
      type: 'npc',
      toObject: () => structuredClone(source),
    },
  };
}

test(
  'Ability cards preserve six input groups and show prepared final check and save modifiers',
  () => {
    const { actor } = fixture();
    actor.system = {
      abilities: {
        str: { mod: 5, checkBonus: 2, save: { value: 11 } },
        dex: { mod: -1, checkBonus: 0, save: { value: -1 } },
        con: { mod: 0, save: { value: 0 } },
      },
    };
    const abilities = actorFieldSections(actor).find(section => section.isAbilities);
    assert.deepEqual(
      abilities.cards.map(card => card.key),
      ['str', 'dex', 'con', 'int', 'wis', 'cha'],
    );
    assert.equal(
      abilities.cards[0].score.name,
      'field:system.abilities.str.value',
    );
    assert.equal(
      abilities.cards[0].proficiency.name,
      'field:system.abilities.str.proficient',
    );
    assert.deepEqual(
      abilities.cards.slice(0, 3).map(({ modifier, saveModifier }) => [modifier, saveModifier]),
      [['+7', '+11'], ['-1', '-1'], ['+0', '+0']],
    );
    assert.equal(
      abilities.bonusFields.length,
      12,
    );
    assert.equal(
      actorAbilityCards(actor)[3].modifier,
      '—',
    );
  },
);

test(
  'Ability preview calculates on an unsaved clone and leaves the Actor source unchanged',
  () => {
    const { actor, source } = fixture();
    const original = structuredClone(source);
    const cloned = [];
    let prepared = false;
    actor.clone = (
      update,
      options,
    ) => {
      cloned.push({ update, options });
      return {
        system: { abilities: { str: { mod: 6, checkBonus: 1, save: { value: 9 } } } },
        prepareData() { prepared = true; },
      };
    };
    const cards = previewActorAbilityCards(
      actor,
      { 'field:system.abilities.str.value': '22', actorName: '변경하지 않을 이름' },
    );
    assert.deepEqual(
      cloned,
      [{ update: { 'system.abilities.str.value': 22 }, options: { keepId: true, save: false } }],
    );
    assert.equal(
      prepared,
      true,
    );
    assert.equal(
      cards[0].modifier,
      '+7',
    );
    assert.equal(
      cards[0].saveModifier,
      '+9',
    );
    assert.deepEqual(
      source,
      original,
    );
    assert.throws(
      () => previewActorAbilityCards(
        actor,
        { 'field:system.abilities.str.value': '' },
      ),
      /올바른 범위/,
    );
  },
);

test(
  'Skill cards use prepared final totals and keep the base ability out of editable fields',
  () => {
    const { actor } = fixture();
    actor.system = {
      skills: {
        ath: { ability: 'str', total: 11, passive: 25 },
        arc: { ability: 'int', total: -3, passive: 7 },
      },
    };
    const skills = actorFieldSections(actor).find(section => section.isSkills);
    assert.deepEqual(
      skills.cards.map(({ key, ability, modifier, passive }) => ({ key, ability, modifier, passive })),
      [
        { key: 'ath', ability: '근력', modifier: '+11', passive: '25' },
        { key: 'arc', ability: '지능', modifier: '-3', passive: '7' },
      ],
    );
    assert.equal(
      skills.cards[0].proficiency.name,
      'field:system.skills.ath.value',
    );
    assert.equal(
      skills.bonusFields.length,
      2,
    );
    assert.ok(!actorFieldSections(actor).some(section => section.fields.some(field => field.path === 'system.skills.ath.ability')));
    assert.throws(
      () => buildActorFieldUpdate(
        actor,
        { 'system.skills.ath.ability': 'dex' },
      ),
      /편집할 수 없는/,
    );
    assert.equal(
      actorSkillCards({ system: { skills: { ath: { ability: 'str' } } } })[0].modifier,
      '—',
    );
  },
);

test(
  'Combat preview prepares one unsaved clone for combined ability, proficiency and skill bonus changes',
  () => {
    const { actor, source } = fixture();
    const original = structuredClone(source);
    let prepared = false;
    let received;
    actor.clone = (
      update,
      options,
    ) => {
      received = { update, options };
      return {
        system: {
          abilities: { str: { mod: 6, save: { value: 9 } } },
          skills: { ath: { ability: 'str', total: 14, passive: 25 } },
        },
        prepareData() { prepared = true; },
      };
    };
    const cards = previewActorCombatCards(
      actor,
      {
        'field:system.abilities.str.value': '22',
        'field:system.skills.ath.value': '2',
        'field:system.skills.ath.bonuses.check': '2',
        'field:system.skills.ath.bonuses.passive': '1',
      },
    );
    assert.deepEqual(
      received,
      {
        update: {
          'system.abilities.str.value': 22,
          'system.skills.ath.value': 2,
          'system.skills.ath.bonuses.check': '2',
          'system.skills.ath.bonuses.passive': '1',
        },
        options: { keepId: true, save: false },
      },
    );
    assert.equal(
      prepared,
      true,
    );
    assert.equal(
      cards.abilities[0].modifier,
      '+6',
    );
    assert.equal(
      cards.skills[0].modifier,
      '+14',
    );
    assert.equal(
      cards.skills[0].passive,
      '25',
    );
    assert.deepEqual(
      source,
      original,
    );
  },
);

test(
  'Ability and skill cards highlight nonzero proficiency, including half proficiency and expertise',
  () => {
    for (const value of [0, 0.5, 1, 2]) {
      const actor = {
        system: {
          abilities: { str: { proficient: value } },
          skills: { ath: { value } },
        },
      };
      assert.equal(
        actorAbilityCards(actor)[0].isProficient,
        value > 0,
      );
      assert.equal(
        actorSkillCards(actor)[0].isProficient,
        value > 0,
      );
    }
  },
);

test(
  'Returning a rendered Actor field to its initial value removes only that draft field',
  () => {
    const { actor } = fixture();
    const store = new ActorDraftStore();
    store.capture(
      actor,
      { actorName: '수정한 곰', 'field:prototypeToken.width': '3' },
      { actorName: '곰', 'field:prototypeToken.width': '2' },
    );
    store.capture(
      actor,
      { actorName: '곰' },
      { actorName: '곰' },
    );
    assert.deepEqual(
      store.prepare(actor).update,
      { 'prototypeToken.width': 3 },
    );
    store.capture(
      actor,
      { 'field:prototypeToken.width': '2' },
      { 'field:prototypeToken.width': '2' },
    );
    assert.equal(
      store.records.size,
      0,
    );
  },
);

test(
  'Prototype name and bar display choices match the Foundry hover and owner constants',
  () => {
    const { actor } = fixture();
    const fields = actorFieldSections(actor).flatMap((group) => group.fields);
    for (const path of ['prototypeToken.displayName', 'prototypeToken.displayBars']) {
      const options = fields.find((field) => field.path === path).options;
      assert.equal(
        options.find((entry) => String(entry.value) === '20').label,
        '소유자 가리키기',
      );
      assert.equal(
        options.find((entry) => String(entry.value) === '30').label,
        '누구나 가리키기',
      );
      assert.equal(
        options.find((entry) => String(entry.value) === '40').label,
        '소유자 항상',
      );
    }
  },
);

test(
  'Actor completion translates skills, null slot overrides, traits and prototype values without replacing other data',
  () => {
    const { actor, source } = fixture();
    const original = structuredClone(source);
    const update = buildActorFieldUpdate(
      actor,
      {
        'system.abilities.str.value': '22',
        'system.skills.ath.value': '2',
        'system.attributes.senses.ranges.darkvision': '',
        'system.traits.dr.value': ['cold'],
        'system.spells.spell1.override': '',
        'prototypeToken.actorLink': true,
        'prototypeToken.width': '3',
      },
    );
    assert.deepEqual(
      update,
      {
        'system.abilities.str.value': 22,
        'system.skills.ath.value': 2,
        'system.attributes.senses.ranges.darkvision': null,
        'system.traits.dr.value': ['cold'],
        'prototypeToken.actorLink': true,
        'prototypeToken.width': 3,
      },
    );
    assert.deepEqual(
      source,
      original,
    );
    const field = actorFieldSections(actor)
      .flatMap((group) => group.fields)
      .find((field) => field.path === 'system.traits.dr.value');
    assert.ok(
      field.options.some(
        (option) => option.value === 'homebrew' && option.selected,
      ),
    );
  },
);

test(
  'Actor edits reject invalid numbers and unexposed paths before any write',
  () => {
    const { actor } = fixture();
    for (const value of ['-1', 'NaN', '1.5', '']) {
      assert.throws(() =>
        buildActorFieldUpdate(
          actor,
          { 'system.abilities.str.value': value },
        ),
      );
    }
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { 'prototypeToken.width': '0' },
      ),
    );
    assert.throws(() => buildActorFieldUpdate(
      actor,
      { 'ownership.default': 3 },
    ));
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { '__proto__.polluted': true },
      ),
    );
  },
);

test(
  'Actor drafts accumulate across tabs, restore per Actor and preserve unrelated external updates',
  () => {
    const { actor, source } = fixture();
    const store = new ActorDraftStore();
    store.capture(
      actor,
      { actorName: '큰 곰' },
      { actorName: '곰' },
    );
    store.capture(
      actor,
      { hpValue: '90' },
      { hpValue: '100' },
    );
    source.system.currency.gp = 20;
    assert.deepEqual(
      store.prepare(actor),
      {
        update: { name: '큰 곰', 'system.attributes.hp.value': 90 },
        conflicts: [],
      },
    );
    assert.equal(
      store.records.get(actor.id).values.actorName,
      '큰 곰',
    );
    assert.deepEqual(
      actorControlsToForm({
        'field:prototypeToken.width': '3',
        sourceBook: 'MM',
        actorName: '큰 곰',
      }),
      {
        name: '큰 곰',
        source: { book: 'MM' },
        fields: { 'prototypeToken.width': '3' },
      },
    );
  },
);

test(
  'Actor drafts detect same-field external edits, retain invalid input and clear reverted edits',
  () => {
    const { actor, source } = fixture();
    const store = new ActorDraftStore();
    store.capture(
      actor,
      { hpValue: '90' },
      { hpValue: '100' },
    );
    source.system.attributes.hp.value = 80;
    assert.deepEqual(
      store.prepare(actor).conflicts,
      [
        'system.attributes.hp.value',
      ],
    );
    store.capture(
      actor,
      { hpValue: '100' },
      { hpValue: '80' },
    );
    assert.equal(
      store.records.size,
      0,
    );
    store.capture(
      actor,
      { 'field:prototypeToken.width': 'bad' },
      { 'field:prototypeToken.width': '2' },
    );
    assert.equal(
      store.records.size,
      1,
    );
    assert.throws(() => store.prepare(actor));
  },
);

test(
  'Advanced Actor fields retain source arrays and never expose flags or embedded Item internals',
  () => {
    const { actor, source } = fixture();
    source.system.details = {
      habitat: { value: [{ type: 'arctic', subtype: 'coast' }] },
    };
    const fields = actorFieldSections(actor).flatMap((group) => group.fields);
    assert.ok(
      fields.some((field) => field.path === 'system.resources.lair.inside'),
    );
    assert.ok(
      fields.some(
        (field) => field.path === 'system.details.habitat.value' && field.isJson,
      ),
    );
    assert.ok(
      fields.every(
        (field) =>
          !field.path.startsWith('items.') && !field.path.startsWith('flags.'),
      ),
    );
    assert.throws(() =>
      buildActorFieldUpdate(
        actor,
        { 'system.details.habitat.value': '{}' },
      ),
    );
  },
);
