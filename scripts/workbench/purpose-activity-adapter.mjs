import { damagePartFromFormula } from './item-adapter.mjs';

export const ACTIVITY_PURPOSES = Object.freeze([
  { value: 'extraDamage', label: '추가 피해', icon: 'fa-solid fa-burst' },
  { value: 'heal', label: '회복 효과', icon: 'fa-solid fa-heart-pulse' },
  { value: 'save', label: '내성 공격', icon: 'fa-solid fa-shield-halved' },
  { value: 'status', label: '상태 효과', icon: 'fa-solid fa-wand-magic-sparkles' },
  { value: 'advanced', label: '기타 / 고급', icon: 'fa-solid fa-sliders' },
]);

const ACTIVITY_TYPE_LABELS = Object.freeze({
  attack: '공격',
  cast: '주문 시전',
  check: '능력 판정',
  damage: '피해',
  enchant: '부여',
  forward: '연결',
  heal: '회복',
  order: '시설 명령',
  save: '내성 굴림',
  summon: '소환',
  transform: '변신',
  utility: '기타 효과',
});

export function activityTypeLabel(type) {
  return ACTIVITY_TYPE_LABELS[type] ?? String(type ?? '');
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function buildRange(form = {}) {
  const rangeType = text(form.rangeType) || 'self';
  if (rangeType === 'distance') {
    return {
      value: text(form.rangeValue),
      units: text(form.rangeUnits) || 'ft',
      override: false,
      special: '',
    };
  }
  if (rangeType === 'special') {
    return { units: 'spec', override: false, special: text(form.rangeSpecial) };
  }
  return { units: rangeType, override: false, special: '' };
}

function buildTarget(form = {}) {
  const areaType = text(form.areaType);
  const target = {
    affects: {
      type: text(form.targetType) || 'creature',
      count: text(form.targetCount),
      choice: false,
      special: '',
    },
    template: {
      contiguous: false,
      units: text(form.areaUnits) || 'ft',
      count: '',
      type: areaType,
      size: areaType ? text(form.areaSize) : '',
    },
    override: false,
    prompt: true,
  };
  if (text(form.areaWidth)) target.template.width = text(form.areaWidth);
  if (text(form.areaHeight)) target.template.height = text(form.areaHeight);
  return target;
}

function requireFormula(form) {
  const formula = text(form?.formula);
  if (!formula) throw new Error('주사위식을 입력하십시오.');
  return formula;
}

export function buildQuickActivityData(purpose, form = {}) {
  if (purpose === 'heal') {
    const formula = requireFormula(form);
    return {
      type: 'heal',
      data: {
        name: text(form.name) || '회복 효과',
        range: buildRange(form),
        target: buildTarget(form),
        healing: {
          custom: { enabled: true, formula },
          types: [text(form.healingType) || 'healing'],
          scaling: { number: 1 },
        },
      },
    };
  }

  if (purpose === 'save') {
    const formula = requireFormula(form);
    const saveAbility = text(form.saveAbility);
    const saveDc = text(form.saveDc);
    if (!saveAbility || !saveDc) throw new Error('내성 능력치와 내성 DC를 입력하십시오.');
    return {
      type: 'save',
      data: {
        name: text(form.name) || '내성 공격',
        range: buildRange(form),
        target: buildTarget(form),
        damage: {
          onSave: text(form.onSave) || 'half',
          parts: [damagePartFromFormula(formula, text(form.damageType) || 'none')],
        },
        save: {
          ability: [saveAbility],
          dc: { formula: saveDc, calculation: '' },
        },
      },
    };
  }

  throw new Error(`빠른 추가에서 지원하지 않는 목적입니다: ${purpose}`);
}

export async function appendQuickDamage(activity, form = {}) {
  if (!activity?.update || !['attack', 'damage', 'save'].includes(activity.type)) {
    throw new Error('현재 선택된 액티비티에는 추가 피해를 적용할 수 없습니다.');
  }
  const formula = requireFormula(form);
  const source = typeof activity.toObject === 'function' ? activity.toObject() : activity;
  const current = Array.isArray(source?.damage?.parts)
    ? source.damage.parts.map((part) => structuredClone(part))
    : [];
  current.push(damagePartFromFormula(formula, text(form.damageType) || 'none'));
  await activity.update({ 'damage.parts': current });
  return current;
}
