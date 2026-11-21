import { complexKind, schemaChildren } from './type-complex-fields.mjs';
import { MIDI_AUTOMATION_CHOICES } from './module-automation-fields.mjs';

function optionsObject(options = []) {
  return Object.fromEntries(options.map((option) => [option.value, option.label]));
}

// Read candidates from the same consumption configuration used by the native sheet.
function consumptionChoices(
  activity,
  row,
  scaling = false,
) {
  const config = globalThis.CONFIG?.DND5E?.activityConsumptionTypes?.[row?.type];
  if (scaling) return {
    amount: '소모 수량 증가',
    ...optionsObject(config?.scalingModes),
  };
  if (!config?.validTargets || (config.targetRequiresEmbedded && !activity.item?.isEmbedded)) return {};
  try {
    return optionsObject(config.validTargets.call({
      activity,
      item: activity.item,
      actor: activity.actor,
      type: row?.type,
    }));
  } catch {
    return {};
  }
}

export function activityEditorSchema(
  field,
  path,
  activity,
) {
  const config = globalThis.CONFIG?.DND5E ?? {};
  const copy = { ...field, constructor: field.constructor, options: { ...field.options } };
  if (MIDI_AUTOMATION_CHOICES[path]) {
    copy.choices = MIDI_AUTOMATION_CHOICES[path];
    copy.options.blank = false;
  }
  // Native subclasses such as ConsumptionTargetsField still carry an ArrayField element.
  if (field.element && field.constructor?.name === 'ConsumptionTargetsField')
    copy.constructor = { name: 'ArrayField' };
  const kind = complexKind(copy);
  if (kind === 'list') copy.element = activityEditorSchema(
    field.element,
    path,
    activity,
  );
  if (kind === 'object') {
    copy.fields = Object.fromEntries(Object.entries(schemaChildren(field)).map(
      ([key, child]) => [key, activityEditorSchema(
        child,
        `${path}.${key}`,
        activity,
      )],
    ));
    copy.workbenchNullable = field.options?.nullable === true;
  }
  if (kind === 'mapping') {
    copy.workbenchDynamic = true;
    copy.model = activityEditorSchema(
      field.model,
      `${path}.*`,
      activity,
    );
  }
  if (path === 'consumption.targets.type') {
    copy.choices = config.activityConsumptionTypes;
    copy.options.blank = false;
    copy.workbenchRefresh = true;
  }
  if (['consumption.targets.target', 'consumption.targets.scaling.mode'].includes(path)) {
    copy.workbenchChoices = (
      root,
      address,
    ) => consumptionChoices(
      activity,
      root?.[address[0]],
      path.endsWith('.mode'),
    );
    if (path.endsWith('.target')) {
      copy.workbenchReference = true;
      copy.workbenchHelp = '소유 아이템에서는 해당 액터의 소모 대상을 선택할 수 있습니다. 빈 값은 현재 액티비티·아이템을 뜻하며 대상 유형에 따라 직접 참조를 입력할 수 있습니다.';
    }
  }
  if (path === 'effects._id') {
    copy.constructor = { name: 'StringField' };
    copy.options.initial = '';
    copy.workbenchEditableId = true;
    copy.workbenchReference = true;
    copy.choices = Object.fromEntries(Array.from(activity.item?.effects ?? []).map((effect) => [effect.id, effect.name]));
  }
  if (path === 'profiles.uuid') {
    copy.workbenchReference = true;
    copy.choices = Object.fromEntries(Array.from(globalThis.game?.actors ?? []).map((actor) => [actor.uuid, actor.name]));
    copy.workbenchHelp = '월드 액터를 선택하거나 컴펜디움 액터 UUID를 입력합니다.';
  }
  if (path === 'spell.uuid' || path === 'effects.riders.item') {
    copy.workbenchReference = true;
    copy.choices = Object.fromEntries(Array.from(globalThis.game?.items ?? []).filter(
      (item) => path !== 'spell.uuid' || item.type === 'spell',
    ).map((item) => [item.uuid, item.name]));
  }
  if (['activity.id', 'effects.riders.activity', 'effects.riders.effect'].includes(path)) {
    const entries = path.endsWith('.effect') ? activity.item?.effects : activity.item?.system?.activities;
    copy.constructor = { name: 'StringField' };
    copy.options.initial = '';
    copy.workbenchReference = true;
    copy.choices = Object.fromEntries(Array.from(entries ?? []).filter(
      (entry) => path !== 'activity.id' || entry.id !== activity.id,
    ).map((entry) => [entry.id, entry.name]));
  }
  if (path === 'spell.properties') copy.choices = config.spellProperties;
  if (path === 'restrictions.properties') copy.choices = config.itemProperties;
  if (['creatureSizes', 'profiles.sizes'].includes(path)) copy.choices = config.actorSizes;
  if (['creatureTypes', 'profiles.types'].includes(path)) copy.choices = config.creatureTypes;
  if (path === 'profiles.movement') copy.choices = config.movementTypes;
  if (['summon.mode', 'transform.mode'].includes(path)) {
    copy.choices = { '': '액터 직접 지정', cr: '도전 지수 조건' };
    copy.options.blank = false;
  }
  if (['transform.preset', 'settings.preset'].includes(path)) copy.choices = config.transformation?.presets;
  if (/^settings\.(effects|keep|merge|other)$/.test(path)) copy.choices = config.transformation?.[path.split('.')[1]];
  if (path.endsWith('.spellLists')) copy.choices = optionsObject(
    (globalThis.dnd5e ?? globalThis.game?.dnd5e)?.registry?.spellLists?.options,
  );
  if (path.endsWith('.period')) copy.choices = config.limitedUsePeriods;
  if (path.endsWith('.recovery.type')) copy.choices = config.usesRecoveryTypes;
  return copy;
}

export function validateActivityReferences(
  fields,
  activity,
) {
  for (const field of fields) {
    if (!field.isComplex || field.value === field.renderedValue) continue;
    const value = JSON.parse(field.value);
    if (field.path === 'effects') {
      const originalIds = new Set((field.original ?? []).map((entry) => entry._id));
      const knownIds = new Set(Array.from(activity.item?.effects ?? []).map((effect) => effect.id));
      const seen = new Set();
      for (const entry of value) {
        if (!entry._id || seen.has(entry._id)) throw new Error('액티비티 효과의 참조는 비어 있거나 중복될 수 없습니다.');
        if (!originalIds.has(entry._id) && !knownIds.has(entry._id)) throw new Error('이 아이템에 있는 효과를 선택하십시오.');
        seen.add(entry._id);
      }
    }
    if (field.path === 'profiles') {
      const ids = value.map((entry) => entry._id);
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('후보의 식별자는 비어 있거나 중복될 수 없습니다.');
    }
    for (const entry of Array.isArray(value) ? value : []) {
      const { min, max } = entry.level ?? {};
      if (min != null && max != null && min > max) throw new Error('최소 레벨은 최대 레벨보다 클 수 없습니다.');
    }
  }
}
