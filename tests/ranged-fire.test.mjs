import assert from "node:assert/strict";
import test from "node:test";
import {
  isRangedWeaponAttack,
  hasFireCharm,
  rangedFireBonus,
  buildRangedFireBurn,
  applyRangedFireBurn,
} from "../scripts/content/examples/ranged-fire.mjs";

const MODULE = "nihil-compendium-module";
function fixture() {
  const charm = {
    flags: { [MODULE]: { example: "ranged-fire-charm" } },
    system: { quantity: 1 },
    effects: [{ transfer: true, disabled: false, isSuppressed: false }],
  };
  return {
    actor: { items: [charm] },
    item: {
      type: "weapon",
      uuid: "Actor.attacker.Item.bow",
      system: { type: { value: "martialR" } },
    },
    activity: { type: "attack", attack: { type: { value: "ranged" } } },
    hitTargets: new Set(),
  };
}

test(
  "소지 수량과 활성 효과가 있어야 화염 피해가 추가된다",
  () => {
    const workflow = fixture();
    assert.deepEqual(
      rangedFireBonus({ workflow }),
      {
        damageRoll: "2d6",
        damageType: "fire",
        flavor: "화염 사격 부적",
      },
    );
    const charm = workflow.actor.items[0];
    for (const key of ["disabled", "isSuppressed"]) {
      charm.effects[0][key] = true;
      assert.equal(
        hasFireCharm(workflow.actor),
        false,
      );
      assert.deepEqual(
        rangedFireBonus({ workflow }),
        {},
      );
      charm.effects[0][key] = false;
    }
    charm.system.quantity = 0;
    assert.equal(
      hasFireCharm(workflow.actor),
      false,
    );
    workflow.actor.items = [];
    assert.deepEqual(
      rangedFireBonus({ workflow }),
      {},
    );
  },
);

test(
  "근접 무기 투척, 주문, 취소 및 실패 공격에는 적용하지 않는다",
  () => {
    for (const modify of [
      (w) => {
        w.item.system.type.value = "martialM";
      },
      (w) => {
        w.item.type = "spell";
      },
      (w) => {
        w.activity.type = "save";
      },
      (w) => {
        w.activity.attack.type.value = "melee";
      },
      (w) => {
        w.aborted = true;
      },
      (w) => {
        w.isFumble = true;
      },
    ]) {
      const workflow = fixture();
      modify(workflow);
      assert.equal(
        isRangedWeaponAttack(workflow),
        false,
      );
      assert.deepEqual(
        rangedFireBonus({ workflow }),
        {},
      );
    }
  },
);

test(
  "같은 대상의 동시 적중과 반복 적중에도 연소는 하나이며 빗나감에는 생성하지 않는다",
  async () => {
    const previous = globalThis.game;
    globalThis.game = { user: { isGM: true } };
    try {
      const workflow = fixture();
      const actor = {
        uuid: "Actor.target",
        effects: [],
        writes: 0,
        async createEmbeddedDocuments(
          type,
          effects,
        ) {
          assert.equal(
            type,
            "ActiveEffect",
          );
          this.writes++;
          await new Promise((resolve) => setTimeout(
            resolve,
            5,
          ));
          this.effects.push(...effects);
          return effects;
        },
      };
      await applyRangedFireBurn({ workflow });
      assert.equal(
        actor.writes,
        0,
      );
      workflow.hitTargets.add({ actor });
      workflow.hitTargets.add({ actor });
      await Promise.all([
        applyRangedFireBurn({ workflow }),
        applyRangedFireBurn({ workflow }),
      ]);
      await applyRangedFireBurn({ workflow });
      assert.equal(
        actor.writes,
        1,
      );
      assert.equal(
        actor.effects[0].origin,
        workflow.item.uuid,
      );
      assert.match(
        actor.effects[0].system.changes[0].value,
        /turn=start,damageRoll=1d4,damageType=fire/,
      );
      assert.equal(
        buildRangedFireBurn(workflow.item.uuid).transfer,
        false,
      );
    } finally {
      globalThis.game = previous;
    }
  },
);

test(
  "플레이어 적중 효과는 Midi-QOL의 GM 소켓으로 생성한다",
  async () => {
    const previous = { game: globalThis.game, MidiQOL: globalThis.MidiQOL };
    const calls = [];
    globalThis.game = { user: { isGM: false } };
    globalThis.MidiQOL = {
      socket: () => ({ executeAsGM: async (...args) => calls.push(args) }),
    };
    try {
      const workflow = fixture();
      workflow.hitTargets.add({ actor: { uuid: "Actor.target", effects: [] } });
      await applyRangedFireBurn({ workflow });
      assert.equal(
        calls[0][0],
        "createEffects",
      );
      assert.equal(
        calls[0][1].actorUuid,
        "Actor.target",
      );
      assert.equal(
        calls[0][1].effects[0].flags[MODULE].example,
        "ranged-fire-burn",
      );
    } finally {
      Object.assign(
        globalThis,
        previous,
      );
    }
  },
);
