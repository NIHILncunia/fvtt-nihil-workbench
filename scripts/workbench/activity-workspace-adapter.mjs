import {
  damagePartFromFormula,
  formatDamagePartFormula,
} from './item-adapter.mjs';

const DAMAGE_ACTIVITY_TYPES = new Set(['attack', 'damage', 'save']);
const HEALING_ACTIVITY_TYPES = new Set(['heal']);

function sourceOf(activity) {
  if (!activity) return {};
  return typeof activity.toObject === 'function' ? activity.toObject() : activity;
}

function own(object, key) {
  return Object.hasOwn(object ?? {}, key);
}

function text(value) {
  return value == null ? '' : String(value);
}

function trimmed(value) {
  return text(value).trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function number(value, label) {
  const source = trimmed(value);
  if (!source) return '';
  const parsed = Number(source);
  if (!Number.isFinite(parsed)) throw new Error(`${label}은(는) 숫자로 입력해야 합니다.`);
  return parsed;
}

function sameValue(left, right) {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function valueAt(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function writeChanged(update, source, path, value) {
  const previous = valueAt(source, path);
  if (previous == null && value === '') return;
  if (!sameValue(previous, value)) update[path] = value;
}

function normalizeRecoveryRows(rows = []) {
  return rows.reduce((result, row) => {
    const period = trimmed(row?.period);
    const type = trimmed(row?.type);
    const formula = trimmed(row?.formula);
    if (!period && !type && !formula) return result;
    if (!period) throw new Error('사용 횟수 회복 시점을 선택하십시오.');
    if (period === 'recharge') {
      result.push({ period, type: 'recoverAll', formula: formula || '6' });
      return result;
    }
    if (!type) throw new Error('사용 횟수 회복 방식을 선택하십시오.');
    const recovery = { period, type };
    if (type === 'formula') {
      if (!formula) throw new Error('수식 회복에는 회복식을 입력하십시오.');
      recovery.formula = formula;
    }
    result.push(recovery);
    return result;
  }, []);
}

function buildDamageParts(rows = [], previousParts = []) {
  return rows.reduce((result, row, index) => {
    const formula = trimmed(row?.formula);
    const types = list(row?.types);
    if (!formula && !types.length) return result;
    if (!formula) throw new Error('피해 유형을 선택한 행에는 피해식을 입력하십시오.');
    const previous = previousParts[index] ?? {};
    const damage = damagePartFromFormula(formula, types);
    result.push({
      ...previous,
      ...damage,
      custom: {
        ...(previous.custom ?? {}),
        ...damage.custom,
      },
      types: damage.types,
    });
    return result;
  }, []);
}

function readRecoveryRows(recovery = []) {
  return Array.from(recovery ?? []).map((row) => ({
    period: text(row?.period),
    type: text(row?.type),
    formula: text(row?.formula),
  }));
}

function writeActivation(update, source, activation) {
  if (!activation) return;
  if (own(activation, 'type')) writeChanged(update, source, 'activation.type', trimmed(activation.type));
  if (own(activation, 'value')) writeChanged(update, source, 'activation.value', number(activation.value, '발동 수치'));
  if (own(activation, 'condition')) writeChanged(update, source, 'activation.condition', text(activation.condition));
}

function writeUses(update, source, uses) {
  if (!uses) return;
  if (own(uses, 'spent')) writeChanged(update, source, 'uses.spent', number(uses.spent, '소모 횟수'));
  if (own(uses, 'max')) writeChanged(update, source, 'uses.max', text(uses.max));
  if (own(uses, 'recovery')) {
    writeChanged(update, source, 'uses.recovery', normalizeRecoveryRows(uses.recovery));
  }
}

function writeRange(update, source, range) {
  if (!range) return;
  if (own(range, 'value')) writeChanged(update, source, 'range.value', text(range.value));
  if (own(range, 'units')) writeChanged(update, source, 'range.units', trimmed(range.units));
  if (own(range, 'special')) writeChanged(update, source, 'range.special', text(range.special));
}

function writeTarget(update, source, target) {
  if (!target) return;
  if (own(target, 'type')) writeChanged(update, source, 'target.affects.type', trimmed(target.type));
  if (own(target, 'count')) writeChanged(update, source, 'target.affects.count', text(target.count));
  if (own(target, 'special')) writeChanged(update, source, 'target.affects.special', text(target.special));
  const template = target.template;
  if (!template) return;
  if (own(template, 'type')) writeChanged(update, source, 'target.template.type', trimmed(template.type));
  if (own(template, 'size')) writeChanged(update, source, 'target.template.size', text(template.size));
  if (own(template, 'units')) writeChanged(update, source, 'target.template.units', trimmed(template.units));
}

function writeDamage(update, source, type, form) {
  if (!activityWorkspaceSupportsDamage(type) || !own(form, 'damageRows')) return;
  const parts = buildDamageParts(form.damageRows, source?.damage?.parts ?? []);
  if (!sameValue(source?.damage?.parts ?? [], parts)) update['damage.parts'] = parts;
}

function writeHealing(update, source, type, form) {
  if (!activityWorkspaceSupportsHealing(type) || !form.healing) return;
  const formula = text(form.healing.formula);
  const types = list(form.healing.types);
  if (source?.healing?.custom?.formula == null && !formula) {
    if (source?.healing?.types == null && !types.length) return;
  }
  writeChanged(update, source, 'healing.custom.enabled', Boolean(trimmed(formula)));
  writeChanged(update, source, 'healing.custom.formula', formula);
  writeChanged(update, source, 'healing.types', types);
}

function writeAttack(update, source, type, attack) {
  if (type !== 'attack' || !attack) return;
  if (own(attack, 'ability')) writeChanged(update, source, 'attack.ability', trimmed(attack.ability));
  if (own(attack, 'bonus')) writeChanged(update, source, 'attack.bonus', text(attack.bonus));
}

function writeSave(update, source, type, save) {
  if (type !== 'save' || !save) return;
  if (own(save, 'abilities')) writeChanged(update, source, 'save.ability', list(save.abilities));
  if (own(save, 'dc')) writeChanged(update, source, 'save.dc.formula', text(save.dc));
  if (own(save, 'calculation')) writeChanged(update, source, 'save.dc.calculation', text(save.calculation));
  if (own(save, 'onSave')) writeChanged(update, source, 'damage.onSave', trimmed(save.onSave));
}

function buildStandardUpdate(source, type, form) {
  const update = {};
  if (own(form, 'name')) writeChanged(update, source, 'name', trimmed(form.name));
  // Facility orders do not have the standard activity activation/uses/target
  // schema. Reject changes that the system would otherwise silently discard.
  if (type === 'order') {
    if (Object.keys(update).length) throw new Error('시설 명령 액티비티는 시스템이 관리합니다. 시설 본체의 설정을 수정하십시오.');
    const original = readActivityWorkspace(source);
    for (const key of ['activation', 'uses', 'range', 'target']) {
      if (form[key] && !sameValue(form[key], original[key])) {
        throw new Error('시설 명령은 발동·사용 횟수·대상 설정을 지원하지 않습니다.');
      }
    }
    return update;
  }
  writeActivation(update, source, form.activation);
  writeUses(update, source, form.uses);
  writeRange(update, source, form.range);
  writeTarget(update, source, form.target);
  writeDamage(update, source, type, form);
  writeHealing(update, source, type, form);
  writeAttack(update, source, type, form.attack);
  writeSave(update, source, type, form.save);
  return update;
}

function nestedSource(update) {
  const data = {};
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split('.');
    const last = keys.pop();
    let target = data;
    for (const key of keys) {
      target[key] ??= {};
      target = target[key];
    }
    target[last] = value;
  }
  return data;
}

export function activityWorkspaceSupportsDamage(type) {
  return DAMAGE_ACTIVITY_TYPES.has(type);
}

export function activityWorkspaceSupportsHealing(type) {
  return HEALING_ACTIVITY_TYPES.has(type);
}

export function readActivityWorkspace(activity) {
  const source = sourceOf(activity);
  return {
    id: source._id ?? activity?.id ?? null,
    type: source.type ?? activity?.type ?? '',
    name: text(source.name),
    activation: {
      type: text(source.activation?.type),
      value: text(source.activation?.value),
      condition: text(source.activation?.condition),
    },
    uses: {
      spent: text(source.uses?.spent),
      max: text(source.uses?.max),
      recovery: readRecoveryRows(source.uses?.recovery),
    },
    range: {
      value: text(source.range?.value),
      units: text(source.range?.units),
      special: text(source.range?.special),
    },
    target: {
      type: text(source.target?.affects?.type),
      count: text(source.target?.affects?.count),
      special: text(source.target?.affects?.special),
      template: {
        type: text(source.target?.template?.type),
        size: text(source.target?.template?.size),
        units: text(source.target?.template?.units),
      },
    },
    damageRows: Array.from(source.damage?.parts ?? []).map((part) => ({
      formula: formatDamagePartFormula(part),
      types: list(part?.types),
    })),
    healing: {
      formula: text(source.healing?.custom?.formula),
      types: list(source.healing?.types),
    },
    attack: {
      ability: text(source.attack?.ability),
      bonus: text(source.attack?.bonus),
    },
    save: {
      abilities: list(source.save?.ability),
      dc: text(source.save?.dc?.formula),
      calculation: text(source.save?.dc?.calculation),
      onSave: text(source.damage?.onSave),
    },
  };
}

export function buildActivityWorkspaceCreateData(type, form = {}) {
  if (type === 'order') throw new Error('시설 명령 액티비티는 시스템이 자동 생성합니다.');
  const name = trimmed(form.name);
  if (!name) throw new Error('활동 이름을 입력하십시오.');
  return nestedSource(buildStandardUpdate({}, type, { ...form, name }));
}

export function buildActivityWorkspaceUpdate(activity, form = {}) {
  const source = sourceOf(activity);
  const type = source.type ?? activity?.type ?? '';
  return buildStandardUpdate(source, type, form);
}
