import { complexEditor, complexKind, typeChoices, validateComplexValue, validateStructuredKeys } from './type-complex-fields.mjs';

const EXCLUDED_TOP_LEVEL = new Set([
  'activities', 'uses', 'advancement', 'identifier', 'source', 'identified', 'unidentified',
  'container', 'quantity', 'weight', 'price', 'rarity', 'attunement', 'attuned', 'equipped', 'properties',
]);

const EXCLUDED_PATHS = new Set(['description.value', 'damage.base']);

function ctorName(field) {
  return field?.constructor?.name ?? '';
}

function getAtPath(object, path) {
  let value = object;
  for (const part of String(path).split('.')) value = value?.[part];
  return value;
}

function jsonReady(value) {
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Object.fromEntries(value);
  if (Array.isArray(value)) return value.map(jsonReady);
  if (value && typeof value === 'object') {
    if (typeof value.toObject === 'function') return value.toObject();
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonReady(v)]));
  }
  return value;
}

function stable(value) {
  const ready = jsonReady(value);
  if (Array.isArray(ready)) return `[${ready.map(stable).join(',')}]`;
  if (ready && typeof ready === 'object') {
    return `{${Object.keys(ready).sort().map((k) => `${JSON.stringify(k)}:${stable(ready[k])}`).join(',')}}`;
  }
  return JSON.stringify(ready);
}

const PATH_LABELS = Object.freeze({
  type:'유형', subtype:'하위 유형', value:'값', baseItem:'기반 아이템', range:'사거리', reach:'도달 거리', long:'장거리', units:'단위',
  magicalBonus:'마법 보너스', crew:'승무원', crewed:'승무원 필요', max:'최대값', damage:'피해', versatile:'다용도', bonus:'보너스', types:'유형',
  description:'설명', chat:'채팅 설명', chatFlavor:'채팅 문구', armor:'방어구', ac:'방어도', dex:'민첩 보정', strength:'필요 근력', stealth:'은신', ammunition:'탄약',
  properties:'속성', movement:'이동', senses:'감각', spellcasting:'주문 시전', primaryAbility:'주요 능력치', hd:'생명 주사위', levels:'레벨', classIdentifier:'클래스 식별자',
  cover:'엄폐', enchant:'마법 부여', prerequisites:'선행 조건', requirements:'요구 조건', items:'아이템', item:'아이템', level:'레벨', repeatable:'반복 가능', period:'주기',
  startingEquipment:'시작 장비', _id:'식별자', group:'상위 묶음', sort:'정렬', key:'대상', requiresProficiency:'숙련 필요', wealth:'시작 자금', classRestriction:'클래스 제한', hint:'설명', assignments:'배정', feat:'피트', cap:'상한', locked:'잠금', recommendation:'추천',
  capacity:'용량', count:'수량', volume:'부피', weight:'무게', currency:'화폐', additional:'추가', denomination:'주사위 면', spent:'소모량', all:'전체', ability:'능력치',
  preparation:'준비', formula:'수식', progression:'진행 방식', replace:'대체', hp:'체력', proficient:'숙련', speed:'속도', conditions:'조건', dt:'피해 임계값',
  building:'건설', built:'건설 완료', craft:'제작', quantity:'수량', defenders:'방어 인원', disabled:'비활성화', enlargeable:'확장 가능', free:'무료', hirelings:'고용인', progress:'진행도', order:'명령', size:'크기', trade:'거래', creatures:'생물', pending:'대기 중', operation:'작업', stocked:'재고량', profit:'이익', stock:'재고',
  custom:'사용자 지정', burrow:'굴착', climb:'등반', fly:'비행', hover:'공중 정지', ignoredDifficultTerrain:'어려운 지형 무시', swim:'수영', walk:'보행',
  blindsight:'맹시', darkvision:'암시야', special:'특수', tremorsense:'진동 감지', truesight:'진실의 시야', sizes:'크기',
  target:'대상 / 범위', affects:'대상', choice:'선택', template:'범위', contiguous:'연속', height:'높이', width:'너비', activation:'발동', condition:'조건', duration:'지속시간',
  materials:'재료', consumed:'소모됨', cost:'비용', supply:'공급량', method:'시전 방식', prepared:'준비됨', school:'학파', sourceClass:'출처 클래스',
  mastery:'무기 숙련 기법', enabled:'사용', scaling:'증가', mode:'방식', number:'수치', attack:'공격', threshold:'임계값', flat:'고정값', classification:'분류', includeBase:'기본 피해 포함',
});
const CHOICE_LABELS = Object.freeze({ simpleM:'단순 근접', martialM:'군용 근접', simpleR:'단순 원거리', martialR:'군용 원거리' });

export function displayTypeLabel(path) {
  return String(path).split('.').map((part) => PATH_LABELS[part] ?? part
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())).join(' / ');
}

function fieldKind(field) {
  const ctor = ctorName(field);
  if (ctor === 'BooleanField') return 'boolean';
  if (ctor === 'NumberField' || ctor === 'IntegerSortField') return 'number';
  if (['SetField', 'ArrayField', 'MappingField', 'EmbeddedDataField'].includes(ctor)) return 'json';
  if (field?.fields && Object.keys(field.fields).length) return 'group';
  return 'text';
}

function shouldSkip(path) {
  if (!path) return false;
  const top = path.split('.')[0];
  if (EXCLUDED_TOP_LEVEL.has(top)) return true;
  if (EXCLUDED_PATHS.has(path)) return true;
  if (path.startsWith('damage.base.')) return true;
  if (path === 'description') return false;
  return false;
}

function sourceSystem(item) {
  try {
    const source = item?.toObject?.()?.system;
    if (source) return source;
  } catch { /* fall through */ }
  return item?.system ?? {};
}

export function readTypeFields(item) {
  const schema = item?.system?.schema?.fields ?? {};
  const source = sourceSystem(item);
  const fields = [];

  const walk = (field, path) => {
    if (shouldSkip(path)) {
      if (path === 'description' && field?.fields?.chat) walk(field.fields.chat, 'description.chat');
      return;
    }
    const kind = fieldKind(field);
    if (kind === 'group') {
      for (const [key, child] of Object.entries(field.fields ?? {})) walk(child, path ? `${path}.${key}` : key);
      return;
    }
    const original = jsonReady(getAtPath(source, path));
    const choices = typeChoices(
      field,
      path,
      item,
      original,
    ).map((option) => ({ ...option, label: CHOICE_LABELS[option.value] ?? option.label }));
    const isComplex = kind === 'json' && Boolean(complexKind(field));
    const descriptor = {
      path,
      label: displayTypeLabel(path),
      kind: isComplex ? 'complex' : kind,
      schema: field,
      original,
      hasChoices: choices.length > 0 && kind !== 'json' && kind !== 'boolean',
      options: choices.map((option) => ({ ...option, selected: String(option.value) === String(original ?? '') })),
      isBoolean: kind === 'boolean',
      isNumber: kind === 'number',
      isJson: kind === 'json' && !isComplex,
      isComplex,
      isText: kind === 'text',
    };
    if (kind === 'json') {
      descriptor.value = JSON.stringify(original ?? (ctorName(field) === 'MappingField' ? {} : []), null, 2);
      if (isComplex) descriptor.editor = complexEditor(
        field,
        JSON.parse(descriptor.value),
        path,
        item,
        displayTypeLabel,
      );
    }
    else if (kind === 'boolean') descriptor.value = Boolean(original);
    else descriptor.value = original == null ? '' : String(original);
    descriptor.renderedValue = descriptor.value;
    fields.push(descriptor);
  };

  for (const [key, field] of Object.entries(schema)) walk(field, key);
  return fields.sort((a, b) => a.path.localeCompare(b.path));
}

export function buildTypeFieldUpdate(fields = []) {
  const update = {};
  for (const field of fields) {
    if ('renderedValue' in field && field.value === field.renderedValue) continue;
    let value;
    if (field.kind === 'boolean') value = Boolean(field.value);
    else if (field.kind === 'number') value = field.value === '' || field.value == null ? null : Number(field.value);
    else if (['json', 'complex'].includes(field.kind)) {
      try { value = JSON.parse(String(field.value ?? 'null')); }
      catch (error) { throw new Error(`Invalid JSON for ${field.path}: ${error.message}`); }
    } else value = String(field.value ?? '');
    if (stable(value) === stable(field.original)) continue;
    validateStructuredKeys(value, field.original, field.path);
    if (field.schema) validateComplexValue(
      field.schema,
      value,
      field.path,
      field.original,
    );
    update[`system.${field.path}`] = value;
  }
  return update;
}
