import { complexEditor, complexKind, typeChoices, validateComplexValue, validateStructuredKeys } from './type-complex-fields.mjs';
import { activityEditorSchema, validateActivityReferences } from './activity-complex-fields.mjs';
import { advancementDeletionPaths } from './advancement-complex-fields.mjs';
import { MIDI_AUTOMATION_LABELS, MIDI_AUTOMATION_CHOICES, isDedicatedMidiField } from './module-automation-fields.mjs';

export const CORE_ACTIVITY_TYPES = new Set([
  'attack', 'cast', 'check', 'damage', 'enchant', 'forward',
  'heal', 'order', 'save', 'summon', 'transform', 'utility',
]);

const IDENTITY_ROOTS = new Set(['_id', 'type', 'name', 'img', 'sort']);

const COMMON_ROOTS = new Set([
  'img', 'activation', 'consumption', 'description', 'duration', 'effects', 'flags',
  'range', 'target', 'uses', 'visibility',
  'useConditionText', 'useConditionReason', 'effectConditionText', 'macroData', 'midiProperties',
]);

function ctorName(field) {
  return field?.constructor?.name ?? '';
}

function fieldKind(field, value) {
  const name = ctorName(field);
  if (name.includes('Boolean')) return 'boolean';
  if (name.includes('Number') || name.includes('Integer')) return 'number';
  if (name.includes('Array') || name.includes('Set') || name.includes('Mapping') || name.includes('Object')) return 'json';
  if (Array.isArray(value) || value instanceof Set || value instanceof Map) return 'json';
  if (value && typeof value === 'object') return 'json';
  if (field?.fields && !Object.keys(field.fields).length) return 'json';
  return 'text';
}

const PATH_LABELS = Object.freeze({
  activation: '발동', type: '유형', value: '값', range: '사거리', units: '단위', override: '직접 지정', special: '특수',
  target: '대상 / 범위', affects: '대상', count: '대상 수', choice: '선택', template: '범위', contiguous: '연속', size: '크기', width: '너비', height: '높이',
  damage: '피해', parts: '피해식', onSave: '내성 성공 시', critical: '치명타', allow: '허용',
  save: '내성 굴림', ability: '능력치', dc: '난이도', formula: '수식', calculation: '계산 방식',
  healing: '회복', custom: '사용자 수식', enabled: '사용', types: '종류', scaling: '증가', number: '수치', denomination: '주사위 면', bonus: '보너스', mode: '방식',
  consumption: '소모', duration: '지속시간', effects: '효과', flags: '플래그', uses: '사용 횟수', visibility: '표시 조건', description: '설명',
  prompt: '확인창', sort: '정렬', name: '이름', img: '아이콘', macroData: '매크로 데이터', useConditionText: '사용 조건', useConditionReason: '사용 조건 사유', effectConditionText: '효과 조건',
  command: '명령', condition: '조건', spent: '소모량', max: '최대값', recovery: '회복 규칙', chatFlavor: '채팅 문구', allowed: '허용', spellSlot: '주문 슬롯', targets: '소모 대상', concentration: '집중', identifier: '식별자', level: '레벨', min: '최소값', requireAttunement: '조율 필요', requireIdentification: '식별 필요', requireMagic: '마법 필요',
  attack: '공격', check: '능력 판정', order: '명령', associated: '연관 항목', threshold: '임계값', flat: '고정값', classification: '분류', includeBase: '기본 피해 포함',
  profiles: '소환·변신 후보', uuid: '액터 참조', cr: '도전 지수', creatureSizes: '허용 크기', creatureTypes: '허용 크리처 종류',
  bonuses: '소환 보정', ac: '방어도', hd: '생명 주사위', hp: '체력', attackDamage: '공격 피해', saveDamage: '내성 피해',
  match: '소환자와 맞추기', attacks: '공격', disposition: '우호도', proficiency: '숙련 보너스', saves: '내성',
  summon: '소환 방식', transform: '변신 방식', settings: '변신 사용자 설정', customize: '사용자 설정 사용', preset: '프리셋',
  movement: '이동 방식', sizes: '크기', keep: '유지할 항목', merge: '합칠 항목', other: '기타 설정', minimumAC: '최소 방어도',
  spellLists: '주문 목록', tempFormula: '임시 체력 수식', transformTokens: '토큰 변신', _id: '식별자·효과 참조',
});

function displayPathLabel(path) {
  return String(path).split('.').map((part) => MIDI_AUTOMATION_LABELS[part] ?? PATH_LABELS[part] ?? part).join(' › ');
}

function serialize(kind, value) {
  if (kind === 'boolean') return Boolean(value);
  if (value == null) return '';
  if (kind === 'json') return JSON.stringify(value, null, 2);
  return String(value);
}

function flattenField(
  field,
  value,
  path,
  output,
  activity,
  draft,
) {
  if (path.startsWith('midiProperties.') && !isDedicatedMidiField(path)) return;
  const entries = field?.fields && field.options?.nullable !== true ? Object.entries(field.fields) : [];
  if (path === 'midiProperties' && !entries.length) return;
  if (entries.length) {
    for (const [key, child] of entries) flattenField(
      child,
      value?.[key],
      `${path}.${key}`,
      output,
      activity,
      draft,
    );
    return;
  }
  const schema = activityEditorSchema(
    field,
    path,
    activity,
  );
  const isComplex = Boolean(complexKind(schema));
  const kind = isComplex ? 'complex' : fieldKind(field, value);
  const choices = typeChoices(
    schema,
    path,
    activity.item,
    value,
  );
  const descriptor = {
    path,
    label: displayPathLabel(path),
    kind,
    original: value,
    value: isComplex ? JSON.stringify(value ?? null) : serialize(kind, value),
    schema,
    isComplex,
    isReference: schema.workbenchReference,
    referenceList: `ncm-activity-${path.replaceAll('.', '-')}`,
    isLongText: ['useConditionText', 'useConditionReason', 'effectConditionText', 'macroData.command'].includes(path) || path.startsWith('description.'),
    hasChoices: choices.length > 0 && !isComplex && kind !== 'json' && kind !== 'boolean' && !schema.workbenchReference,
    options: choices.map((option) => ({ ...option, selected: String(option.value) === String(value ?? '') })),
    isBoolean: kind === 'boolean',
    isNumber: kind === 'number',
    isText: kind === 'text',
    isJson: kind === 'json',
    step: schema.options?.integer ? '1' : 'any',
    min: schema.options?.min,
    hasMin: schema.options?.min != null,
  };
  descriptor.renderedValue = descriptor.value;
  if (isComplex) descriptor.editor = complexEditor(
    schema,
    draft?.[path] !== undefined ? JSON.parse(draft[path]) : value,
    path,
    activity.item,
    (childPath) => displayPathLabel(childPath.split('.').at(-1)),
  );
  output.push(descriptor);
}

export function readActivityCommonFields(
  activity,
  draft = {},
) {
  if (!activity) return [];
  const source = typeof activity.toObject === 'function' ? activity.toObject() : activity;
  const schemaFields = activity?.schema?.fields ?? activity?.constructor?.schema?.fields ?? {};
  const output = [];
  for (const [key, field] of Object.entries(schemaFields)) {
    if (!COMMON_ROOTS.has(key)) continue;
    flattenField(
      field,
      source?.[key],
      key,
      output,
      activity,
      draft,
    );
  }
  return output;
}

function parseValue(field) {
  if (field.value === '' && field.schema?.options?.nullable === true) return null;
  if (field.kind === 'boolean') return Boolean(field.value);
  if (field.kind === 'number') {
    if (field.value === '' || field.value == null) return null;
    const n = Number(field.value);
    if (!Number.isFinite(n)) throw new Error(`${field.path}: 숫자 값이 올바르지 않습니다.`);
    return n;
  }
  if (['json', 'complex'].includes(field.kind)) {
    try { return JSON.parse(String(field.value ?? 'null')); }
    catch (error) { throw new Error(`${field.path}: JSON 형식이 올바르지 않습니다. ${error.message}`); }
  }
  return String(field.value ?? '');
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

export function buildActivityFieldUpdate(fields = []) {
  const update = {};
  for (const field of fields) {
    if ('renderedValue' in field && field.value === field.renderedValue) continue;
    if (field.original == null && String(field.value ?? '').trim() === '') continue;
    if (field.original == null && field.kind === 'boolean' && field.value === false) continue;
    const value = parseValue(field);
    if (sameValue(value, field.original)) continue;
    validateStructuredKeys(value, field.original, field.path);
    if (MIDI_AUTOMATION_CHOICES[field.path] && !Object.hasOwn(MIDI_AUTOMATION_CHOICES[field.path], value)) {
      throw new Error(`${field.label}: 표시된 자동화 설정을 선택하십시오.`);
    }
    if (field.schema) validateComplexValue(
      field.schema,
      value,
      field.path,
      field.original,
    );
    update[field.path] = value;
    Object.assign(
      update,
      advancementDeletionPaths(
        field.original,
        value,
        field.path,
      ),
    );
  }
  return update;
}

export function readActivitySpecificFields(
  activity,
  nativeClass,
  draft = {},
) {
  if (!activity || !nativeClass || !CORE_ACTIVITY_TYPES.has(activity.type)) return [];
  const source = typeof activity.toObject === 'function' ? activity.toObject() : activity;
  const actualFields = activity?.schema?.fields ?? activity?.constructor?.schema?.fields ?? {};
  const nativeFields = nativeClass?.schema?.fields ?? {};
  const roots = Object.keys(nativeFields).filter((key) => !IDENTITY_ROOTS.has(key) && !COMMON_ROOTS.has(key));
  const output = [];
  for (const key of roots) {
    const field = actualFields[key] ?? nativeFields[key];
    if (!field) continue;
    flattenField(
      field,
      source?.[key],
      key,
      output,
      activity,
      draft,
    );
  }
  return output;
}

export function activityFieldEditsFromForm(
  activity,
  nativeClass,
  form,
) {
  const controls = Array.from(form.querySelectorAll('[data-activity-common-field], [data-activity-specific-field]'));
  const draft = Object.fromEntries(controls.map((control) => [
    control.dataset.activityPath ?? control.dataset.activitySpecificPath,
    control.type === 'checkbox' ? control.checked : control.value,
  ]));
  const fields = [
    ...readActivityCommonFields(
      activity,
      draft,
    ),
    ...readActivitySpecificFields(
      activity,
      nativeClass,
      draft,
    ),
  ].map((field) => ({ ...field, value: draft[field.path] ?? field.value }));
  const update = buildActivityFieldUpdate(fields);
  validateActivityReferences(
    fields,
    activity,
  );
  return update;
}
