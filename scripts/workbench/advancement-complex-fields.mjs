import { complexKind, schemaChildren } from './type-complex-fields.mjs';
import { addDeletion } from '../shared/deletion.mjs';

function syntheticField(
  name,
  properties = {},
) {
  return { constructor: { name }, options: {}, ...properties };
}

export function advancementFallbackSchema(type) {
  if (type === 'HitPoints') return syntheticField(
    'MappingField',
    { model: syntheticField('StringField', { workbenchScalar: 'hitPoints', workbenchHelp: 'max: 최대치 · avg: 평균치 · 직접 입력: 양의 정수', options: { initial: 'avg' } }), workbenchDynamic: true, workbenchLevel: 1 },
  );
  if (type === 'ItemGrant') return syntheticField(
    'SchemaField',
    { fields: { added: syntheticField('MappingField', { model: syntheticField('StringField') }) } },
  );
  return null;
}

function traitOptions(allowWildcard) {
  const config = globalThis.CONFIG?.DND5E ?? {};
  const result = {};
  for (const [prefix, trait] of Object.entries(config.traits ?? {})) {
    if (prefix === 'dm') continue;
    const entries = config[trait.configKey ?? prefix] ?? {};
    const append = (
      entries,
      prefix,
    ) => {
      for (const [key, entry] of Object.entries(entries)) {
        const label = entry?.label ?? entry?.name ?? entry;
        const reference = `${prefix}:${key}`;
        if (entry?.selectable !== false) result[reference] = label;
        if (entry?.children) {
          if (allowWildcard) result[`${reference}:*`] = `${typeof label === 'string' ? label : key} · 선택`;
          append(
            entry.children,
            reference,
          );
        }
      }
    };
    append(
      entries,
      prefix,
    );
    if (trait.labels?.all) result[`${prefix}:ALL`] = trait.labels.all;
    if (allowWildcard) result[`${prefix}:*`] = `${prefix} · 선택`;
  }
  return result;
}

// Decorate copies: never mutate the system's shared schema fields.
export function advancementEditorSchema(
  field,
  path,
  advancement,
  scaleType,
) {
  const config = globalThis.CONFIG?.DND5E ?? {};
  const type = advancement.type ?? advancement.constructor?.typeName;
  const copy = { ...field, constructor: field.constructor, options: { ...field.options } };
  const kind = complexKind(field);
  if (kind === 'list') copy.element = advancementEditorSchema(
    field.element,
    path,
    advancement,
    scaleType,
  );
  if (kind === 'mapping') {
    copy.workbenchDynamic = true;
    copy.model = advancementEditorSchema(
      field.model,
      `${path}.*`,
      advancement,
      scaleType,
    );
    if (['configuration.fixed', 'value.assignments'].includes(path) && type === 'AbilityScoreImprovement')
      copy.workbenchKeys = config.abilities;
    if ((type === 'ScaleValue' && path === 'configuration.scale') || (type === 'ItemChoice' && ['configuration.choices', 'value.added'].includes(path)))
      copy.workbenchLevel = 0;
    if (type === 'ScaleValue' && path === 'configuration.scale') {
      const model = advancement.constructor?.TYPES?.[scaleType];
      const fields = model?.schema?.fields ?? model?.defineSchema?.();
      if (fields) copy.model = advancementEditorSchema(
        syntheticField('SchemaField', { fields }),
        `${path}.*`,
        advancement,
        scaleType,
      );
    }
  }
  if (kind === 'object') {
    copy.fields = Object.fromEntries(Object.entries(schemaChildren(field)).map(
      ([key, child]) => [key, advancementEditorSchema(
        child,
        `${path}.${key}`,
        advancement,
        scaleType,
      )],
    ));
    copy.workbenchNullable = field.options?.nullable === true;
  }
  if (['uuid', 'recommendation'].includes(path.split('.').at(-1)) || path === 'value.feat.*' || /value\.added\..*\*/.test(path)) {
    copy.workbenchReference = true;
    copy.choices = Object.fromEntries(Array.from(globalThis.game?.items ?? []).filter(
      (item) => type !== 'Subclass' || item.type === 'subclass',
    ).map((item) => [item.uuid, item.name]));
  }
  if (type === 'AbilityScoreImprovement' && path === 'configuration.locked') copy.choices = config.abilities;
  if (type === 'Size' && ['configuration.sizes', 'value.size'].includes(path)) copy.choices = config.actorSizes;
  if (type === 'Trait' && ['configuration.grants', 'configuration.choices.pool', 'value.chosen'].includes(path)) {
    copy.choices = traitOptions(path === 'configuration.choices.pool');
    copy.workbenchReference = true;
  }
  if (type === 'Trait' && path === 'configuration.mode') copy.choices = {
    ...config.traitModes,
    default: '숙련', expertise: '전문가', forcedExpertise: '전문가 강제', upgrade: '숙련 단계 향상', mastery: '무기 숙련 특성',
  };
  if (type === 'ItemChoice' && ['configuration.type', 'configuration.restriction.type'].includes(path))
    copy.choices = Object.fromEntries(Array.from(advancement.constructor?.VALID_TYPES ?? ['feat', 'spell', 'consumable', 'container', 'equipment', 'loot', 'tool', 'weapon']).map(
      (key) => [key, globalThis.CONFIG?.Item?.typeLabels?.[key] ?? key],
    ));
  if (type === 'ScaleValue' && path === 'configuration.type')
    copy.choices = { string: '문자', number: '수치', cr: '도전 지수', dice: '주사위', distance: '거리' };
  if (type === 'ScaleValue' && path.endsWith('.faces'))
    copy.choices = advancement.constructor?.TYPES?.dice?.FACES;
  if (path === 'value.type' && type === 'AbilityScoreImprovement') copy.choices = { asi: '능력치 향상', feat: '피트' };
  if (path === 'classRestriction') copy.choices = { primary: '주 클래스', secondary: '멀티클래스' };
  if (path.endsWith('.ability')) copy.choices = config.abilities;
  if (path.endsWith('.method')) copy.choices = config.spellcasting;
  if (path.endsWith('.per')) copy.choices = config.limitedUsePeriods;
  if (path.endsWith('.units')) copy.choices = config.distanceUnits;
  if ((type === 'ScaleValue' && path === 'configuration.type') || (type === 'Trait' && path === 'configuration.mode') || (type === 'AbilityScoreImprovement' && path === 'value.type'))
    copy.options.blank = false;
  return copy;
}

export function advancementDeletionPaths(
  original,
  next,
  path,
) {
  const update = {};
  if (!original || typeof original !== 'object' || Array.isArray(original) || !next || typeof next !== 'object' || Array.isArray(next)) return update;
  for (const key of Object.keys(original)) {
    if (!Object.hasOwn(next, key)) addDeletion(update, `${path}.${key}`);
    else Object.assign(
      update,
      advancementDeletionPaths(
        original[key],
        next[key],
        `${path}.${key}`,
      ),
    );
  }
  return update;
}
