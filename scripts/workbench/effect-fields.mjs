import { effectChangesPath, usesCoreEffectIcon, usesStructuredEffectDuration } from '../shared/compat.mjs';
import { pathValue } from './document-fields.mjs';
import {
  isValidStoredEffectChange,
} from '../shared/effect-change-types.mjs';
import { addDeletion } from '../shared/deletion.mjs';

const SHOW_ICON_CHOICES = Object.freeze({
  2: '항상 표시',
  1: '지속시간이 있을 때만',
  0: '표시 안 함',
});

// 예전 DAE showIcon 플래그가 켜진 효과를 저장할 때 코어 showIcon으로 옮기고 플래그를 지운다.
export function migrateLegacyShowIcon(patch, source) {
  if (!usesCoreEffectIcon() || !source?.flags?.dae?.showIcon) return patch;
  return addDeletion({ showIcon: 2, ...patch }, 'flags.dae.showIcon');
}

const DURATION_UNITS = Object.freeze({
  seconds: '초',
  minutes: '분',
  hours: '시간',
  days: '일',
  months: '달',
  years: '년',
  rounds: '라운드',
  turns: '턴',
});

const EXPIRY_EVENTS = Object.freeze({
  '': '만료 시점 없음',
  combatStart: '전투 시작',
  roundStart: '라운드 시작',
  turnStart: '턴 시작',
  combatEnd: '전투 종료',
  roundEnd: '라운드 종료',
  turnEnd: '턴 종료',
});

function expiryChoices() {
  const choices = { ...EXPIRY_EVENTS };
  for (const [key, label] of Object.entries(globalThis.CONFIG?.ActiveEffect?.expiryEvents ?? {})) {
    if (Object.hasOwn(choices, key)) continue;
    const text = typeof label === 'string' ? label : label?.label ?? key;
    choices[key] = globalThis.game?.i18n?.localize?.(text) ?? text;
  }
  return choices;
}

function choiceOptions(choices, current) {
  const entries = { ...choices };
  if (current && !Object.hasOwn(entries, current)) entries[current] = `기존 설정 (${current})`;
  return Object.entries(entries).map(([value, label]) => ({ value, label, selected: value === (current ?? '') }));
}

// v14 origin은 DocumentUUIDField다. 빈 값은 null, 그 밖에는 문서 UUID 형식이어야 한다.
export function isEffectOriginValue(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string') return false;
  const parse = globalThis.foundry?.utils?.parseUuid;
  if (parse) {
    try {
      const parsed = parse(value, value.startsWith('.') ? { relative: {} } : {});
      return Boolean(parsed?.id || parsed?.documentId);
    } catch {
      return false;
    }
  }
  return /^(?:Compendium\.|\.|[A-Z][A-Za-z]+\.)[^\s]+$/.test(value);
}

const GROUPS = [
  ['basic', '효과 기본 정보'],
  ['duration', '지속시간'],
  ['conditions', 'DAE 자동화'],
];

export function effectFields(
  source,
  { dae = false, combats = [], itemEffect = false } = {},
) {
  const fields = [];
  const add = (
    path,
    title,
    group,
    settings = {},
  ) => {
    const original = pathValue(
      source,
      path,
    );
    const initial = settings.json
      ? JSON.stringify(original ?? [])
      : settings.boolean
        ? Boolean(original)
        : (typeof original === 'string' ? original.replace(/\r\n?/g, '\n') : original ?? '');
    fields.push({
      path,
      title,
      group,
      original,
      initial,
      value: initial,
      options: [],
      ...settings,
    });
  };
  add(
    'name',
    '이름',
    'basic',
  );
  add(
    'img',
    '이미지 경로',
    'basic',
    {
      image: true,
    },
  );
  add(
    'description',
    '설명',
    'basic',
    {
      multiline: true,
      wide: true,
    },
  );
  add(
    'tint',
    '아이콘 색조',
    'basic',
    {
      color: true,
    },
  );
  add(
    'disabled',
    '비활성',
    'basic',
    {
      boolean: true,
    },
  );
  add(
    'transfer',
    '아이템에서 액터로 전이',
    'basic',
    {
      boolean: true,
    },
  );
  add(
    'origin',
    '원본 UUID',
    'basic',
    {
      nullable: true,
      wide: true,
    },
  );
  if (usesCoreEffectIcon()) {
    // v14 코어 ActiveEffect.showIcon. DAE 14는 flags.dae.showIcon을 폐기하고 이 값(2: 항상)으로 옮긴다.
    const showIcon = source.flags?.dae?.showIcon ? 2 : (source.showIcon ?? 1);
    add(
      'showIcon',
      '토큰에 효과 아이콘 표시',
      'basic',
      {
        select: true,
        number: true,
        integer: true,
        options: Object.entries(SHOW_ICON_CHOICES).map(([value, label]) => ({ value, label, selected: Number(value) === showIcon })),
      },
    );
    if (source.flags?.dae?.showIcon) {
      const field = fields.at(-1);
      // 예전 DAE 플래그가 켜진 효과는 「항상 표시」를 보여 주고, 저장하면 코어 값으로 옮긴다.
      field.initial = field.value = '2';
      field.legacyDaeShowIcon = true;
    }
  } else if (dae || source.flags?.dae?.showIcon !== undefined) {
    add(
      'flags.dae.showIcon',
      '토큰에 효과 아이콘 항상 표시 (DAE)',
      'basic',
      { boolean: true },
    );
  }
  const structuredDuration = usesStructuredEffectDuration();
  if (structuredDuration) {
    // v14: duration = { value, units, expiry }, 시작 시점은 최상위 start = { time, round, turn, combat }.
    add(
      'duration.value',
      '지속 값',
      'duration',
      {
        number: true,
        nullable: true,
        integer: true,
        min: 0,
      },
    );
    const units = source.duration?.units ?? 'seconds';
    add(
      'duration.units',
      '지속 단위',
      'duration',
      {
        select: true,
        options: choiceOptions(
          DURATION_UNITS,
          units,
        ),
      },
    );
    const expiry = source.duration?.expiry ?? '';
    add(
      'duration.expiry',
      '만료 시점',
      'duration',
      {
        select: true,
        nullable: true,
        options: choiceOptions(
          expiryChoices(),
          expiry,
        ),
      },
    );
  } else {
    for (const [key, title] of [['seconds', '지속 초'], ['rounds', '지속 라운드'], ['turns', '지속 턴']]) {
      add(
        `duration.${key}`,
        title,
        'duration',
        { number: true, nullable: true, integer: true, min: 0 },
      );
    }
  }
  for (const [key, title] of [
    ['time', '시작 월드 시간(초)'],
    ['round', '시작 라운드'],
    ['turn', '시작 턴'],
  ]) {
    add(
      structuredDuration ? `start.${key}` : `duration.start${key[0].toUpperCase()}${key.slice(1)}`,
      title,
      'duration',
      {
        number: true,
        nullable: true,
        integer: true,
        ...(key === 'time' ? {} : { min: 0 }),
      },
    );
  }
  const combatId = (structuredDuration ? source.start?.combat : source.duration?.combat) ?? '';
  const combatOptions = [
    {
      value: '',
      label: '전투 연결 없음',
    },
    ...combats.map((combat) => ({
      value: combat.id,
      label: combat.name ?? combat.id,
    })),
  ];
  if (combatId && !combatOptions.some((entry) => entry.value === combatId))
    combatOptions.push({
      value: combatId,
      label: `기존 전투 · ${combatId}`,
    });
  add(
    structuredDuration ? 'start.combat' : 'duration.combat',
    '연결 전투',
    'duration',
    {
      select: true,
      nullable: true,
      options: combatOptions.map((entry) => ({
        ...entry,
        selected: entry.value === combatId,
      })),
    },
  );
  add(
    effectChangesPath(),
    '변경값',
    'changes',
    {
      json: true,
      effectChanges: true,
    },
  );
  add(
    'statuses',
    '부여 상태',
    'statuses',
    {
      json: true,
    },
  );
  if (dae || source.flags?.dae) {
    add('flags.dae.durationExpression', '지속시간 수식 (초)', 'conditions');
    for (const [key, title] of Object.entries({ disableIncapacitated: '행동불능 상태에서 비활성' })) {
      add(`flags.dae.${key}`, title, 'conditions', { boolean: true });
    }
    if (itemEffect || source.flags?.dae?.stackable !== undefined) {
      const choices = { '': '모듈 기본값', noneName: '같은 이름·원전 중첩 방지', noneNameOnly: '같은 이름 중첩 방지', none: '같은 원전 중첩 방지', multi: '여러 효과로 중첩', count: '중첩 횟수 증가', countDeleteDecrement: '추가·삭제 시 중첩 횟수 조정' };
      const current = source.flags?.dae?.stackable ?? '';
      if (!Object.hasOwn(choices, current)) choices[current] = `기존 설정 (${current})`;
      add('flags.dae.stackable', '효과 중첩 방식', 'conditions', { select: true, options: Object.entries(choices).map(([value, label]) => ({ value, label, selected: value === current })) });
    }
    if (itemEffect && !source.transfer) {
      for (const [key, title] of Object.entries({ selfTarget: '대상 대신 사용자에게 적용', selfTargetAlways: '사용자에게 항상 적용', dontApply: '자동 적용 제외' })) {
        add(`flags.dae.${key}`, title, 'conditions', { boolean: true });
      }
    }
    add(
      'flags.dae.enableCondition',
      '활성 조건식',
      'conditions',
      {
        multiline: true,
      },
    );
    add(
      'flags.dae.disableCondition',
      '비활성 조건식',
      'conditions',
      {
        multiline: true,
      },
    );
  }
  return fields;
}

export function effectGroups(fields) {
  return GROUPS.map(([id, title]) => ({
    id,
    title,
    fields: fields.filter((field) => field.group === id),
  })).filter((group) => group.fields.length);
}

export function effectStatusOptions(
  selected,
  configured = [],
) {
  const choices = new Map(
    selected.map((id) => [
      id,
      {
        id,
        label: id,
      },
    ]),
  );
  for (const status of configured) {
    if (!status.id) continue;
    const label = status.name ?? status.label ?? status.id;
    choices.set(
      status.id,
      {
        id: status.id,
        label: globalThis.game?.i18n?.localize?.(label) ?? label,
      },
    );
  }
  return Array.from(choices.values()).map((entry) => ({
    ...entry,
    checked: selected.includes(entry.id),
  }));
}

export function validateEffectPatch(patch) {
  const stackable = patch['flags.dae.stackable'];
  if (stackable !== undefined && !['', 'noneName', 'noneNameOnly', 'none', 'multi', 'count', 'countDeleteDecrement'].includes(stackable))
    throw new Error('효과 중첩 방식을 선택하십시오.');
  for (const key of ['showIcon', 'disableIncapacitated', 'selfTarget', 'selfTargetAlways', 'dontApply']) {
    if (patch[`flags.dae.${key}`] !== undefined && typeof patch[`flags.dae.${key}`] !== 'boolean') throw new Error('DAE 선택 값을 확인하십시오.');
  }
  if (patch.tint !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.tint))
    throw new Error('아이콘 색조는 #RRGGBB 형식으로 입력하십시오.');
  if (patch.statuses?.some((id) => typeof id !== 'string' || !id.trim()))
    throw new Error('상태 ID는 비어 있을 수 없습니다.');
  if (patch.origin !== undefined && !isEffectOriginValue(patch.origin))
    throw new Error('원본 UUID는 문서 UUID 형식(예: Actor.abc123.Item.def456)으로 입력하거나 비워 두십시오.');
  if (patch['duration.units'] !== undefined && !Object.hasOwn(DURATION_UNITS, patch['duration.units']))
    throw new Error('지속 단위를 선택하십시오.');
  for (const change of patch['system.changes'] ?? patch.changes ?? []) {
    if (!isValidStoredEffectChange(change))
      throw new Error('효과 변경값의 적용 방식을 선택하십시오.');
    const keys = String(change.key ?? '').split('.');
    if (
      keys.some(
        (key) =>
          !key.trim() ||
          ['__proto__', 'prototype', 'constructor'].includes(key),
      )
    )
      throw new Error('효과의 변경 경로를 확인하십시오.');
  }
}
