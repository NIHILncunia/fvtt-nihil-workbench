// HP 비밀 변경(2026-11-21 이관): v13 nihil-secret-hp 0.2.0을 Foundry v14·dnd5e 6.1에 맞춰 워크벤치로 옮겼다.
//
// GM이 플레이어 소유자가 없는 액터의 HP를 시트(액터 시트, 히트 포인트 창)에서 고치거나,
// 어떤 방법으로든 최대 HP를 바꾸면 그 변경을 채팅과 토큰에 드러내지 않는다.
// - 그 갱신이 만든 Health Monitor 채팅 메시지를 막는다(모듈이 있을 때).
// - dnd5e의 떠오르는 HP 숫자, 집중 내성 요구, dnd5e.damageActor/healActor 훅을 건너뛴다
//   (dnd5e 6.1 onUpdateHP가 `isRest` 옵션을 보고 건너뛴다).
// - Bloodied 상태는 그대로 붙고 떨어지지만 떠오르는 글자는 띄우지 않는다(animate: false).
// 현재 HP는 최대 HP를 따라 오르지 않는다. 새 최대가 현재 HP보다 작으면 현재 HP를 새 최대로 낮춘다.
// 갱신을 만든 클라이언트(GM)만 이 훅을 실행한다.

const PATCHED = Symbol.for("nihil-compendium-module.secret-hp-patched");

export const MODULE_ID = "nihil-compendium-module";
export const SECRET_HP_SETTING = "secretHpEnabled";
/** 비밀 변경으로 처리한 갱신에 붙이는 옵션 표시. */
export const SECRET_HP_OPTION = "ncmSecretHp";

const HP_PATH = "system.attributes.hp";
const PENDING_MS = 2000;
const BLOODIED_STATUS = "bloodied";

/**
 * Actor uuid -> { names, budget, until }.
 * `budget` is how many Health Monitor messages the secret update may still cause.
 */
const pending = new Map();

/** Actor uuid -> time until which its next HP update counts as a hand edit. */
const handEdits = new Map();
const HAND_EDIT_MS = 1500;

function markHandEdit(actor) {
  handEdits.set(
    actor.uuid,
    Date.now() + HAND_EDIT_MS
  );
}

function takeHandEdit(actor) {
  const until = handEdits.get(actor.uuid);
  handEdits.delete(actor.uuid);
  return !!until && (until >= Date.now());
}

function enabled() {
  try {
    return game.settings.get(
      MODULE_ID,
      SECRET_HP_SETTING
    ) !== false;
  } catch {
    return true;
  }
}

function prunePending() {
  const now = Date.now();
  for (const [key, entry] of pending) {
    if (entry.until < now) pending.delete(key);
  }
}

function actorNames(actor) {
  const names = new Set([actor.name]);
  if (actor.token?.name) names.add(actor.token.name);
  for (const token of actor.getActiveTokens(
    false,
    true
  )) {
    if (token.name) names.add(token.name);
  }
  return names;
}

function sourceHp(actor) {
  return foundry.utils.getProperty(
    actor,
    `_source.${HP_PATH}`
  ) ?? foundry.utils.getProperty(
    actor,
    HP_PATH
  ) ?? {};
}

function isSecretActor(actor) {
  return !!game.user?.isGM && enabled() && !actor.hasPlayerOwner;
}

/**
 * The new max HP if this update changes it, otherwise null.
 * @returns {number|null}
 */
export function changedMax(actor, changes) {
  const hpChange = foundry.utils.getProperty(
    changes,
    HP_PATH
  );
  if (!hpChange || !("max" in hpChange)) return null;

  const newMax = Number(hpChange.max);
  if (!Number.isFinite(newMax)) return null;

  const oldMax = Number(sourceHp(actor).max);
  if (newMax === oldMax) return null;
  return newMax;
}

/**
 * How many messages Health Monitor makes for this HP change.
 * Mirrors health-monitor/scripts/main.js: one each for hp, max and gained temp HP.
 */
export function healthMonitorMessageCount(oldHp, newHp) {
  const deltas = {};
  if ("value" in newHp) deltas.hp = Number(newHp.value) - Number(oldHp.value);
  if ("max" in newHp) deltas.max = Number(newHp.max) - Number(oldHp.max);
  if ("temp" in newHp) deltas.temp = Number(newHp.temp) - Number(oldHp.temp);
  if (deltas.temp < 0) deltas.hp = (deltas.hp || 0) + deltas.temp;
  let count = 0;
  for (const [key, delta] of Object.entries(deltas)) {
    if (!delta || Number.isNaN(delta)) continue;
    if ((key === "temp") && (delta < 0)) continue;
    count += 1;
  }
  return count;
}

function onPreUpdateActor(actor, changes, options) {
  prunePending();
  const handEdit = takeHandEdit(actor);
  if (!isSecretActor(actor)) return;
  if (!foundry.utils.getProperty(
    changes,
    HP_PATH
  )) return;

  const newMax = changedMax(
    actor,
    changes
  );
  if (!handEdit && (newMax === null)) return;

  // Lower current HP to the new max when the max drops below it.
  const valuePath = `${HP_PATH}.value`;
  const nextValue = foundry.utils.getProperty(
    changes,
    valuePath
  ) ?? sourceHp(actor).value;
  if ((newMax !== null) && Number.isFinite(Number(nextValue)) && (Number(nextValue) > newMax)) {
    foundry.utils.setProperty(
      changes,
      valuePath,
      Math.max(
        newMax,
        0
      )
    );
  }

  options.isRest = true;
  options[SECRET_HP_OPTION] = true;

  const oldHp = foundry.utils.getProperty(
    actor,
    HP_PATH
  ) ?? {};
  const newHp = foundry.utils.getProperty(
    changes,
    HP_PATH
  );
  pending.set(
    actor.uuid,
    {
      names: actorNames(actor),
      // +1 covers Health Monitor reading the update before the HP was lowered.
      budget: healthMonitorMessageCount(
        oldHp,
        newHp
      ) + 1,
      until: Date.now() + PENDING_MS
    }
  );
}

/** Health Monitor writes "<name> <verb> <amount> <noun>" inside `.hm-message`. */
export function isHealthMonitorMessageFor(content, names) {
  if (!content?.includes("hm-message")) return false;
  const text = content.replace(
    /<[^>]+>/g,
    " "
  ).replace(
    /\s+/g,
    " "
  ).trim();
  for (const name of names) {
    if (name && text.startsWith(`${name} `)) return true;
  }
  return false;
}

function onPreCreateChatMessage(message, data) {
  if (!game.user?.isGM) return;
  prunePending();
  if (!pending.size) return;

  const content = data?.content ?? message.content;
  for (const entry of pending.values()) {
    if (entry.budget <= 0) continue;
    if (!isHealthMonitorMessageFor(
      content,
      entry.names
    )) continue;
    entry.budget -= 1;
    return false;
  }
}

function silenceBloodied(effect, options) {
  if (!game.user?.isGM) return;
  const actor = effect.parent;
  const entry = actor ? pending.get(actor.uuid) : null;
  if (!entry || (entry.until < Date.now())) return;
  if (!effect.statuses?.has(BLOODIED_STATUS)) return;
  options.animate = false;
}

/**
 * The dnd5e HP dialog adds the max change to current HP. For a secret max
 * change, keep the current HP the GM entered instead.
 */
function patchHitPointsConfig() {
  const cls = globalThis.dnd5e?.applications?.actor?.HitPointsConfig;
  const proto = cls?.prototype;
  if (!proto?._processSubmitData || Object.hasOwn(proto, PATCHED)) return;

  const original = proto._processSubmitData;
  proto._processSubmitData = function (event, form, submitData) {
    const actor = this.document;
    const submittedMax = Number(foundry.utils.getProperty(
      submitData,
      `${HP_PATH}.max`
    ));
    const { value, max } = actor?.system?.attributes?.hp ?? {};
    if (actor && isSecretActor(actor) && Number.isFinite(submittedMax) && (submittedMax !== max)) {
      const current = foundry.utils.getProperty(
        submitData,
        `${HP_PATH}.value`
      ) ?? value;
      // dnd5e will add (max - old max) back; cancel it out in advance.
      foundry.utils.setProperty(
        submitData,
        `${HP_PATH}.value`,
        Number(current) - (submittedMax - max)
      );
    }
    return original.call(
      this,
      event,
      form,
      submitData
    );
  };
  proto[PATCHED] = true;
}

/**
 * Any document sheet (actor sheet, hit points window) that submits HP for a
 * secret actor marks the next update of that actor as a hand edit.
 */
function patchDocumentSheets() {
  const proto = foundry.applications?.api?.DocumentSheetV2?.prototype;
  if (!proto?._processSubmitData || Object.hasOwn(proto, PATCHED)) return;

  const original = proto._processSubmitData;
  proto._processSubmitData = function (event, form, submitData, options) {
    const actor = this.document;
    if ((actor?.documentName === "Actor") && isSecretActor(actor) && foundry.utils.getProperty(
      submitData,
      HP_PATH
    )) {
      markHandEdit(actor);
    }
    return original.call(
      this,
      event,
      form,
      submitData,
      options
    );
  };
  proto[PATCHED] = true;
}

function patchAll() {
  patchHitPointsConfig();
  patchDocumentSheets();
}

export function registerSecretHpSettings() {
  const settings = globalThis.game?.settings;
  if (!settings?.register) return false;
  settings.register(
    MODULE_ID,
    SECRET_HP_SETTING,
    {
      name: "HP 비밀 변경",
      hint: "GM이 플레이어 소유자가 없는 액터의 HP를 시트·히트 포인트 창에서 고치거나 최대 HP를 바꿀 때 Health Monitor 메시지, 토큰 위 숫자, 집중 내성 요구를 남기지 않습니다. 현재 HP가 새 최대보다 크면 최대에 맞춰 낮춥니다.",
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: true
    }
  );
  return true;
}

let registered = false;

/** init 단계에서 한 번 부른다. */
export function registerSecretHp() {
  if (registered || !globalThis.Hooks?.on) return false;
  registerSecretHpSettings();
  Hooks.once("ready", patchAll);
  if (globalThis.game?.ready) patchAll();
  Hooks.on("preUpdateActor", onPreUpdateActor);
  Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
  Hooks.on("preCreateActiveEffect", (effect, data, options) => silenceBloodied(effect, options));
  Hooks.on("preDeleteActiveEffect", (effect, options) => silenceBloodied(effect, options));
  registered = true;
  return true;
}
