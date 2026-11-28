import { effectChangeIsSupported, isLegacyEffectMode, legacyModeType } from './compat.mjs';

export { legacyModeType };

// Foundry v14 활성 효과 변경값(EffectChangeData) 도우미.
// v14는 변경값을 `system.changes`에 두고, 적용 방식을 숫자 `mode` 대신 문자열 `type`으로 저장한다.
// dnd5e 6.x는 CONFIG.ActiveEffect.changeTypes에 시스템 규칙형 변경 종류를 더한다.

const CORE_TYPES = Object.freeze({
  custom: 0,
  multiply: 10,
  add: 20,
  subtract: 20,
  downgrade: 30,
  upgrade: 40,
  override: 50,
});

const CORE_LABELS = Object.freeze({
  custom: '사용자 지정',
  multiply: '곱하기',
  add: '더하기',
  subtract: '빼기',
  downgrade: '하향 적용',
  upgrade: '상향 적용',
  override: '덮어쓰기',
});

export function isEffectChangesPath(path) {
  return path === 'system.changes' || path === 'changes';
}

export function changeTypeOf(change) {
  if (typeof change?.type === 'string' && change.type) return change.type;
  return legacyModeType(change?.mode) ?? 'add';
}

export function isValidChangeType(type) {
  if (typeof type !== 'string' || type.length < 3) return false;
  return /^custom\.-?\d+$/.test(type) || type.split('.').every((part) => /^[a-z0-9]+$/i.test(part));
}

// 숫자 mode를 type으로 바꾸고 mode 키를 없앤 v14 변경값.
export function normalizeEffectChange(change = {}) {
  const { mode, ...rest } = change;
  return { ...rest, type: changeTypeOf(change) };
}

export function effectChangesOf(source) {
  const changes = source?.system?.changes ?? source?.changes;
  return Array.isArray(changes) ? changes : [];
}

function localize(text) {
  return globalThis.game?.i18n?.localize?.(text) ?? text;
}

export function effectChangeTypes() {
  const core = globalThis.CONST?.ACTIVE_EFFECT_CHANGE_TYPES ?? CORE_TYPES;
  const entries = Object.keys(core).map((value) => ({
    value,
    label: CORE_LABELS[value] ?? value,
  }));
  for (const [value, config] of Object.entries(globalThis.CONFIG?.ActiveEffect?.changeTypes ?? {})) {
    if (entries.some((entry) => entry.value === value)) continue;
    const label = typeof config === 'string' ? config : config?.label;
    entries.push({ value, label: label ? `${localize(label)} (${value})` : value });
  }
  return entries;
}

export function effectChangeTypeOptions(selected) {
  const options = effectChangeTypes().filter((option) => effectChangeIsSupported(option.value));
  if (selected && !options.some((option) => option.value === selected))
    options.push({ value: selected, label: `기존 설정 (${selected})` });
  return options.map((option) => ({ ...option, selected: option.value === selected }));
}

export function isValidStoredEffectChange(change) {
  return isValidChangeType(change.type) || isLegacyEffectMode(change);
}
