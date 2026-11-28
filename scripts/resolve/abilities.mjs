// 투지·의지 내성(2026-11-28): dnd5e 능력치로 등록해 NPC 시트 능력치 줄, 수정 모드, 내성 굴림,
// Token Action HUD 「속성」 탭에 근력~매력과 같은 모양으로 나오게 한다. PC에는 두지 않는다.
export const RESOLVE_ABILITIES = Object.freeze({
  투지: 'grit',
  의지: 'will',
});

// RT-07 사기 판정과 같은 DC(2024 DMG 경보 반응의 DC 10 지혜 내성 형식).
export const RESOLVE_SAVE_DC = 10;

const KEYS = Object.values(RESOLVE_ABILITIES);
let patched = false;

export function resolveAbilityKey(axis) {
  return RESOLVE_ABILITIES[axis] ?? null;
}

/** CONFIG.DND5E.abilities에 투지·의지를 더한다. 지혜 항목을 본떠 정신 능력치로 둔다. */
export function registerResolveAbilities(config = globalThis.CONFIG?.DND5E) {
  const abilities = config?.abilities;
  if (!abilities) return false;
  const base = abilities.wis ?? {};
  for (const [label, key] of Object.entries(RESOLVE_ABILITIES)) {
    if (abilities[key]) continue;
    abilities[key] = {
      ...base,
      label,
      abbreviation: label,
      fullKey: key,
      type: 'mental',
      reference: undefined,
      improvement: false,
      // 투지·의지는 0부터 시작한다(2026-11-28 마스터).
      defaults: { npc: 0, character: 0, vehicle: 0 },
    };
  }
  return true;
}

function initialAbilitySource(
  model,
  key,
) {
  const field = model.schema.fields.abilities;
  return field._getInitialValueForKey?.(key) ?? field.element.getInitialValue();
}

/**
 * 투지·의지에는 보정치가 없다(2026-11-28 마스터). 점수를 그대로 내성에 더하도록
 * dnd5e가 (점수-10)/2로 계산한 보정치를 점수로 바꾸고 판정·내성·DC를 같은 만큼 옮긴다.
 */
export function applyRawScore(ability) {
  if (!ability) return false;
  const value = Number(ability.value) || 0;
  const delta = value - (Number(ability.mod) || 0);
  ability.mod = value;
  if (ability.check && Number.isFinite(ability.check.value)) ability.check.value += delta;
  if (ability.save && Number.isFinite(ability.save.value)) ability.save.value += delta;
  if (Number.isFinite(ability.dc)) ability.dc += delta;
  return true;
}

/**
 * dnd5e 6.1.1의 능력치 칸은 initialKeysOnly라 설정된 능력치를 모든 생물에 채운다.
 * NPC에는 그대로 두고(저장 전에는 기본값 10), PC·탈것 등에서는 준비 단계에서 뺀다.
 */
export function patchNonNpcAbilities(models = globalThis.CONFIG?.Actor?.dataModels) {
  if (patched || !models) return false;
  patched = true;
  const Npc = models.npc;
  if (typeof Npc?.prototype?.prepareAbilities === 'function') {
    const prepareAbilities = Npc.prototype.prepareAbilities;
    Npc.prototype.prepareAbilities = function prepareAbilitiesWithResolve(...args) {
      const result = prepareAbilities.apply(this, args);
      for (const key of KEYS) applyRawScore(this.abilities?.[key]);
      return result;
    };
  }
  for (const [type, Model] of Object.entries(models)) {
    if (type === 'npc' || typeof Model?.prototype?.prepareBaseData !== 'function') continue;
    const original = Model.prototype.prepareBaseData;
    Model.prototype.prepareBaseData = function prepareBaseDataWithoutResolve(...args) {
      if (this.abilities) {
        for (const key of KEYS) delete this.abilities[key];
      }
      return original.apply(this, args);
    };
  }
  return true;
}

/** 처음 저장할 때 일부 칸만 오면 나머지 기본값을 함께 채워 저장한다. */
export function completeResolveAbilityUpdate(
  actor,
  changes,
) {
  if (actor?.type !== 'npc') return false;
  const incoming = changes?.system?.abilities;
  const flat = Object.keys(changes ?? {}).filter((path) => KEYS.some((key) => path.startsWith(`system.abilities.${key}.`)));
  if (!incoming && !flat.length) return false;
  const stored = actor._source?.system?.abilities ?? {};
  let changed = false;
  for (const key of KEYS) {
    const touched = incoming?.[key] || flat.some((path) => path.startsWith(`system.abilities.${key}.`));
    if (!touched || stored[key]) continue;
    const initial = initialAbilitySource(actor.system, key);
    const expanded = globalThis.foundry.utils.expandObject(changes);
    const merged = globalThis.foundry.utils.mergeObject(initial, expanded.system?.abilities?.[key] ?? {}, { inplace: false });
    for (const path of flat.filter((entry) => entry.startsWith(`system.abilities.${key}.`))) delete changes[path];
    globalThis.foundry.utils.setProperty(changes, `system.abilities.${key}`, merged);
    changed = true;
  }
  return changed;
}

/** PC·탈것 등 NPC가 아닌 새 액터에는 투지·의지를 저장하지 않는다. */
export function stripResolveAbilities(actor) {
  if (!actor || actor.type === 'npc') return false;
  const abilities = actor._source?.system?.abilities;
  if (!abilities || !KEYS.some((key) => key in abilities)) return false;
  const kept = Object.fromEntries(Object.entries(abilities).filter(([key]) => !KEYS.includes(key)));
  actor._source.system.abilities = kept;
  return true;
}

/** 투지·의지 내성을 굴려 견뎠는지 돌려준다. 창을 닫으면 null. */
export async function rollResolveSave(
  actor,
  axis,
) {
  const ability = resolveAbilityKey(axis);
  if (!ability || typeof actor?.rollSavingThrow !== 'function') return null;
  const rolls = await actor.rollSavingThrow({ ability, target: RESOLVE_SAVE_DC });
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  if (!roll) return null;
  const total = Number(roll.total);
  return {
    total,
    success: roll.isSuccess ?? total >= RESOLVE_SAVE_DC,
  };
}

export function registerResolveAbilityHooks(hooks = globalThis.Hooks) {
  registerResolveAbilities();
  patchNonNpcAbilities();
  // custom-dnd5e는 init 중 설정값으로 능력치 목록을 다시 만들 수 있어, 그 뒤에도 다시 더한다.
  for (const hook of ['setup', 'ready']) {
    hooks.once?.(
      hook,
      () => {
        registerResolveAbilities();
        patchNonNpcAbilities();
      },
    );
  }
  hooks.on(
    'preUpdateActor',
    (actor, changes) => {
      completeResolveAbilityUpdate(
        actor,
        changes,
      );
    },
  );
  hooks.on(
    'preCreateActor',
    (actor) => {
      stripResolveAbilities(actor);
    },
  );
}
