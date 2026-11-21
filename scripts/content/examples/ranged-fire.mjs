import { content } from "../index.mjs";

const MODULE_ID = "nihil-compendium-module";
const CHARM = "ranged-fire-charm";
const BURN = "ranged-fire-burn";
const pendingBurns = new Map();
const macro = (method) =>
  `function.game.modules.get("${MODULE_ID}").api.examples.${method}`;

export function isRangedWeaponAttack(workflow) {
  return (
    !workflow?.aborted &&
    !workflow?.isFumble &&
    workflow.item?.type === "weapon" &&
    ["simpleR", "martialR"].includes(workflow.item.system?.type?.value) &&
    workflow.activity?.type === "attack" &&
    workflow.activity.attack?.type?.value === "ranged"
  );
}

export function hasFireCharm(actor) {
  return [...(actor?.items ?? [])].some(
    (item) =>
      item.flags?.[MODULE_ID]?.example === CHARM &&
      item.system.quantity > 0 &&
      [...(item.effects ?? [])].some(
        (effect) => effect.transfer && !effect.disabled && !effect.isSuppressed,
      ),
  );
}

export function rangedFireBonus({ workflow }) {
  if (!isRangedWeaponAttack(workflow) || !hasFireCharm(workflow.actor))
    return {};
  return { damageRoll: "2d6", damageType: "fire", flavor: "화염 사격 부적" };
}

export function buildRangedFireBurn(origin) {
  return {
    name: "화염 사격 — 연소",
    img: "icons/magic/fire/flame-burning-eye.webp",
    origin,
    transfer: false,
    disabled: false,
    description:
      "<p>자신의 턴 시작마다 1d4 화염 피해. 중첩되지 않으며 GM이 효과를 제거하면 종료됩니다.</p>",
    system: {
      changes: [
        {
          key: "flags.midi-qol.OverTime",
          type: "override",
          value:
            "turn=start,damageRoll=1d4,damageType=fire,label=화염 사격 연소,allowIncapacitated=true",
          priority: 20,
        },
      ],
    },
    flags: { [MODULE_ID]: { example: BURN } },
  };
}

async function applyBurnToActor(
  actor,
  origin,
) {
  if (pendingBurns.has(actor.uuid)) return pendingBurns.get(actor.uuid);
  const pending = (async () => {
    if (
      [...actor.effects].some(
        (effect) =>
          effect.flags?.[MODULE_ID]?.example === BURN && !effect.disabled,
      )
    )
      return;
    const effects = [buildRangedFireBurn(origin)];
    if (globalThis.game.user.isGM) {
      return actor.createEmbeddedDocuments(
        "ActiveEffect",
        effects,
      );
    }
    return globalThis.MidiQOL.socket().executeAsGM(
      "createEffects",
      {
        actorUuid: actor.uuid,
        effects,
      },
    );
  })();
  pendingBurns.set(
    actor.uuid,
    pending,
  );
  try {
    return await pending;
  } finally {
    pendingBurns.delete(actor.uuid);
  }
}

export async function applyRangedFireBurn({ workflow }) {
  if (!isRangedWeaponAttack(workflow) || !hasFireCharm(workflow.actor)) return;
  const actors = new Map();
  for (const token of workflow.hitTargets ?? []) {
    if (token.actor) actors.set(
      token.actor.uuid,
      token.actor,
    );
  }
  for (const actor of actors.values())
    await applyBurnToActor(
      actor,
      workflow.item.uuid,
    );
}

/** GM이 잠금을 해제한 모듈 팩에 시험 아이템 두 개를 한 번 생성합니다. */
export async function createRangedFireExample({
  packId = `${MODULE_ID}.common-items`,
} = {}) {
  for (const id of ["midi-qol", "dae"]) {
    if (!globalThis.game?.modules?.get(id)?.active)
      throw new Error(`${id} 모듈이 필요합니다.`);
  }
  const pack = content.requireWritablePack(
    packId,
    "Item",
  );
  const keys = ["example.ranged-fire-charm", "example.longbow"];
  const documents = await pack.getDocuments();
  if (
    documents.some((item) => keys.includes(item.flags?.[MODULE_ID]?.contentKey))
  )
    throw new Error(
      "시험 아이템이 이미 존재합니다. 기존 데이터를 확인하십시오.",
    );

  const charm = await content.createLoot(
    {
      name: "화염 사격 부적",
      img: "icons/equipment/neck/pendant-round-silver-red.webp",
      flags: { [MODULE_ID]: { example: CHARM } },
      system: {
        quantity: 1,
        description: {
          value:
            "<p>소지하면 원거리 무기의 공격에 2d6 화염 피해를 추가합니다. 적중한 대상에게 연소를 부여하여 대상의 턴 시작마다 1d4 화염 피해를 줍니다.</p><p>장착·조율이 필요하지 않습니다. 연소는 중첩되지 않으며 효과를 직접 제거할 때까지 유지됩니다. 추가 피해는 치명타에도 2d6입니다. Midi-QOL과 DAE가 필요합니다.</p>",
        },
      },
    },
    { packId, contentKey: keys[0] },
  );
  await content.createPassiveEffect(
    charm,
    {
      name: "화염 사격 — 소지 효과",
      img: charm.img,
      changes: [
        {
          key: "flags.dnd5e.DamageBonusMacro",
          type: "custom",
          value: macro("rangedFireBonus"),
        },
        {
          key: "flags.midi-qol.onUseMacroName",
          type: "custom",
          value: `${macro("applyRangedFireBurn")},postActiveEffects`,
        },
      ],
    },
  );
  const weapon = await content.createWeapon(
    {
      name: "원거리 무기",
      img: "icons/weapons/bows/longbow-leather-green.webp",
      flags: { [MODULE_ID]: { example: "longbow" } },
      system: {
        description: {
          value:
            "<p>시험용 장궁. 1d8 관통 피해에 민첩 수정치를 더합니다. 사거리 150/600피트, 탄약·중량형·양손 무기입니다.</p>",
        },
        type: { value: "martialR", baseItem: "longbow" },
        quantity: 1,
        equipped: true,
        proficient: 1,
        properties: ["amm", "hvy", "two"],
        range: { value: 150, long: 600, units: "ft" },
        damage: { base: { number: 1, denomination: 8, types: ["piercing"] } },
      },
    },
    { packId, contentKey: keys[1] },
  );
  // D&D5e가 새 무기에 넣는 기본 공격을 명시적인 시험 액티비티로 교체한다.
  for (const activity of [...weapon.system.activities]) {
    await weapon.deleteActivity(activity.id);
  }
  await content.createAttackActivity(
    weapon,
    {
      name: "원거리 공격",
      activation: { type: "action", value: 1 },
      attack: {
        ability: "dex",
        type: { value: "ranged", classification: "weapon" },
      },
      damage: { includeBase: true },
      target: { affects: { type: "creature", count: "1" } },
    },
  );
  return { charm, weapon };
}

export const examples = Object.freeze({
  createRangedFireExample,
  rangedFireBonus,
  applyRangedFireBurn,
});

