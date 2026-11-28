import { ownershipReplacement } from '../shared/compat.mjs';
import { addDeletion } from '../shared/deletion.mjs';
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const IMMUTABLE = new Set(['_id', '_stats', '_migration', 'type']);
const LABELS = {
  itemType: '아이템 유형',
  sorting: '정렬 방식',
  name: '이름',
  img: '이미지',
  system: '시스템 데이터',
  flags: '모듈 설정',
  ownership: '사용자 권한',
  folder: '폴더 ID',
  sort: '정렬 순서',
  description: '설명',
  disabled: '비활성',
  transfer: '액터에 전이',
  changes: '변경값 목록',
  statuses: '상태 ID 목록',
  duration: '지속시간',
  origin: '원본 UUID',
  seconds: '초',
  rounds: '라운드',
  turns: '턴',
  startTime: '시작 시간',
  startRound: '시작 라운드',
  startTurn: '시작 턴',
  texture: '토큰 이미지',
  src: '경로',
  scaleX: '가로 배율',
  scaleY: '세로 배율',
  tint: '색상',
  sight: '시야',
  light: '조명',
  detectionModes: '감지 모드 목록',
  range: '범위',
  enabled: '사용',
  animation: '애니메이션',
  angle: '각도',
  bright: '밝은 범위',
  dim: '희미한 범위',
  alpha: '불투명도',
  color: '색상',
  visionMode: '시야 모드',
  actorLink: '액터 연결',
  disposition: '태도',
  width: '너비',
  height: '높이',
  rotation: '회전',
  elevation: '고도',
  displayName: '이름 표시',
  displayBars: '바 표시',
  bar1: '자원 바 1',
  bar2: '자원 바 2',
  attribute: '자원 경로',
  randomImg: '무작위 이미지',
  appendNumber: '번호 추가',
  prependAdjective: '수식어 추가',
  lockRotation: '회전 잠금',
};

export function pathValue(
  source,
  path
) {
  return path.split('.').reduce(
    (
    value,
    key
  ) => value?.[key],
    source
  );
}

function safeObject(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE.has(key) || key.includes('.'))
      throw new Error(`허용하지 않는 데이터 키: ${key}`);
    safeObject(child);
  }
}

export function readDocumentFields(
  source,
  schema,
  roots = Object.keys(source)
) {
  const result = [];
  const walk = (
    value,
    field,
    path
  ) => {
    const fields = field?.fields ?? field?.schema?.fields;
    const kind = field?.constructor?.name ?? '';
    const object = value && typeof value === 'object' && !Array.isArray(value);
    const json =
      /Array|Set|Mapping|EmbeddedCollection/.test(kind) ||
      (kind.includes('EmbeddedData') && !fields) ||
      ['flags', 'ownership', 'changes', 'statuses', 'detectionModes'].includes(path) ||
      Array.isArray(value) ||
      (object && !fields && !Object.keys(value).length);
    const keys = new Set([
      ...Object.keys(fields ?? {}),
      ...Object.keys(object ? value : {}),
    ]);
    if (!json && (fields || object) && keys.size) {
      for (const key of keys) {
        if (UNSAFE.has(key) || key.startsWith('_')) continue;
        walk(
          value?.[key],
          fields?.[key],
          `${path}.${key}`
        );
      }
      return;
    }
    const boolean = kind === 'BooleanField' || typeof value === 'boolean';
    const number = /Number|Integer/.test(kind) || typeof value === 'number';
    let choices = field?.choices;
    if (typeof choices === 'function') {
      try {
        choices = choices();
      } catch {
        choices = null;
      }
    }
    const options = Array.isArray(choices)
      ? choices.map((choice) => ({ value: choice, label: String(choice) }))
      : Object.entries(choices ?? {}).map(([key, label]) => {
          const text = String(
            label && typeof label === 'object'
              ? (label.label ?? label.name ?? key)
              : label,
          );
          return { value: key, label: globalThis.game?.i18n?.localize?.(text) ?? text };
        });
    if (
      options.length &&
      !options.some((option) => String(option.value) === String(value ?? ''))
    ) {
      options.unshift({ value: value ?? '', label: String(value ?? '미설정') });
    }
    const initial = json
      ? JSON.stringify(
        value ?? (kind.includes('Array') || kind.includes('Set') ? [] : {}),
        null,
        2,
      )
      : boolean
        ? Boolean(value)
        : (typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value ?? '');
    result.push({
      path,
      title: path
        .split('.')
        .map((key) => LABELS[key] ?? key)
        .join(' · '),
      initial,
      value: initial,
      original: value,
      json,
      multiline: !json && typeof initial === 'string' && (initial.includes('\n') || initial.length > 180 || /description|biography/.test(path)),
      boolean,
      number,
      integer: Boolean(field?.integer),
      nullable: Boolean(field?.nullable),
      min: field?.min,
      max: field?.max,
      select: options.length > 0,
      options: options.map((option) => ({
        ...option,
        selected: String(option.value) === String(value ?? ''),
      })),
    });
  };
  for (const root of roots) {
    if (UNSAFE.has(root) || IMMUTABLE.has(root)) continue;
    walk(
      source[root],
      schema?.fields?.[root] ?? schema?.[root],
      root
    );
  }
  return result;
}

export function buildDocumentPatch(
  fields,
  values,
  current
) {
  const patch = {};
  const conflicts = [];
  const put = (
    path,
    before,
    after
  ) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        put(
          `${path}.${key}`,
          before[key],
          after[key]
        );
      }
      return;
    }
    if (
      JSON.stringify(pathValue(
        current,
        path
      )) !== JSON.stringify(before) &&
      JSON.stringify(pathValue(
        current,
        path
      )) !== JSON.stringify(after)
    )
      conflicts.push(path);
    if (after === undefined) addDeletion(patch, path);
    else patch[path] = after;
  };
  for (const field of fields) {
    if (
      !(field.path in values) ||
      JSON.stringify(values[field.path]) === JSON.stringify(field.initial)
    )
      continue;
    let value = values[field.path];
    if (field.json) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error(`${field.title}: JSON 형식을 확인하십시오.`);
      }
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) !== Array.isArray(field.original ?? value)
      ) {
        throw new Error(`${field.title}: 객체 또는 목록의 원래 형식을 유지하십시오.`);
      }
      safeObject(value);
    } else if (field.colorPicker) {
      value = String(value ?? '').trim();
      if (value && !/^#[0-9a-f]{6}$/i.test(value))
        throw new Error(`${field.title}: #RRGGBB 형식의 색상을 입력하거나 비워 두십시오.`);
      if (!value) value = field.nullable ? null : '';
    } else if (field.boolean) value = Boolean(value);
    else if (field.number) {
      if (String(value).trim() === '' && field.nullable) value = null;
      else {
        value = Number(value);
        if (
          !Number.isFinite(value) ||
          (field.integer && !Number.isInteger(value)) ||
          (field.min != null && value < field.min) ||
          (field.max != null && value > field.max)
        ) {
          throw new Error(`${field.title}: 허용 범위의 숫자를 입력하십시오.`);
        }
      }
    } else if (value === '' && field.nullable) value = null;
    if (field.path === 'name' && !String(value).trim())
      throw new Error('이름을 입력하십시오.');
    // Foundry v14 권한 묶음은 삭제 연산자를 받지 않으므로 전체를 ForcedReplacement로 바꾼다.
    const replace = ownershipReplacement();
    if (field.path === 'ownership' && replace && value && typeof value === 'object') {
      if (JSON.stringify(pathValue(current, 'ownership')) !== JSON.stringify(field.original)
        && JSON.stringify(pathValue(current, 'ownership')) !== JSON.stringify(value))
        conflicts.push('ownership');
      patch.ownership = replace(value);
      continue;
    }
    put(
      field.path,
      field.original,
      value
    );
  }
  return { patch, conflicts };
}

export function editableDocumentRoots(document) {
  return document.documentName === 'ActiveEffect'
    ? [...new Set([...Object.keys(document.toObject()), ...Object.keys(document.schema?.fields ?? {})])]
    : [
        'name',
        'img',
        'system',
        'flags',
        ...(document.parent ? [] : ['ownership', 'folder', 'sort']),
      ];
}

export function itemEditSnapshot(item) {
  const source = item?.toObject?.();
  if (!source) return null;
  const flags = source.flags ? structuredClone(source.flags) : source.flags;
  // D&D5e populates this derived activity registry after native Item writes.
  // Activity references are protected by system.activities; this registry is never edited here.
  if (flags?.dnd5e) {
    delete flags.dnd5e.riders;
    if (!Object.keys(flags.dnd5e).length) delete flags.dnd5e;
  }
  return JSON.stringify({
    name: source.name,
    img: source.img,
    system: source.system,
    flags,
  });
}
