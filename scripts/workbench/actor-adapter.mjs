import { buildActorFieldUpdate } from './actor-fields.mjs';

export const SUPPORTED_ACTOR_TYPES = new Set(['character', 'npc']);

function clone(value, fallback = null) {
  if (value == null) return fallback;
  return structuredClone(value);
}

function readSource(actor) {
  if (!actor || typeof actor.toObject !== 'function') return null;
  return actor.toObject();
}

function getPath(source, path) {
  return path.split('.').reduce(
    (value, key) => value == null ? undefined : value[key],
    source,
  );
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function number(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function writeChanged(update, source, path, value) {
  if (value == null || Object.is(getPath(source, path), value)) return;
  update[path] = value;
}

function readResources(resources = {}) {
  return {
    primary: clone(resources.primary, {}),
    secondary: clone(resources.secondary, {}),
    tertiary: clone(resources.tertiary, {}),
  };
}

function readCommonActorFields(source) {
  const system = source.system ?? {};
  const attributes = system.attributes ?? {};
  const traits = system.traits ?? {};
  return {
    img: source.img ?? '',
    prototypeToken: clone(source.prototypeToken, {}),
    abilities: clone(system.abilities, {}),
    hp: clone(attributes.hp, {}),
    ac: clone(attributes.ac, {}),
    movement: clone(attributes.movement, {}),
    senses: clone(attributes.senses, {}),
    traits: {
      di: clone(traits.di, {}),
      dr: clone(traits.dr, {}),
      dv: clone(traits.dv, {}),
      ci: clone(traits.ci, {}),
    },
    biography: String(system.details?.biography?.value ?? ''),
    source: clone(system.source, {}),
  };
}

function readCharacterFields(source) {
  const system = source.system ?? {};
  return {
    xp: clone(system.details?.xp, {}),
    inspiration: Boolean(system.attributes?.inspiration),
    death: clone(system.attributes?.death, {}),
    resources: readResources(system.resources),
  };
}

function readNpcFields(
  source,
  actor
) {
  const system = source.system ?? {};
  const resources = system.resources ?? {};
  return {
    creature: {
      size: String(system.traits?.size ?? ''),
      type: clone(system.details?.type, {}),
    },
    cr: system.details?.cr ?? null,
    xp: clone(
      actor?.system?.details?.xp ?? system.details?.xp,
      {}
    ),
    hpFormula: String(system.attributes?.hp?.formula ?? ''),
    spellLevel: Number(system.attributes?.spell?.level ?? 0),
    legendary: {
      actions: clone(resources.legact, {}),
      resistance: clone(resources.legres, {}),
    },
    lair: clone(resources.lair, {}),
  };
}

function writeNumericFormValue(update, source, form, formKey, path) {
  if (!hasOwn(form, formKey)) return;
  writeChanged(update, source, path, number(form[formKey]));
}

function writeIntegerFormValue(update, source, form, formKey, path) {
  if (!hasOwn(form, formKey)) return;
  writeChanged(update, source, path, integer(form[formKey]));
}

function writeTextFormValue(update, source, form, formKey, path) {
  if (!hasOwn(form, formKey)) return;
  writeChanged(update, source, path, text(form[formKey]));
}

function writeResourceUpdates(update, source, resources = {}) {
  for (const key of ['primary', 'secondary', 'tertiary']) {
    const resource = resources[key];
    if (!resource || typeof resource !== 'object') continue;
    for (const field of ['value', 'max']) {
      if (hasOwn(resource, field)) {
        writeChanged(
          update,
          source,
          `system.resources.${key}.${field}`,
          number(resource[field]),
        );
      }
    }
    if (hasOwn(resource, 'label')) {
      writeChanged(update, source, `system.resources.${key}.label`, text(resource.label));
    }
  }
}

function writeCommonActorUpdates(update, source, form) {
  writeTextFormValue(update, source, form, 'name', 'name');
  writeTextFormValue(update, source, form, 'img', 'img');
  if (text(form.tokenImg)) {
    writeTextFormValue(
      update,
      source,
      form,
      'tokenImg',
      'prototypeToken.texture.src',
    );
  }
  writeIntegerFormValue(update, source, form, 'hpValue', 'system.attributes.hp.value');
  writeIntegerFormValue(update, source, form, 'hpMax', 'system.attributes.hp.max');
  writeIntegerFormValue(update, source, form, 'hpTemp', 'system.attributes.hp.temp');
  writeNumericFormValue(update, source, form, 'acFlat', 'system.attributes.ac.flat');
  writeTextFormValue(update, source, form, 'biography', 'system.details.biography.value');

  const sourceForm = form.source;
  if (sourceForm && typeof sourceForm === 'object') {
    for (const key of ['book', 'page', 'custom']) {
      if (hasOwn(sourceForm, key)) {
        writeChanged(update, source, `system.source.${key}`, text(sourceForm[key]));
      }
    }
  }

  const abilities = form.abilities;
  if (abilities && typeof abilities === 'object') {
    for (const [ability, fields] of Object.entries(abilities)) {
      if (!fields || typeof fields !== 'object') continue;
      if (hasOwn(fields, 'value')) {
        writeIntegerFormValue(update, source, fields, 'value', `system.abilities.${ability}.value`);
      }
      if (hasOwn(fields, 'proficient')) {
        writeIntegerFormValue(update, source, fields, 'proficient', `system.abilities.${ability}.proficient`);
      }
    }
  }
}

function writeCharacterUpdates(update, source, form) {
  writeIntegerFormValue(update, source, form, 'xpValue', 'system.details.xp.value');
  if (hasOwn(form, 'inspiration')) {
    writeChanged(update, source, 'system.attributes.inspiration', Boolean(form.inspiration));
  }
  writeIntegerFormValue(update, source, form, 'deathSuccess', 'system.attributes.death.success');
  writeIntegerFormValue(update, source, form, 'deathFailure', 'system.attributes.death.failure');
  writeResourceUpdates(update, source, form.resources);
}

function writeNpcUpdates(update, source, form) {
  writeNumericFormValue(update, source, form, 'cr', 'system.details.cr');
  if (hasOwn(
    form,
    'xpValue'
  )) throw new Error('NPC 경험치는 도전 등급으로 자동 계산됩니다. 도전 등급을 수정하십시오.');
  writeTextFormValue(update, source, form, 'creatureSize', 'system.traits.size');
  writeTextFormValue(update, source, form, 'creatureType', 'system.details.type.value');
  writeTextFormValue(update, source, form, 'creatureSubtype', 'system.details.type.subtype');
  writeTextFormValue(update, source, form, 'creatureCustom', 'system.details.type.custom');
  writeIntegerFormValue(update, source, form, 'spellLevel', 'system.attributes.spell.level');
  writeTextFormValue(update, source, form, 'hpFormula', 'system.attributes.hp.formula');
  writeIntegerFormValue(update, source, form, 'legendaryActionsSpent', 'system.resources.legact.spent');
  writeIntegerFormValue(update, source, form, 'legendaryActionsMax', 'system.resources.legact.max');
  writeIntegerFormValue(update, source, form, 'legendaryResistanceSpent', 'system.resources.legres.spent');
  writeIntegerFormValue(update, source, form, 'legendaryResistanceMax', 'system.resources.legres.max');
  if (hasOwn(form, 'lairValue')) {
    writeChanged(update, source, 'system.resources.lair.value', Boolean(form.lairValue));
  }
  writeIntegerFormValue(update, source, form, 'lairInitiative', 'system.resources.lair.initiative');
}

function buildPrototypeTokenSource(form) {
  const prototypeToken = {};
  const name = text(form.name);
  if (name) prototypeToken.name = name;
  if (hasOwn(form, 'prototypeToken') && form.prototypeToken && typeof form.prototypeToken === 'object') {
    Object.assign(prototypeToken, clone(form.prototypeToken, {}));
  }
  return prototypeToken;
}

export function isSupportedActor(actor) {
  return SUPPORTED_ACTOR_TYPES.has(actor?.type);
}

export function readActorWorkbenchModel(actor) {
  if (!isSupportedActor(actor)) return null;
  const source = readSource(actor);
  if (!source) return null;
  return {
    id: actor.id,
    type: actor.type,
    name: actor.name ?? source.name ?? '',
    folderId: actor.folder?.id ?? null,
    common: readCommonActorFields(source),
    typeSpecific: actor.type === 'character'
      ? readCharacterFields(source)
      : readNpcFields(
        source,
        actor
      ),
  };
}

export function buildActorWorkbenchUpdate(actor, form = {}) {
  if (!isSupportedActor(actor)) return {};
  const source = readSource(actor);
  if (!source) return {};
  const update = {};
  writeCommonActorUpdates(update, source, form);
  if (actor.type === 'character') writeCharacterUpdates(update, source, form);
  if (actor.type === 'npc') writeNpcUpdates(update, source, form);
  Object.assign(
    update,
    buildActorFieldUpdate(
      actor,
      form.fields
    )
  );
  if (hasOwn(
    form,
    'name'
  ) && !text(form.name)) throw new Error('액터 이름을 입력하십시오.');
  for (const [key, value] of Object.entries(form)) {
    if (!['hpValue', 'hpMax', 'hpTemp', 'acFlat', 'xpValue', 'deathSuccess', 'deathFailure',
      'cr', 'spellLevel', 'legendaryActionsSpent', 'legendaryActionsMax',
      'legendaryResistanceSpent', 'legendaryResistanceMax', 'lairInitiative'].includes(key)) continue;
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0
      || key !== 'cr' && !Number.isInteger(Number(value))) {
      throw new Error(`${key}: 0 이상의 올바른 숫자를 입력하십시오.`);
    }
    if (['deathSuccess', 'deathFailure'].includes(key) && Number(value) > 3) {
      throw new Error('죽음 내성 횟수는 0~3이어야 합니다.');
    }
  }
  return update;
}

export function buildActorCreateSource(type, form = {}) {
  if (!SUPPORTED_ACTOR_TYPES.has(type)) {
    throw new Error('지원하지 않는 Actor 유형입니다.');
  }
  const name = text(form.name);
  if (!name) throw new Error('Actor 이름을 입력하십시오.');
  const result = {
    type,
    name,
    folder: text(form.folderId) || null,
    prototypeToken: buildPrototypeTokenSource(form),
  };
  const img = text(form.img);
  if (img) result.img = img;
  return result;
}
