import { complexEditor, complexKind, schemaChildren, typeChoices, validateComplexValue, validateStructuredKeys } from './type-complex-fields.mjs';
import { advancementDeletionPaths, advancementEditorSchema, advancementFallbackSchema } from './advancement-complex-fields.mjs';

export const CORE_ADVANCEMENT_TYPES = new Set([
  'AbilityScoreImprovement','HitPoints','ItemChoice','ItemGrant','ScaleValue','Size','Subclass','Trait',
]);

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Object.values(collection);
}

function sourceObject(advancement) {
  try { return advancement?.toObject?.() ?? {}; }
  catch { return {}; }
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
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,jsonReady(v)]));
  }
  return value;
}

function stable(value) {
  const ready=jsonReady(value);
  if (Array.isArray(ready)) return `[${ready.map(stable).join(',')}]`;
  if (ready && typeof ready === 'object') return `{${Object.keys(ready).sort().map(k=>`${JSON.stringify(k)}:${stable(ready[k])}`).join(',')}}`;
  return JSON.stringify(ready);
}

const PATH_LABELS = Object.freeze({
  level:'레벨', title:'제목', hint:'설명', icon:'아이콘', classRestriction:'클래스 제한', configuration:'설정', value:'값',
  allowReplacements:'교체 허용', grants:'부여 항목', nested:'세부 설정', mode:'방식', chosen:'선택값', abilities:'능력치', points:'점수',
  items:'아이템', pool:'선택 목록', fixed:'고정값', scale:'단계 값', size:'크기', trait:'특성', subclass:'서브클래스',
  assignments:'배정', feat:'피트', type:'유형', cap:'상한', locked:'잠금', max:'최대값', recommendation:'추천', sizes:'크기',
  count:'선택 개수', replacement:'교체 가능', optional:'선택 지급', uuid:'아이템 참조', added:'부여 결과', replaced:'교체 결과',
  spell:'주문 설정', ability:'시전 능력', method:'시전 방식', prepared:'준비 상태', uses:'사용 횟수', per:'회복 주기',
  requireSlot:'슬롯 필요', restriction:'선택 제한', list:'주문 목록', subtype:'하위 유형', identifier:'식별자',
  distance:'거리', units:'단위', number:'주사위 개수', faces:'주사위 면수', modifiers:'주사위 수정', document:'문서 식별자',
  allowDrops:'드롭 허용', str:'근력', dex:'민첩', con:'건강', int:'지능', wis:'지혜', cha:'매력',
  choices:'선택 배정', original:'기존 아이템',
});

function labelFor(path) {
  return String(path).split('.').map(p=>PATH_LABELS[p] ?? p.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())).join(' / ');
}

function ctorName(field) { return field?.constructor?.name ?? ''; }

function fieldKind(field, value) {
  const name=ctorName(field);
  if (name.includes('Boolean')) return 'boolean';
  if (name.includes('Number') || name.includes('Integer')) return 'number';
  if (name.includes('Array') || name.includes('Set') || name.includes('Mapping') || name.includes('Object')) return 'json';
  if (Array.isArray(value) || value instanceof Set || value instanceof Map) return 'json';
  if (value && typeof value === 'object') return 'json';
  return 'text';
}

function serialize(kind, value) {
  if (kind === 'boolean') return Boolean(value);
  if (value == null) return '';
  if (['json', 'complex'].includes(kind)) return JSON.stringify(jsonReady(value), null, 2);
  return String(value);
}

function parse(field) {
  if (field.value === '' && field.schema?.options?.nullable === true) return null;
  if (field.kind === 'boolean') return Boolean(field.value);
  if (field.kind === 'number') return field.value === '' || field.value == null ? null : Number(field.value);
  if (['json', 'complex'].includes(field.kind)) {
    try { return JSON.parse(String(field.value ?? 'null')); }
    catch (error) { throw new Error(`${field.path}: JSON 형식이 올바르지 않습니다. ${error.message}`); }
  }
  return String(field.value ?? '');
}

export function availableAdvancementTypes(item, advancementTypes={}) {
  return Object.entries(advancementTypes)
    .filter(([,config])=>!config?.hidden)
    .filter(([,config])=>!config?.validItemTypes || config.validItemTypes.has(item?.type))
    .filter(([,config])=>typeof config?.documentClass?.availableForItem !== 'function' || config.documentClass.availableForItem(item))
    .map(([value,config])=>({
      value,
      label: config?.documentClass?.metadata?.title ?? value,
      icon: config?.documentClass?.metadata?.typeIcon ?? config?.documentClass?.metadata?.icon ?? '',
    }));
}

export function getAdvancement(item,id) {
  if (!item || !id) return null;
  return item.advancement?.byId?.[id] ?? null;
}

function ids(item) {
  return new Set(Object.keys(item?.advancement?.byId ?? {}));
}

function findNewAdvancement(item,before) {
  return Object.values(item?.advancement?.byId ?? {}).find(a=>!before.has(a.id ?? a._id)) ?? null;
}

export async function createAdvancement(item,type,data={}) {
  if (!item?.createAdvancement) throw new Error('Item does not support createAdvancement().');
  const before=ids(item);
  await item.createAdvancement(type,data,{renderSheet:false});
  return findNewAdvancement(item,before);
}

export async function duplicateAdvancement(item,id) {
  if (!item?.duplicateAdvancement) throw new Error('Item does not support duplicateAdvancement().');
  const before=ids(item);
  await item.duplicateAdvancement(id,{showConfig:false});
  return findNewAdvancement(item,before);
}

export async function deleteAdvancement(item,id) {
  if (!item?.deleteAdvancement) throw new Error('Item does not support deleteAdvancement().');
  return item.deleteAdvancement(id);
}

function addDescriptor(
  out,
  source,
  field,
  path,
  advancement,
  draft,
) {
  const original=jsonReady(getAtPath(source,path));
  const kind=fieldKind(field,original);
  const schema = advancementEditorSchema(
    field,
    path,
    advancement,
    draft?.['configuration.type'] ?? source.configuration?.type,
  );
  const isComplex = Boolean(complexKind(schema));
  const descriptor = {
    path, label: labelFor(path), kind: isComplex ? 'complex' : kind, original,
    value: original == null && isComplex ? JSON.stringify(original ?? null) : serialize(kind, original),
    schema, isComplex,
    isBoolean: kind === 'boolean', isNumber: kind === 'number', isJson: kind === 'json' && !isComplex, isText: kind === 'text',
    isLongText: path === 'hint',
  };
  descriptor.renderedValue = descriptor.value;
  descriptor.options = typeChoices(
    schema,
    path,
    advancement.item,
    original,
  );
  descriptor.hasChoices = descriptor.options.length > 0 && !isComplex && !schema.workbenchReference;
  descriptor.isReference = schema.workbenchReference;
  descriptor.referenceList = `ncm-adv-${path.replaceAll('.', '-')}`;
  descriptor.step = schema.options?.integer ? '1' : 'any';
  descriptor.min = schema.options?.min;
  descriptor.hasMin = descriptor.min != null;
  if (isComplex) descriptor.editor = complexEditor(
    schema,
    draft?.[path] !== undefined ? JSON.parse(draft[path]) : original,
    path,
    advancement.item,
    (path) => labelFor(path.split('.').at(-1)),
  );
  out.push(descriptor);
}

function walkFields(
  out,
  source,
  fields,
  prefix = '',
  advancement,
  draft,
) {
  for (const [key,field] of Object.entries(fields ?? {})) {
    const path=prefix?`${prefix}.${key}`:key;
    const nested=ctorName(field) === 'SchemaField' && field?.fields && Object.keys(field.fields).length ? field.fields : null;
    if (nested) walkFields(
      out,
      source,
      nested,
      path,
      advancement,
      draft,
    );
    else addDescriptor(
      out,
      source,
      field,
      path,
      advancement,
      draft,
    );
  }
}

export function readAdvancementFields(
  advancement,
  draft = {},
) {
  if (!advancement) return [];
  const source=sourceObject(advancement);
  const cls=advancement.constructor ?? {};
  const out=[];
  const top=cls.schema?.fields ?? {};
  for (const key of ['level','title','hint','icon','classRestriction']) {
    if (top[key]) addDescriptor(
      out,
      source,
      top[key],
      key,
      advancement,
      draft,
    );
  }
  for (const root of ['configuration','value']) {
    const model=cls.metadata?.dataModels?.[root];
    const fields=model?.schema?.fields;
    if (fields && Object.keys(fields).length) walkFields(
      out,
      source,
      fields,
      root,
      advancement,
      draft,
    );
    else if (root === 'value' && advancementFallbackSchema(source.type)) {
      const schema = advancementFallbackSchema(source.type);
      if (schema.fields) walkFields(
        out,
        source,
        schema.fields,
        root,
        advancement,
        draft,
      );
      else addDescriptor(
        out,
        source,
        schema,
        root,
        advancement,
        draft,
      );
    }
    else if (source[root] && Object.keys(source[root]).length) {
      addDescriptor(
        out,
        source,
        { constructor: { name: 'ObjectField' } },
        root,
        advancement,
        draft,
      );
    }
  }
  return out.sort((a,b)=>a.path.localeCompare(b.path));
}

export function buildAdvancementFieldUpdate(fields=[]) {
  const scale = fields.find((field) => field.path === 'configuration.scale');
  const type = fields.find((field) => field.path === 'configuration.type');
  if (scale && type && type.value !== type.renderedValue) {
    const required = Object.entries(schemaChildren(scale.schema?.model) ?? {}).filter(
      ([, field]) => field.options?.required,
    );
    for (const [level, value] of Object.entries(parse(scale) ?? {})) {
      if (required.some(([key]) => value?.[key] == null))
        throw new Error(`레벨 ${level}: 새 유형의 단계 값을 입력하거나 해당 행을 삭제하십시오.`);
    }
  }
  const update={};
  for (const field of fields) {
    if ('renderedValue' in field && field.value === field.renderedValue) continue;
    if (field.original == null && String(field.value ?? '').trim()==='') continue;
    if (field.original == null && field.kind==='boolean' && field.value===false) continue;
    const value=parse(field);
    if (stable(value)===stable(field.original)) continue;
    validateStructuredKeys(value, field.original, field.path);
    if (field.schema) validateComplexValue(
      field.schema,
      value,
      field.path,
      field.original,
    );
    update[field.path]=value;
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
