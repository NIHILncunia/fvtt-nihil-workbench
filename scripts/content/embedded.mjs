import { appendAdvancementSource } from '../shared/advancement-source.mjs';
import {
  buildActivation,
  buildConsumption,
  buildDuration,
  buildEffectChange,
  buildRange,
  buildTarget,
  buildUses,
} from './builders.mjs';
import { Condition, SpecialStatus, Status } from './codes.mjs';
import { buildEffectDuration } from './effect-duration.mjs';
import {
  checkedResult,
  copy,
  assertFields,
  code,
  object,
  runtime,
  serial,
  text,
} from './internal.mjs';
import { requireDocument, validateContentSource } from './persistence.mjs';

async function effect(
  parent,
  input,
) {
  return serial(
    `embedded:${parent?.uuid}`,
    async () => {
      requireDocument(parent);
      const source = object(input);
      text(
        source.name,
        '효과 이름',
      );
      // v14: 변경값은 system.changes. 예전 최상위 changes도 받아 옮긴다.
      const changes = source.system?.changes ?? source.changes;
      delete source.changes;
      if (changes) source.system = { ...(source.system ?? {}), changes: changes.map(buildEffectChange) };
      if (source.duration) {
        const { duration, start } = buildEffectDuration(source.duration);
        source.duration = duration;
        if (start && source.start == null)
          source.start = { time: globalThis.game?.time?.worldTime ?? 0, ...start };
      }
      if (source.statuses)
        for (const status of source.statuses)
          code(
            status,
            { ...Condition, ...Status, ...SpecialStatus },
          );
      await validateContentSource(
        'ActiveEffect',
        source,
        { parent },
      );
      requireDocument(parent);
      const [created] = checkedResult(
        await parent.createEmbeddedDocuments(
          'ActiveEffect',
          [source],
        ),
        '효과 생성',
      );
      return checkedResult(
        created,
        '효과 생성',
      );
    },
  );
}

export async function createEffect(
  parent,
  source,
) {
  return effect(
    parent,
    source,
  );
}

export async function createPassiveEffect(
  parent,
  input,
) {
  const source = object(input);
  if (
    source.duration &&
    Object.values(source.duration).some(
      (value) => value != null && value !== '',
    )
  )
    throw new Error('상시 효과에 지속시간을 넣지 마십시오.');
  if (
    source.transfer != null &&
    source.transfer !== (parent.documentName === 'Item')
  )
    throw new Error('상시 효과의 전이 값과 부모 문서가 다릅니다.');
  return effect(
    parent,
    {
      ...source,
      transfer: parent.documentName === 'Item',
      duration: {},
    },
  );
}

export async function createTimedEffect(
  parent,
  input,
) {
  const source = object(input);
  if (!['seconds', 'rounds', 'turns', 'value'].some((key) => source.duration?.[key] > 0))
    throw new Error('효과의 지속시간을 지정하십시오.');
  if (source.transfer === true)
    throw new Error('지속시간 효과는 액티비티 적용용으로 생성합니다.');
  return effect(
    parent,
    { ...source, transfer: false },
  );
}

export async function createConditionEffect(
  parent,
  input,
) {
  const { status, ...source } = object(input);
  code(
    status,
    { ...Condition, ...Status, ...SpecialStatus },
  );
  const config = runtime();
  const definition =
    config.conditionTypes?.[status] ??
    config.statusEffects?.[status] ??
    (status === 'bloodied' ? config.bloodied : null);
  if (!definition)
    throw new Error('현재 시스템에서 상태 정의를 찾지 못했습니다.');
  return effect(
    parent,
    {
      name: globalThis.game.i18n?.localize?.(definition.name) ?? definition.name,
      img: definition.img,
      transfer: false,
      ...source,
      statuses: [...new Set([status, ...(source.statuses ?? [])])],
    },
  );
}

export async function createEnchantmentEffect(
  parent,
  input,
) {
  if (parent?.documentName !== 'Item')
    throw new Error('마법 부여 효과의 부모는 Item이어야 합니다.');
  const source = object(input);
  if (source.type && source.type !== 'enchantment')
    throw new Error('마법 부여 효과 타입이 다릅니다.');
  return effect(
    parent,
    { ...source, type: 'enchantment', transfer: false },
  );
}

async function activity(
  type,
  item,
  input,
) {
  return serial(
    `embedded:${item?.uuid}`,
    async () => {
      requireDocument(item);
      if (item.documentName !== 'Item' || !item.system.activities)
        throw new Error('액티비티를 지원하는 Item을 선택하십시오.');
      const config = runtime().activityTypes?.[type];
      if (
        !config?.documentClass ||
        config.configurable === false ||
        config.documentClass.availableForItem(item) === false
      )
        throw new Error('직접 생성할 수 없는 액티비티입니다.');
      const source = object(input);
      if (source.type != null && source.type !== type)
        throw new Error('액티비티 타입이 다릅니다.');
      for (const [key, builder] of Object.entries({
        activation: buildActivation,
        range: buildRange,
        target: buildTarget,
        duration: buildDuration,
        consumption: buildConsumption,
        uses: buildUses,
      }))
        if (source[key]) source[key] = builder(source[key]);
      const id = source._id ?? globalThis.foundry.utils.randomID();
      if (item.system.activities.has(id))
        throw new Error('이미 존재하는 액티비티 ID입니다.');
      source._id = id;
      const candidate = { ...source, type };
      const model = new config.documentClass(
        copy(candidate),
        { parent: item },
      );
      model.validate({ strict: true });
      assertFields(
        candidate,
        model.schema.fields,
      );
      await validateContentSource(
        'Item',
        {
          ...item.toObject(),
          system: {
            ...item.toObject().system,
            activities: {
              ...item.toObject().system.activities,
              [id]: model.toObject(),
            },
          },
        },
        { packId: item.pack, parent: item.parent },
      );
      requireDocument(item);
      await item.createActivity(
        type,
        source,
        { renderSheet: false },
      );
      return checkedResult(
        item.system.activities.get(id),
        '액티비티 생성',
      );
    },
  );
}

async function advancement(
  type,
  item,
  input,
) {
  return serial(
    `embedded:${item?.uuid}`,
    async () => {
      requireDocument(item);
      const config = runtime().advancementTypes?.[type];
      if (
        !config?.documentClass ||
        !config.validItemTypes?.has(item.type) ||
        !config.documentClass.availableForItem(item)
      )
        throw new Error(
          '이 아이템에서 지원하지 않거나 이미 존재하는 단일 Advancement입니다.',
        );
      const source = object(input);
      if (source.type != null && source.type !== type)
        throw new Error('Advancement 타입이 다릅니다.');
      const id = source._id ?? globalThis.foundry.utils.randomID();
      if (
        item.system.advancement?.some(
          (entry) => entry.id === id || entry._id === id,
        )
      )
        throw new Error('이미 존재하는 Advancement ID입니다.');
      source._id = id;
      const model = new config.documentClass(
        copy(source),
        { parent: item },
      );
      model.validate({ strict: true });
      assertFields(
        source,
        model.schema.fields,
      );
      const previous = item.toObject();
      await validateContentSource(
        'Item',
        {
          ...previous,
          system: {
            ...previous.system,
            advancement: appendAdvancementSource(
              previous.system.advancement,
              model.toObject(),
            ),
          },
        },
        { packId: item.pack, parent: item.parent },
      );
      requireDocument(item);
      await item.createAdvancement(
        type,
        source,
        { renderSheet: false },
      );
      return checkedResult(
        item.system.advancement.find((entry) => (entry.id ?? entry._id) === id),
        'Advancement 생성',
      );
    },
  );
}

export async function createAttackActivity(
  item,
  source = {},
) {
  return activity(
    'attack',
    item,
    source,
  );
}
export async function createCastActivity(
  item,
  source = {},
) {
  return activity(
    'cast',
    item,
    source,
  );
}
export async function createCheckActivity(
  item,
  source = {},
) {
  return activity(
    'check',
    item,
    source,
  );
}
export async function createDamageActivity(
  item,
  source = {},
) {
  return activity(
    'damage',
    item,
    source,
  );
}
export async function createEnchantActivity(
  item,
  source = {},
) {
  return activity(
    'enchant',
    item,
    source,
  );
}
export async function createForwardActivity(
  item,
  source = {},
) {
  return activity(
    'forward',
    item,
    source,
  );
}
export async function createHealActivity(
  item,
  source = {},
) {
  return activity(
    'heal',
    item,
    source,
  );
}
export async function createSaveActivity(
  item,
  source = {},
) {
  return activity(
    'save',
    item,
    source,
  );
}
export async function createSummonActivity(
  item,
  source = {},
) {
  return activity(
    'summon',
    item,
    source,
  );
}
export async function createTransformActivity(
  item,
  source = {},
) {
  return activity(
    'transform',
    item,
    source,
  );
}
export async function createUtilityActivity(
  item,
  source = {},
) {
  return activity(
    'utility',
    item,
    source,
  );
}

export async function createAbilityScoreImprovementAdvancement(
  item,
  source = {},
) {
  return advancement(
    'AbilityScoreImprovement',
    item,
    source,
  );
}
export async function createHitPointsAdvancement(
  item,
  source = {},
) {
  return advancement(
    'HitPoints',
    item,
    source,
  );
}
export async function createItemChoiceAdvancement(
  item,
  source = {},
) {
  return advancement(
    'ItemChoice',
    item,
    source,
  );
}
export async function createItemGrantAdvancement(
  item,
  source = {},
) {
  return advancement(
    'ItemGrant',
    item,
    source,
  );
}
export async function createScaleValueAdvancement(
  item,
  source = {},
) {
  return advancement(
    'ScaleValue',
    item,
    source,
  );
}
export async function createSizeAdvancement(
  item,
  source = {},
) {
  return advancement(
    'Size',
    item,
    source,
  );
}
export async function createSubclassAdvancement(
  item,
  source = {},
) {
  return advancement(
    'Subclass',
    item,
    source,
  );
}
export async function createTraitAdvancement(
  item,
  source = {},
) {
  return advancement(
    'Trait',
    item,
    source,
  );
}
