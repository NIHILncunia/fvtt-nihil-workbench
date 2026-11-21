import {
  Ability,
  Activation,
  Area,
  Condition,
  CreatureType,
  DamageType,
  EffectMode,
  HealingType,
  Movement,
  Recovery,
  Sense,
  Size,
  Skill,
  Target,
} from './codes.mjs';
import { code, list, number, object, runtime, text } from './internal.mjs';
import { isValidChangeType, legacyModeType } from '../shared/effect-change-types.mjs';

export function buildDescription(input) {
  if (typeof input === 'string') return { value: input };
  const data = object(input);
  for (const value of Object.values(data))
    if (typeof value !== 'string')
      throw new TypeError('설명은 HTML 문자열로 전달하십시오.');
  return data;
}

export function buildDamagePart(input = {}) {
  const data = object(input);
  const { formula, ...part } = data;
  if (formula != null) {
    if (part.custom || part.number != null || part.denomination != null)
      throw new Error('공식과 주사위 개수를 함께 지정하지 마십시오.');
    part.custom = { enabled: true, formula: text(
      formula,
      '주사위식',
    ) };
  }
  for (const key of ['number', 'denomination'])
    if (part[key] != null) number(
      part[key],
      { integer: true },
    );
  if (part.types != null)
    part.types = list(
      part.types,
      { ...DamageType, ...HealingType },
    );
  if (part.custom?.enabled) text(
    part.custom.formula,
    '주사위식',
  );
  if (part.scaling?.number != null)
    number(
      part.scaling.number,
      { integer: true },
    );
  return part;
}

export function buildEffectChange(input) {
  const data = object(input);
  data.key = text(
    data.key,
    '효과 대상 경로',
  );
  if (
    data.key
      .split('.')
      .some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
  )
    throw new Error('허용하지 않는 효과 경로입니다.');
  // v14 type(문자열). 예전 숫자 mode는 같은 의미의 type으로 바꾼다.
  const { mode, ...rest } = data;
  const type = rest.type ?? (typeof mode === 'string' ? mode : legacyModeType(mode));
  if (typeof mode === 'number') code(mode, { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 });
  if (!isValidChangeType(type))
    throw new TypeError(`지원하지 않는 효과 적용 방식입니다: ${type}`);
  if (Object.values(EffectMode).includes(type) === false && !type.includes('.') && type !== 'custom')
    throw new TypeError(`지원하지 않는 효과 적용 방식입니다: ${type}`);
  rest.type = type;
  if (!['string', 'number', 'boolean'].includes(typeof rest.value))
    throw new TypeError('효과 값을 전달하십시오.');
  rest.value = String(rest.value);
  if (rest.priority != null)
    number(
      rest.priority,
      { min: -Infinity, integer: true },
    );
  return rest;
}

export function buildActivation(input = {}) {
  const data = object(input);
  if (data.type != null) code(
    data.type,
    Activation,
    { blank: true },
  );
  if (data.value != null) number(
    data.value,
    { integer: true },
  );
  return data;
}

export function buildRange(input = {}) {
  const data = object(input);
  if (data.units != null) {
    const config = runtime();
    if (
      !(data.units in (config.distanceUnits ?? {})) &&
      !(data.units in (config.movementUnits ?? {}))
    )
      throw new Error('지원하지 않는 사거리 단위입니다.');
  }
  if (typeof data.value === 'number') number(data.value);
  return data;
}

export function buildTarget(input = {}) {
  const data = object(input);
  if (data.affects?.type != null)
    code(
      data.affects.type,
      Target,
      { blank: true },
    );
  if (data.template?.type != null)
    code(
      data.template.type,
      Area,
      { blank: true },
    );
  if (
    data.template?.units != null &&
    !(data.template.units in (runtime().movementUnits ?? {}))
  )
    throw new Error('지원하지 않는 범위 단위입니다.');
  for (const value of [
    data.affects?.count,
    data.template?.size,
    data.template?.width,
    data.template?.height,
  ])
    if (typeof value === 'number') number(value);
  return data;
}

export function buildDuration(input = {}) {
  const data = object(input);
  const effectKeys = [
    'seconds',
    'rounds',
    'turns',
    'startTime',
    'startRound',
    'startTurn',
  ];
  for (const key of effectKeys)
    if (data[key] != null)
      number(
        data[key],
        { integer: key !== 'seconds' && key !== 'startTime' },
      );
  if (data.units != null) {
    if (effectKeys.some((key) => data[key] != null))
      throw new Error('액티비티 지속시간과 효과 지속시간을 분리하십시오.');
    const config = runtime();
    if (
      !(data.units in (config.timePeriods ?? {})) &&
      !(data.units in (config.timeUnits ?? {}))
    )
      throw new Error('지원하지 않는 지속시간 단위입니다.');
  }
  return data;
}

export function buildConsumption(input = {}) {
  const data = object(input);
  if (data.targets != null) {
    if (!Array.isArray(data.targets))
      throw new TypeError('소모 대상을 배열로 전달하십시오.');
    const types = runtime().activityConsumptionTypes ?? {};
    for (const target of data.targets)
      if (!(target.type in types))
        throw new Error(`지원하지 않는 소모 유형입니다: ${target.type}`);
  }
  return data;
}

export function buildUses(input = {}) {
  const data = object(input);
  if (data.spent != null) number(
    data.spent,
    { integer: true },
  );
  if (typeof data.max === 'number') {
    number(
      data.max,
      { integer: true },
    );
    data.max = String(data.max);
  }
  if (data.recovery != null) {
    if (!Array.isArray(data.recovery))
      throw new TypeError('회복 규칙을 배열로 전달하십시오.');
    for (const recovery of data.recovery) {
      if (recovery.period !== 'recharge') code(
        recovery.period,
        Recovery,
      );
      if (!['recoverAll', 'loseAll', 'formula'].includes(recovery.type))
        throw new Error('지원하지 않는 회복 방식입니다.');
      if (recovery.type === 'formula' || recovery.period === 'recharge')
        text(
          recovery.formula,
          '회복 주사위식',
        );
    }
  }
  return data;
}

export function buildAbilityScores(input = {}) {
  const data = object(input);
  for (const [key, entry] of Object.entries(data)) {
    code(
      key,
      Ability,
    );
    number(
      entry.value,
      { integer: true },
    );
    if (entry.proficient != null && ![0, 0.5, 1, 2].includes(entry.proficient))
      throw new Error('지원하지 않는 내성 숙련 배율입니다.');
  }
  return data;
}

export function buildSkills(input = {}) {
  const data = object(input);
  for (const [key, entry] of Object.entries(data)) {
    code(
      key,
      Skill,
    );
    if (entry.ability != null) code(
      entry.ability,
      Ability,
    );
    if (entry.value != null && ![0, 0.5, 1, 2].includes(entry.value))
      throw new Error('지원하지 않는 기술 숙련 배율입니다.');
  }
  return data;
}

export function buildHitPoints(input = {}) {
  const data = object(input);
  for (const key of ['value', 'max', 'temp', 'dt'])
    if (data[key] != null) number(
      data[key],
      { integer: true },
    );
  if (data.tempmax != null)
    number(
      data.tempmax,
      { min: -Infinity, integer: true },
    );
  if (
    data.value != null &&
    data.max != null &&
    data.value > data.max + Math.max(
      0,
      data.tempmax ?? 0,
    )
  )
    throw new Error('현재 HP가 최대 HP를 넘습니다.');
  if (data.formula != null && typeof data.formula !== 'string')
    throw new TypeError('HP 주사위식은 문자열로 전달하십시오.');
  return data;
}

// dnd5e 6.x: AC 원본은 calcs(계산 방식 목록)·formulas(공식 목록)·override(고정값)·flat이다.
// 예전 calc·formula도 받아 dnd5e의 이관 규칙대로 바꾼다.
export function buildArmorClass(input = {}) {
  const { calc, formula, ...data } = object(input);
  const armorClasses = runtime().armorClasses ?? {};
  if (data.flat != null) number(
    data.flat,
    { integer: true },
  );
  if (data.override != null) number(
    data.override,
    { integer: true },
  );
  if (calc != null) {
    if (calc === 'custom') {
      if (!formula) throw new Error('사용자 AC 공식을 전달하십시오.');
      data.formulas ??= [{ formula: String(formula) }];
    } else if (calc === 'flat') {
      if (data.flat == null) throw new Error('고정 AC 값을 전달하십시오.');
      data.override ??= data.flat;
    } else if (calc === 'natural') data.calcs ??= ['natural'];
    else if (calc !== 'default') {
      if (!(calc in armorClasses)) throw new Error('지원하지 않는 AC 계산 방식입니다.');
      data.calcs ??= ['unarmored', 'armored', calc];
    }
  } else if (formula != null) data.formulas ??= [{ formula: String(formula) }];
  if (data.calcs != null) {
    if (!Array.isArray(data.calcs)) throw new TypeError('AC 계산 방식을 배열로 전달하십시오.');
    for (const id of data.calcs)
      if (!(id in armorClasses)) throw new Error('지원하지 않는 AC 계산 방식입니다.');
  }
  if (data.formulas != null) {
    if (!Array.isArray(data.formulas)) throw new TypeError('AC 공식을 배열로 전달하십시오.');
    for (const entry of data.formulas)
      if (!entry || typeof entry.formula !== 'string' || !entry.formula.trim())
        throw new TypeError('AC 공식 항목에 formula 문자열을 넣으십시오.');
  }
  return data;
}

export function buildMovement(input = {}) {
  const data = object(input);
  for (const key of Object.values(Movement))
    if (typeof data[key] === 'number') number(data[key]);
  if (data.units != null && !(data.units in (runtime().movementUnits ?? {})))
    throw new Error('지원하지 않는 이동 단위입니다.');
  return data;
}

// dnd5e 5.3+: 감각 거리는 ranges.<감각>에 둔다. 예전 최상위 감각 키도 받아 옮긴다.
export function buildSenses(input = {}) {
  const data = object(input);
  const ranges = { ...(data.ranges ?? {}) };
  for (const key of Object.values(Sense)) {
    if (!Object.hasOwn(data, key)) continue;
    if (Object.hasOwn(ranges, key)) throw new Error(`감각 ${key}를 ranges와 예전 위치에 함께 넣지 마십시오.`);
    ranges[key] = data[key];
    delete data[key];
  }
  for (const [key, value] of Object.entries(ranges))
    if (value != null) number(
      value,
      { integer: true },
    );
  if (Object.keys(ranges).length || data.ranges) data.ranges = ranges;
  if (data.units != null && !(data.units in (runtime().movementUnits ?? {})))
    throw new Error('지원하지 않는 감각 단위입니다.');
  return data;
}

export function buildCreatureType(input = {}) {
  const data = object(input);
  if (data.value != null) code(
    data.value,
    CreatureType,
    { blank: true },
  );
  if (data.swarm != null) code(
    data.swarm,
    Size,
    { blank: true },
  );
  return data;
}

export function buildDamageTraits(input = {}) {
  const data = object(input);
  for (const [key, entry] of Object.entries(data)) {
    if (!['di', 'dr', 'dv'].includes(key))
      throw new Error('피해 특성은 di·dr·dv로 전달하십시오.');
    if (entry.value != null) entry.value = list(
      entry.value,
      DamageType,
    );
  }
  return data;
}

export function buildConditionImmunities(input = {}) {
  const data = object(input);
  if (data.value != null) data.value = list(
    data.value,
    Condition,
  );
  return data;
}

export function buildNpcResources(input = {}) {
  const data = object(input);
  for (const key of ['legact', 'legres']) {
    const entry = data[key];
    if (!entry) continue;
    for (const field of ['value', 'max'])
      if (entry[field] != null) number(
        entry[field],
        { integer: true },
      );
    if (entry.value != null && entry.max != null && entry.value > entry.max)
      throw new Error('NPC 자원의 현재 값이 최대 값을 넘습니다.');
  }
  if (data.lair?.initiative != null)
    number(
      data.lair.initiative,
      { integer: true },
    );
  return data;
}

export function buildPrototypeToken(input = {}) {
  const data = object(input);
  for (const key of ['width', 'height'])
    if (data[key] != null) {
      number(data[key]);
      if (!data[key]) throw new Error('토큰 크기는 0보다 커야 합니다.');
    }
  if (data.texture?.src != null) text(
    data.texture.src,
    '토큰 이미지',
  );
  return data;
}
