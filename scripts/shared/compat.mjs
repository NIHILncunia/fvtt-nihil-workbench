export function foundryGeneration() {
  return Number(globalThis.game?.release?.generation ?? 14);
}

export function isFoundry14() {
  return foundryGeneration() >= 14;
}

export function isDnd5e6() {
  const version = globalThis.game?.system?.version;
  if (!version) return isFoundry14();
  return Number.parseInt(
    version,
    10,
  ) >= 6;
}

export function deletionEntry(path) {
  if (isFoundry14()) {
    const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
    const operator = globalThis._del ?? (ForcedDeletion ? new ForcedDeletion() : null);
    if (operator) return [path, operator];
  }
  const keys = String(path).split('.');
  const key = keys.pop();
  return [[...keys, `-=${key}`].join('.'), null];
}

export function ownershipReplacement() {
  if (!isFoundry14()) return null;
  return globalThis._replace ?? globalThis.foundry?.data?.operators?.ForcedReplacement?.create;
}

export function directoryContextOption({ label, icon, visible, onClick }) {
  if (isFoundry14()) return { label, icon, visible, onClick };
  return {
    name: label,
    icon,
    condition: visible,
    callback: (entry) => onClick(
      null,
      entry,
    ),
  };
}

export function sceneBackgroundData(
  src,
  color,
  { dotted = false } = {},
) {
  if (isFoundry14()) return {};
  return dotted ? { 'background.src': src, backgroundColor: color } : { background: { src }, backgroundColor: color };
}

export function readSceneBackground(source) {
  if (!isFoundry14()) return { src: source.background?.src, color: source.backgroundColor, levelId: null };
  const levels = source.levels ?? [];
  const level = levels.find((entry) => entry._id === source.initialLevel) ?? levels[0];
  return { src: level?.background?.src, color: level?.background?.color, levelId: level?._id ?? null };
}

export function sceneBackgroundSource(
  scene,
  levelId = null,
) {
  if (!scene) return null;
  if (!isFoundry14()) {
    const src = scene.background?.src ?? scene._source?.background?.src ?? scene._source?.img;
    return src ? String(src).trim() : null;
  }
  const level = (levelId && scene.levels?.get?.(levelId)) || scene.initialLevel || scene.firstLevel || null;
  const src = level?.background?.src ?? level?.textures?.background?.src ?? scene._source?.background?.src ?? scene._source?.img ?? null;
  return src ? String(src).trim() : null;
}

export async function saveSceneLevelBackground(
  scene,
  background,
  previousSrc,
) {
  if (!isFoundry14()) return { levelId: null, previousSrc };
  const level = scene.levels?.get?.(scene.initialLevel) ?? scene.levels?.contents?.[0];
  if (!level) throw new Error('씬의 레벨을 찾지 못해 배경을 넣지 못했습니다.');
  const oldSrc = level.background?.src ?? null;
  await level.update(background);
  return { levelId: level.id, previousSrc: oldSrc };
}

export function sceneBackgroundBeforeSave(scene) {
  return isFoundry14() ? null : sceneBackgroundSource(scene);
}

export function sceneThumbnailOptions(levelId) {
  return isFoundry14() && levelId ? { level: levelId } : {};
}

export function resolveHitPointAnchor(root) {
  const selector = isDnd5e6()
    ? '.sheet-header .meter.hit-points, .meter.hit-points'
    : '.sheet-header .meter.hit-points.sectioned, .sheet-header .meter.hit-points';
  return root.querySelector(selector);
}

export function registerResolveStatus(status) {
  const config = globalThis.CONFIG ??= {};
  const statuses = config.statusEffects ??= isFoundry14() ? {} : [];
  if (isFoundry14()) statuses[status.id] ??= status;
  else if (!statuses.some((entry) => entry.id === status.id)) statuses.push(status);
}

export function resolvePcEffectDisplay(id) {
  const statuses = globalThis.CONFIG?.statusEffects;
  if (!isFoundry14()) return { img: statuses?.find((entry) => entry.id === id)?.img };
  return { img: statuses?.[id]?.img, showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS };
}

const LEGACY_FEATURES = Object.freeze({
  'nihil-secret-hp': '비밀 HP',
  'luxterra-resource-manager': '자원 관리',
});
const notified = new Set();

export function isModuleActive(id) {
  return globalThis.game?.modules?.get?.(id)?.active === true;
}

export function usesLegacyModule(id) {
  return !isFoundry14() && isModuleActive(id);
}

export function notifyLegacyFeature(id) {
  if (!usesLegacyModule(id) || !globalThis.game?.user?.isGM || notified.has(id) || !globalThis.ui?.notifications?.warn) return;
  globalThis.ui.notifications.warn(`옛 모듈이 켜져 있어 워크벤치의 ${LEGACY_FEATURES[id]} 기능을 쉽니다.`);
  notified.add(id);
}

export function senseRangePath(key) {
  return `system.attributes.senses.${isDnd5e6() ? 'ranges.' : ''}${key}`;
}

export function senseRangeSource(
  source,
  ranges,
) {
  if (!isDnd5e6()) {
    delete source.ranges;
    return { ...source, ...ranges };
  }
  if (Object.keys(ranges).length || source.ranges) source.ranges = ranges;
  return source;
}

export function armorClassFields(choices) {
  if (!isDnd5e6()) return [
    ['system.attributes.ac.calc', 'AC 계산 방식', 'text', { choices }],
    ['system.attributes.ac.formula', '사용자 AC 공식', 'text'],
  ];
  return [
    ['system.attributes.ac.calcs', 'AC 계산 방식(여러 개 선택 시 가장 높은 값)', 'set', { choices }],
    ['system.attributes.ac.formulas', '사용자 AC 공식 목록(JSON, 예: [{"formula":"12 + @abilities.dex.mod","label":"비늘"}])', 'json'],
    ['system.attributes.ac.override', 'AC 고정값(입력하면 계산을 무시)', 'number', { min: 0, integer: true, nullable: true }],
  ];
}

export function legacyArmorClassSource(
  { calc, formula, calcs, formulas, override, ...data },
  choices,
) {
  if (override != null) return { ...data, calc: 'flat', flat: override };
  if (calc == null && (calcs != null || formulas != null)) {
    if (calcs != null && !Array.isArray(calcs)) throw new TypeError('AC 계산 방식을 배열로 전달하십시오.');
    if (formulas != null && !Array.isArray(formulas)) throw new TypeError('AC 공식을 배열로 전달하십시오.');
    if (formulas?.some((entry) => typeof entry?.formula !== 'string' || !entry.formula.trim()))
      throw new TypeError('AC 공식 항목에 formula 문자열을 넣으십시오.');
    const candidates = (calcs ?? []).filter((id) => id !== 'unarmored' && id !== 'armored');
    if (candidates.length > 1 || (formulas?.length ?? 0) > 1 || (candidates.length && formulas?.length))
      throw new Error('이 판의 AC는 계산 방식이나 사용자 공식 하나만 저장할 수 있습니다.');
    calc = formulas?.length ? 'custom' : candidates[0] ?? 'default';
    formula ??= formulas?.[0]?.formula;
  }
  if (calc != null && !(calc in choices)) throw new Error('지원하지 않는 AC 계산 방식입니다.');
  if (calc === 'custom' && !formula) throw new Error('사용자 AC 공식을 전달하십시오.');
  if (calc === 'flat' && data.flat == null) throw new Error('고정 AC 값을 전달하십시오.');
  return { ...data, ...(calc != null ? { calc } : {}), ...(formula != null ? { formula } : {}) };
}

export function detectionModeSource(entries) {
  if (!isFoundry14()) return entries;
  return Object.fromEntries(entries.map(({ id, ...mode }) => [id, mode]));
}

export function hasKeyedDetectionModes() {
  return isFoundry14();
}

export function usesLegacyAdvancementArray(raw) {
  return Array.isArray(raw) || (raw == null && !isDnd5e6());
}

export function effectChangesPath() {
  return isFoundry14() ? 'system.changes' : 'changes';
}

const LEGACY_MODES = Object.freeze(['custom', 'multiply', 'add', 'downgrade', 'upgrade', 'override']);

export function legacyModeType(mode) {
  const number = Number(mode);
  if (mode === '' || mode == null || !Number.isInteger(number)) return null;
  return LEGACY_MODES[number] ?? `custom.${number}`;
}

export function effectChangeForWrite(change) {
  if (isFoundry14()) return change;
  const { type, phase: _phase, value, ...rest } = change;
  if (value && typeof value === 'object') throw new Error('이 판의 효과 변경값은 문자열을 사용합니다.');
  if (type === 'subtract' && String(value).trim() && Number.isFinite(Number(value))) {
    return { ...rest, mode: 2, value: String(-Number(value)) };
  }
  if (!effectChangeIsSupported(type)) {
    throw new Error(`이 판에서 지원하지 않는 효과 적용 방식입니다: ${type}`);
  }
  const mode = type.startsWith('custom.') ? Number(type.slice('custom.'.length)) : LEGACY_MODES.indexOf(type);
  return { ...rest, mode, value: String(value ?? '') };
}

export function effectChangeIsSupported(type) {
  return isFoundry14() || LEGACY_MODES.includes(type) || /^custom\.-?\d+$/.test(type);
}

export function isLegacyEffectMode(change) {
  return !isFoundry14() && Number.isInteger(change.mode);
}

export function newEffectChange() {
  return isFoundry14()
    ? { key: '', type: 'add', value: '', phase: 'initial', priority: null }
    : { key: '', mode: 2, value: '', priority: 20 };
}

export function effectSourceWithChanges(
  source,
  changes,
) {
  delete source.changes;
  if (isFoundry14()) {
    if (changes) source.system = { ...(source.system ?? {}), changes };
  } else {
    if (source.system) delete source.system.changes;
    if (changes) source.changes = changes;
    if (source.showIcon != null) {
      if (source.showIcon === 0) throw new Error('이 판에서는 효과 아이콘을 숨기는 옵션을 지원하지 않습니다.');
      if (source.showIcon === 2) {
        source.flags = { ...source.flags, dae: { ...source.flags?.dae, showIcon: true } };
      }
      delete source.showIcon;
    }
  }
  return source;
}

export function usesCoreEffectIcon() {
  return isFoundry14();
}

export function usesStructuredEffectDuration() {
  return isFoundry14();
}

export function effectTimingForWrite(
  input,
  duration,
  start,
  explicitStart,
) {
  if (isFoundry14()) return { duration, start };
  const legacy = {};
  const secondsPerUnit = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
  if (duration.expiry) throw new Error('이 판에서는 효과의 만료 시점을 따로 저장할 수 없습니다.');
  if (input.value != null) {
    const unit = duration.units ?? 'seconds';
    if (unit === 'rounds' || unit === 'turns') legacy[unit] = duration.value;
    else if (secondsPerUnit[unit]) legacy.seconds = duration.value * secondsPerUnit[unit];
    else throw new Error('이 판에서는 효과의 년·달 단위를 저장할 수 없습니다.');
  } else {
    for (const key of ['seconds', 'rounds', 'turns']) {
      if (input[key] != null) legacy[key] = input[key];
    }
  }
  for (const [key, value] of Object.entries({ ...start, ...explicitStart })) {
    const field = { time: 'startTime', round: 'startRound', turn: 'startTurn', combat: 'combat' }[key];
    if (field) legacy[field] = value;
    else if (value != null) throw new Error('이 판에서는 효과 시작 정보에 전투원·이니셔티브를 저장할 수 없습니다.');
  }
  if (legacy.seconds != null && !Number.isInteger(legacy.seconds)) throw new Error('지속 초는 정수로 입력하십시오.');
  return { duration: legacy, start: null };
}

export function needsEffectTiming(source) {
  return Boolean(source.duration || (!isFoundry14() && source.start));
}

export function applyEffectTiming(
  source,
  { duration, start },
) {
  source.duration = duration;
  if (!isFoundry14()) delete source.start;
  else if (start && source.start == null)
    source.start = { time: globalThis.game?.time?.worldTime ?? 0, ...start };
}

export function effectStartPatch(
  patch,
  source,
  worldTime = globalThis.game?.time?.worldTime ?? 0,
) {
  if (!isFoundry14()) return patch;
  const keys = Object.keys(patch).filter((key) => key.startsWith('start.'));
  if (!keys.length || source?.start) return patch;
  const start = { combat: null, combatant: null, initiative: null, round: null, turn: null, time: worldTime };
  const next = { ...patch };
  for (const key of keys) {
    const value = next[key];
    delete next[key];
    start[key.slice('start.'.length)] = value;
  }
  if (start.time == null) start.time = worldTime;
  next.start = start;
  return next;
}
