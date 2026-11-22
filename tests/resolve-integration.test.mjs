import assert from 'node:assert/strict';

import test from 'node:test';

import {
  readFile
} from 'node:fs/promises';

import {
  MODULE_ID,
  resolveActor,
  saveResolve,
  statusId,
  storedResolve
} from '../scripts/resolve/store.mjs';

import {
  runCardAction,
  changeActorResolve,
  recoverActor
} from '../scripts/resolve/actions.mjs';

import {
  applyPcState,
  applyStress,
  pcStress,
  releasePcState
} from '../scripts/resolve/stress.mjs';

import {
  afterActorUpdate,
  beforeActorUpdate,
  combatDeleted,
  combatUpdated,
  deliverNotice,
  registerResolve,
  registerResolveStatuses,
  restCompleted
} from '../scripts/resolve/index.mjs';

import {
  postCard,
  publishEvent,
  renderResolveCard
} from '../scripts/resolve/cards.mjs';

import {
  injectResolveSheet
} from '../scripts/resolve/sheet.mjs';

test(
  '긴 휴식만 상태 해제 카드를 제시하고 선택 전에는 상태·스트레스 유지',
  async () => {
    const pc = actor(
      'PC',
      'character'
    );
    game.actors = [ pc ];
    await setActorResourceValue(
      pc,
      'stress',
      100
    );
    await applyPcState(
      pc,
      '검은 광기',
      1
    );
    await restCompleted(
      pc,
      {
        longRest: false
      },
      {
        type: 'short'
      }
    );
    assert.equal(
      messages.length,
      0
    );
    await restCompleted(
      pc,
      {
        longRest: true
      },
      {
        type: 'long'
      }
    );
    assert.match(
      messages[0].content,
      /상태 풀고 스트레스 70/
    );
    assert.equal(
      pcStress(pc).value,
      100
    );
    assert.equal(
      pc.effects.length,
      1
    );
    await runCardAction(
      pc,
      messages[0].flags[MODULE_ID].resolveCard.actions[0]
    );
    assert.equal(
      pcStress(pc).value,
      70
    );
    assert.equal(
      pc.effects.length,
      0
    );
  }
);

test(
  'PC 상태의 다음 전투 턴만 카드, 1~2에는 외침·검은 광기의 진행자 행동',
  async () => {
    const pc = actor(
      'PC',
      'character'
    );
    game.actors = [ pc ];
    const combat = game.combat = combatFor([ pc ]);
    await applyPcState(
      pc,
      '백색 맹세',
      2
    );
    await combatUpdated(
      combat,
      {
        turn: 0
      }
    );
    assert.equal(
      messages.length,
      0
    );
    combat.round = 2;
    await combatUpdated(
      combat,
      {
        round: 2
      }
    );
    assert.match(
      messages[0].content,
      /턴 굴림 d6/
    );
    rolls.push(1);
    await runCardAction(
      pc,
      messages[0].flags[MODULE_ID].resolveCard.actions[0]
    );
    await deliverNotice(pc);
    assert.match(
      messages[1].content,
      /맹세의 외침/
    );
    assert.equal(
      messages[1].flags[MODULE_ID].resolveCard.actions[0].amount,
      -5
    );
    assert.equal(
      pcStress(pc).value,
      50
    );
    await publishEvent(
      pc,
      {
        kind: '긴 휴식'
      }
    );
    assert.match(
      messages[2].content,
      /상태 풀기/
    );
    await releasePcState(pc);
    await setActorResourceValue(
      pc,
      'stress',
      100
    );
    await applyPcState(
      pc,
      '검은 광기',
      1
    );
    await publishEvent(
      pc,
      {
        kind: 'PC 턴 결과',
        total: 2
      }
    );
    assert.match(
      messages[3].content,
      /진행자가 PC를 움직입니다/
    );
    assert.equal(
      messages[3].flags[MODULE_ID].resolveCard.actions[0].amount,
      5
    );
  }
);

test(
  '채팅 스트레스 단추는 선택한 PC에게 한 번만, 취소·지난 전투 카드는 적용하지 않음',
  async () => {
    const pc = actor(
      'PC',
      'character'
    );
    const npc = actor('적');
    game.actors = [ pc, npc ];
    await postCard(
      npc,
      '폭주',
      '',
      [ {
        kind: 'stress',
        label: '본 PC 스트레스 +5',
        amount: 5
      } ]
    );
    const card = clone(messages[0].flags[MODULE_ID].resolveCard);
    const message = {
      id: `chat-${++sequence}`,
      current: card,
      getFlag() {
        return clone(this.current);
      },
      async setFlag(
        _module,
        _key,
        value
      ) {
        this.current = clone(value);
      }
    };
    let click;
    const button = {
      dataset: {
        resolveAction: '0'
      },
      addEventListener(
        _event,
        callback
      ) {
        click = callback;
      }
    };
    renderResolveCard(
      message,
      {
        querySelector() {},
        querySelectorAll: () => [ button ]
      }
    );
    const event = {
      preventDefault() {},
      stopPropagation() {}
    };
    foundry.applications.api.DialogV2.wait = async () => null;
    await click(event);
    assert.equal(
      pcStress(pc).value,
      0
    );
    assert.equal(
      button.disabled,
      false
    );
    foundry.applications.api.DialogV2.wait = async () => [ pc ];
    await click(event);
    assert.equal(
      pcStress(pc).value,
      5
    );
    await click(event);
    assert.equal(
      pcStress(pc).value,
      5
    );
    assert.equal(
      button.disabled,
      true
    );
    message.current.used = [];
    game.combat = combatFor([ pc ]);
    await click(event);
    assert.equal(
      pcStress(pc).value,
      5
    );
    assert.match(
      warnings.at(-1),
      /다른 전투/
    );
  }
);

import {
  adjustActorResourceValue,
  adjustResourceForActors,
  getResourceStatusRows,
  resetStressScene,
  setActorResourceValue
} from '../scripts/resources/actor-resources.mjs';

let sequence = 0;

let messages = [];

let warnings = [];

let rolls = [];

let settings;

let handlers;

const clone = value => structuredClone(value);

function merge(
  target,
  source
) {
  for (const [ key, value ] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {};
      merge(
        target[key],
        value
      );
    } else target[key] = clone(value);
  }
  return target;
}

function put(
  object,
  path,
  value
) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) target = target[key] ??= {};
  target[last] = clone(value);
}

function actor(
  id,
  type = 'npc',
  resolve = {}
) {
  const document = {
    id: id,
    uuid: `Actor.${id}`,
    name: id,
    type: type,
    items: [],
    effects: [],
    flags: {
      [MODULE_ID]: {
        resolve: clone(resolve),
        resources: type === 'character' ? {
          stress: {
            value: 0
          },
          mana: {
            value: 10
          }
        } : {}
      }
    },
    system: {
      attributes: {
        hp: {
          max: 100,
          value: 50
        }
      }
    },
    icons: new Set(),
    getFlag(
      moduleId,
      key
    ) {
      return clone(this.flags[moduleId]?.[key]);
    },
    async setFlag(
      moduleId,
      key,
      value
    ) {
      this.flags[moduleId] ??= {};
      const existing = this.flags[moduleId][key];
      this.flags[moduleId][key] = existing && value && typeof value === 'object' && !Array.isArray(value) ? merge(
        existing,
        value
      ) : clone(value);
      return this;
    },
    async update(changes) {
      for (const [ path, value ] of Object.entries(changes)) put(
        this,
        path,
        value
      );
      return this;
    },
    async toggleStatusEffect(
      id,
      {
        active
      }
    ) {
      if (active) this.icons.add(id); else this.icons.delete(id);
    },
    async createEmbeddedDocuments(
      type,
      rows
    ) {
      const created = rows.map(row => {
        return {
          ...clone(row),
          id: `effect-${++sequence}`,
          getFlag(
            moduleId,
            key
          ) {
            return this.flags?.[moduleId]?.[key];
          }
        };
      });
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(
      type,
      ids
    ) {
      this.effects = this.effects.filter(effect => {
        return !ids.includes(effect.id);
      });
    }
  };
  return document;
}

function combatFor(actors) {
  const flags = {};
  return {
    id: `combat-${++sequence}`,
    started: true,
    round: 1,
    turn: 0,
    combatants: actors.map(actor => {
      return {
        actor: actor
      };
    }),
    combatant: {
      actor: actors[0]
    },
    getFlag: (
      _module,
      key
    ) => clone(flags[key]),
    setFlag: async (
      _module,
      key,
      value
    ) => {
      flags[key] = clone(value);
    }
  };
}

test.beforeEach(() => {
  messages = [];
  warnings = [];
  rolls = [];
  handlers = new Map();
  settings = new Map([ [ `${MODULE_ID}.resourceDefinitions`, {
    stress: {
      id: 'stress',
      name: '스트레스',
      max: 100,
      startFromZero: true
    },
    mana: {
      id: 'mana',
      name: '마나',
      max: 20,
      startFromZero: false
    }
  } ], [ `${MODULE_ID}.managedActorUuids`, {} ] ]);
  const users = [ {
    id: 'gm',
    isGM: true
  }, {
    id: 'gm2',
    isGM: true
  }, {
    id: 'player',
    isGM: false
  } ];
  users.activeGM = {
    isSelf: true
  };
  globalThis.game = {
    user: users[0],
    users: users,
    actors: [],
    scenes: [],
    combat: null,
    settings: {
      get: (
        module,
        key
      ) => clone(settings.get(`${module}.${key}`))
    }
  };
  globalThis.CONFIG = {
    statusEffects: {}
  };
  globalThis.CONST = {
    ACTIVE_EFFECT_SHOW_ICON: {
      ALWAYS: 1
    }
  };
  globalThis.canvas = {
    scene: {
      tokens: []
    }
  };
  globalThis.ui = {
    notifications: {
      warn: text => warnings.push(text),
      error: text => warnings.push(text)
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      randomID: () => `resolve-${++sequence}`
    },
    applications: {
      instances: new Map(),
      api: {
        DialogV2: {}
      }
    }
  };
  globalThis.Hooks = {
    on: (
      hook,
      callback
    ) => handlers.set(
      hook,
      callback
    ),
    once: (
      hook,
      callback
    ) => handlers.set(
      hook,
      callback
    )
  };
  globalThis.ChatMessage = {
    create: async data => {
      messages.push(data);
      return data;
    }
  };
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
    }
    async evaluate() {
      assert.ok(
        rolls.length,
        `굴림 입력 없음: ${this.formula}`
      );
      this.total = rolls.shift();
      return this;
    }
  };
  globalThis.fromUuid = async uuid => game.actors.find(actor => {
    return actor.uuid === uuid;
  });
  registerResolveStatuses();
});

test(
  'v14 객체 상태 목록에 6개를 id로 등록하고 기존 항목 보존',
  () => {
    CONFIG.statusEffects.foreign = {
      name: '다른 모듈'
    };
    registerResolveStatuses();
    registerResolveStatuses();
    assert.equal(
      Object.keys(CONFIG.statusEffects).length,
      7
    );
    assert.equal(
      CONFIG.statusEffects[statusId('검은 광기')].img,
      'icons/svg/skull.svg'
    );
    assert.equal(
      CONFIG.statusEffects.foreign.name,
      '다른 모듈'
    );
  }
);

test(
  '훅 등록: v14 채팅 HTML·NPC 시트·자원 갱신·긴 휴식·전투 정리',
  () => {
    assert.equal(
      registerResolve(),
      true
    );
    assert.equal(
      registerResolve(),
      false
    );
    for (const key of [ 'renderChatMessageHTML', 'renderActorSheetV2', 'preUpdateActor', 'updateActor', 'updateCombat', 'deleteCombat', 'dnd5e.restCompleted' ]) assert.ok(
      handlers.has(key),
      key
    );
  }
);

test(
  '활성 GM만 귓속말 카드를 만들며 수신자는 GM 전체',
  async () => {
    const npc = actor('적');
    await postCard(
      npc,
      '확인',
      '<p>내용</p>'
    );
    assert.deepEqual(
      messages[0].whisper,
      [ 'gm', 'gm2' ]
    );
    game.users.activeGM.isSelf = false;
    await postCard(
      npc,
      '중복',
      ''
    );
    assert.equal(
      messages.length,
      1
    );
  }
);

test(
  '연속 변경의 알림을 잃지 않고 한 번씩만 발행, 기존 flag 보존',
  async () => {
    const npc = actor(
      '적',
      'npc',
      {
        settings: {
          '투지': 3,
          '의지': 3
        }
      }
    );
    npc.flags[MODULE_ID].foreign = {
      value: 42
    };
    await changeActorResolve(
      npc,
      {
        axis: '투지',
        direction: '차감',
        amount: 1
      }
    );
    await changeActorResolve(
      npc,
      {
        axis: '투지',
        direction: '차감',
        amount: 1
      }
    );
    await changeActorResolve(
      npc,
      {
        axis: '투지',
        direction: '차감',
        amount: 1
      }
    );
    await deliverNotice(npc);
    await deliverNotice(npc);
    assert.equal(
      messages.filter(message => {
        return message.content.includes('RT-07 버팀 d8');
      }).length,
      1
    );
    assert.equal(
      messages.filter(message => {
        return message.content.includes('RT-07 무너짐 d8');
      }).length,
      1
    );
    assert.equal(
      npc.flags[MODULE_ID].foreign.value,
      42
    );
    assert.ok(npc.icons.has(statusId('퇴각')));
  }
);

test(
  '같은 기본 액터의 비연결 토큰은 각자 저장, 무리만 대표 값·아이콘 공유',
  async () => {
    const a = actor(
      'base',
      'npc',
      {
        settings: {
          '투지': 3,
          '의지': 3
        }
      }
    );
    const b = actor(
      'base',
      'npc',
      {
        settings: {
          '투지': 3,
          '의지': 3
        }
      }
    );
    const scene = {
      tokens: []
    };
    a.uuid = 'Scene.s.Token.a.Actor.base';
    b.uuid = 'Scene.s.Token.b.Actor.base';
    a.token = {
      id: 'a',
      actorId: 'base',
      actor: a,
      parent: scene
    };
    b.token = {
      id: 'b',
      actorId: 'base',
      actor: b,
      parent: scene
    };
    scene.tokens = [ a.token, b.token ];
    canvas.scene = scene;
    await changeActorResolve(
      b,
      {
        axis: '투지',
        direction: '차감',
        amount: 1
      }
    );
    assert.equal(
      storedResolve(b).current.투지,
      2
    );
    assert.equal(
      storedResolve(a).current,
      undefined
    );
    await a.setFlag(
      MODULE_ID,
      'resolve',
      {
        settings: {
          group: true
        }
      }
    );
    assert.equal(
      resolveActor(b),
      a
    );
    await changeActorResolve(
      b,
      {
        axis: '투지',
        direction: '차감',
        amount: 3
      }
    );
    assert.equal(
      storedResolve(a).current.투지,
      0
    );
    assert.ok(a.icons.has(statusId('퇴각')));
    assert.ok(b.icons.has(statusId('퇴각')));
  }
);

test(
  '페이즈 전환은 투지만 회복하고 전투당 한 번',
  async () => {
    const npc = actor(
      '보스',
      'npc',
      {
        settings: {
          '투지': 5,
          '의지': 3,
          grade: '보스'
        },
        current: {
          '투지': 0,
          '의지': 2
        }
      }
    );
    game.combat = combatFor([ npc ]);
    assert.equal(
      await runCardAction(
        npc,
        {
          kind: 'phase'
        }
      ),
      true
    );
    assert.equal(
      storedResolve(npc).current.투지,
      5
    );
    assert.equal(
      storedResolve(npc).current.의지,
      2
    );
    await npc.setFlag(
      MODULE_ID,
      'resolve',
      {
        current: {
          '투지': 0
        }
      }
    );
    assert.equal(
      await runCardAction(
        npc,
        {
          kind: 'phase'
        }
      ),
      false
    );
  }
);

test(
  '각성 6은 두 축·HP 회복·아이콘·사용 기록, 실패는 폭주',
  async () => {
    const npc = actor(
      '이름 있는 적',
      'npc',
      {
        settings: {
          '투지': 4,
          '의지': 3,
          named: true
        },
        current: {
          '투지': 0,
          '의지': 0
        }
      }
    );
    game.combat = combatFor([ npc ]);
    rolls.push(6);
    await runCardAction(
      npc,
      {
        kind: 'awakening-roll'
      }
    );
    const offer = storedResolve(npc).awakeningOffer;
    assert.ok(offer);
    await runCardAction(
      npc,
      {
        kind: 'awakening-apply',
        offer: offer
      }
    );
    assert.deepEqual(
      storedResolve(npc).current,
      {
        '투지': 4,
        '의지': 3
      }
    );
    assert.equal(
      npc.system.attributes.hp.value,
      75
    );
    assert.ok(npc.icons.has(statusId('각성')));
    assert.equal(
      await runCardAction(
        npc,
        {
          kind: 'awakening-apply',
          offer: offer
        }
      ),
      false
    );
    const second = actor(
      '다른 이름 있는 적',
      'npc',
      {
        settings: {
          '투지': 4,
          '의지': 3,
          named: true
        },
        current: {
          '투지': 4,
          '의지': 0
        }
      }
    );
    rolls.push(5);
    await runCardAction(
      second,
      {
        kind: 'awakening-roll'
      }
    );
    assert.equal(
      storedResolve(second).mode,
      '폭주'
    );
    assert.equal(
      await runCardAction(
        second,
        {
          kind: 'awakening-roll'
        }
      ),
      false
    );
  }
);

test(
  'R+4에 폭주→붕괴, 폭주 아이콘 제거, 같은 턴 중복 카드와 실신 턴 굴림 없음',
  async () => {
    const npc = actor(
      '폭주 적',
      'npc',
      {
        settings: {
          '투지': 3,
          '의지': 3
        },
        current: {
          '투지': 3,
          '의지': 0
        },
        mode: '폭주',
        rampageStart: 1
      }
    );
    const combat = game.combat = combatFor([ npc ]);
    await npc.setFlag(
      MODULE_ID,
      'resolve',
      {
        modeCombatId: combat.id,
        type: 1
      }
    );
    combat.round = 4;
    await combatUpdated(
      combat,
      {
        round: 4
      }
    );
    assert.equal(
      storedResolve(npc).mode,
      '폭주'
    );
    const firstCount = messages.length;
    await combatUpdated(
      combat,
      {
        turn: 0
      }
    );
    assert.equal(
      messages.length,
      firstCount
    );
    combat.round = 5;
    await combatUpdated(
      combat,
      {
        round: 5
      }
    );
    assert.equal(
      storedResolve(npc).mode,
      '붕괴'
    );
    assert.equal(
      npc.icons.has(statusId('폭주')),
      false
    );
    assert.ok(npc.icons.has(statusId('붕괴')));
    await npc.setFlag(
      MODULE_ID,
      'resolve',
      {
        type: 3
      }
    );
    combat.round = 6;
    const before = messages.length;
    await combatUpdated(
      combat,
      {
        round: 6
      }
    );
    assert.equal(
      messages.length,
      before
    );
  }
);

test(
  'deleteCombat은 전투 기록만 지우고 현재 칸·꺾임·아이콘 보존',
  async () => {
    const npc = actor(
      '꺾인 적',
      'npc',
      {
        settings: {
          '투지': 3,
          '의지': 3
        }
      }
    );
    const combat = game.combat = combatFor([ npc ]);
    await changeActorResolve(
      npc,
      {
        axis: '투지',
        direction: '차감',
        number: 9,
        amount: 2
      }
    );
    combat.round++;
    await changeActorResolve(
      npc,
      {
        axis: '투지',
        direction: '차감',
        number: 1,
        amount: 1
      }
    );
    await combatDeleted(combat);
    const state = storedResolve(npc);
    assert.equal(
      state.encounters[combat.id],
      null
    );
    assert.equal(
      state.current.투지,
      0
    );
    assert.equal(
      state.retreat,
      true
    );
    await recoverActor(
      npc,
      true
    );
    assert.equal(
      storedResolve(npc).current.투지,
      2
    );
    assert.equal(
      npc.icons.size,
      0
    );
  }
);

test(
  '스트레스는 PC별 전투 ±15, 자동 변경 없음, 검은 광기 잠금은 모든 값 조작에 적용',
  async () => {
    const pc = actor(
      'PC',
      'character'
    );
    game.actors = [ pc ];
    game.combat = combatFor([ pc ]);
    await setActorResourceValue(
      pc,
      'stress',
      50
    );
    await applyStress(
      [ pc ],
      10
    );
    await applyStress(
      [ pc ],
      10
    );
    assert.equal(
      pcStress(pc).value,
      65
    );
    await applyStress(
      [ pc ],
      -30
    );
    assert.equal(
      pcStress(pc).value,
      50
    );
    assert.deepEqual(
      game.combat.getFlag(
        MODULE_ID,
        'resolveStress'
      )[pc.uuid],
      {
        up: 15,
        down: 15
      }
    );
    await pc.setFlag(
      MODULE_ID,
      'resolve',
      {
        pc: {
          kind: '검은 광기',
          number: 1
        }
      }
    );
    await setActorResourceValue(
      pc,
      'stress',
      100
    );
    await adjustActorResourceValue(
      pc,
      'stress',
      5
    );
    await adjustResourceForActors(
      'stress',
      5,
      [ pc ]
    );
    assert.equal(
      pcStress(pc).value,
      50
    );
    await adjustActorResourceValue(
      pc,
      'mana',
      -3
    );
    assert.equal(
      pc.getFlag(
        MODULE_ID,
        'resources'
      ).mana.value,
      7
    );
    assert.ok(warnings.some(message => {
      return message.includes('검은 광기');
    }));
  }
);

test(
  '장면 오름은 일괄 실제 증가만 세고 표시만 하며 새 장면에 초기화',
  async () => {
    const pc = actor(
      'PC',
      'character'
    );
    game.actors = [ pc ];
    settings.set(
      `${MODULE_ID}.managedActorUuids`,
      {
        [pc.uuid]: true
      }
    );
    await adjustActorResourceValue(
      pc,
      'stress',
      4
    );
    await adjustResourceForActors(
      'stress',
      7,
      [ pc ]
    );
    assert.equal(
      getResourceStatusRows('stress')[0].sceneRemaining,
      3
    );
    await adjustResourceForActors(
      'stress',
      20,
      [ pc ]
    );
    assert.equal(
      pcStress(pc).value,
      31
    );
    assert.equal(
      getResourceStatusRows('stress')[0].sceneRemaining,
      0
    );
    await resetStressScene();
    assert.equal(
      getResourceStatusRows('stress')[0].sceneRemaining,
      10
    );
    await setActorResourceValue(
      pc,
      'stress',
      98
    );
    await adjustResourceForActors(
      'stress',
      20,
      [ pc ]
    );
    assert.equal(
      getResourceStatusRows('stress')[0].sceneRemaining,
      8
    );
  }
);

test(
  '100 도달 시 결단 카드 한 번, 백색 맹세 재도달은 효과 제거, 검은 광기는 무시',
  async () => {
    const pc = actor(
      'PC',
      'character'
    );
    game.actors = [ pc ];
    await setActorResourceValue(
      pc,
      'stress',
      99
    );
    const options = {};
    beforeActorUpdate(
      pc,
      {},
      options
    );
    await setActorResourceValue(
      pc,
      'stress',
      100
    );
    await afterActorUpdate(
      pc,
      {},
      options
    );
    assert.equal(
      messages.filter(message => {
        return message.content.includes('결단 판정 d20');
      }).length,
      1
    );
    await afterActorUpdate(
      pc,
      {},
      options
    );
    assert.equal(
      messages.length,
      1
    );
    await applyPcState(
      pc,
      '백색 맹세',
      1
    );
    assert.equal(
      pcStress(pc).value,
      50
    );
    assert.equal(
      pc.effects.length,
      1
    );
    assert.equal(
      pc.effects[0].name,
      '백색 맹세: 몬타누스의 암벽'
    );
    assert.match(
      pc.effects[0].description,
      /긴 휴식을 마칠 때까지/
    );
    assert.deepEqual(
      pc.effects[0].changes,
      []
    );
    const again = {};
    beforeActorUpdate(
      pc,
      {},
      again
    );
    await setActorResourceValue(
      pc,
      'stress',
      100
    );
    await afterActorUpdate(
      pc,
      {},
      again
    );
    assert.equal(
      pc.effects.length,
      0
    );
    assert.equal(
      storedResolve(pc).pc,
      null
    );
    assert.equal(
      messages.filter(message => {
        return message.content.includes('결단 판정 d20');
      }).length,
      2
    );
    await applyPcState(
      pc,
      '검은 광기',
      8
    );
    await afterActorUpdate(
      pc,
      {},
      {
        ncmResolveOldStress: 99
      }
    );
    assert.equal(
      messages.filter(message => {
        return message.content.includes('결단 판정 d20');
      }).length,
      2
    );
    await releasePcState(pc);
    assert.equal(
      pcStress(pc).value,
      70
    );
    assert.equal(
      pc.effects.length,
      0
    );
  }
);

test(
  '결단→상태 재굴림→적용은 최신 후보만, 16 검은 광기·17 백색 맹세',
  async () => {
    for (const [ roll, expected ] of [ [ 16, '검은 광기' ], [ 17, '백색 맹세' ] ]) {
      const pc = actor(
        `PC-${roll}`,
        'character',
        {
          determinationPending: true
        }
      );
      await setActorResourceValue(
        pc,
        'stress',
        100
      );
      rolls.push(
        roll,
        1,
        2
      );
      await runCardAction(
        pc,
        {
          kind: 'determination'
        }
      );
      const state = storedResolve(pc);
      assert.equal(
        state.determinationKind,
        expected
      );
      const action = {
        kind: 'pc-type-roll',
        pcKind: expected,
        roll: state.determinationRoll
      };
      await runCardAction(
        pc,
        action
      );
      await runCardAction(
        pc,
        action
      );
      assert.equal(
        await runCardAction(
          pc,
          {
            ...action,
            kind: 'pc-apply',
            number: 1
          }
        ),
        false
      );
      assert.equal(
        await runCardAction(
          pc,
          {
            ...action,
            kind: 'pc-apply',
            number: 2
          }
        ),
        true
      );
      assert.equal(
        pcStress(pc).value,
        roll === 16 ? 100 : 50
      );
      assert.equal(
        await runCardAction(
          pc,
          {
            ...action,
            kind: 'pc-apply',
            number: 2
          }
        ),
        false
      );
    }
  }
);

test(
  '피트 강제 행동·외침과 종류별 표 카드, 스트레스는 단추를 누를 때만',
  async () => {
    const npc = actor(
      '적',
      'npc',
      {
        settings: {
          '투지': 4,
          '의지': 3,
          kind: '짐승'
        },
        mode: '폭주',
        type: 2
      }
    );
    await publishEvent(
      npc,
      {
        kind: 'NPC 턴 결과',
        mode: '폭주',
        total: 1
      }
    );
    assert.match(
      messages[0].content,
      /등을 벽에 대고/
    );
    assert.match(
      messages[0].content,
      /외침 \+3/
    );
    assert.equal(
      messages[0].flags[MODULE_ID].resolveCard.actions[0].amount,
      3
    );
    npc.items.push({
      type: 'feat',
      name: '(폭주) 맹세의 사냥',
      system: {
        description: {
          value: '<p>제약: 맞수만 노린다. 강제 행동(턴 굴림 1~2): 엘리네를 친다. 외침: 그 PC 스트레스 +5. (폭주 6 집착)</p>'
        }
      }
    });
    await saveResolve(
      npc,
      storedResolve(npc)
    );
    assert.equal(
      storedResolve(npc).type,
      6
    );
    await publishEvent(
      npc,
      {
        kind: 'NPC 턴 결과',
        mode: '폭주',
        total: 1
      }
    );
    assert.match(
      messages[1].content,
      /엘리네를 친다/
    );
    assert.equal(
      messages[1].flags[MODULE_ID].resolveCard.actions[0].amount,
      5
    );
  }
);

test(
  '각성 적 HP 0 카드 한 번, 비활성 GM은 만들지 않음',
  async () => {
    const npc = actor(
      '각성 적',
      'npc',
      {
        awakened: true
      }
    );
    game.combat = combatFor([ npc ]);
    npc.system.attributes.hp.value = 0;
    const changes = {
      'system.attributes.hp.value': 0
    };
    await afterActorUpdate(
      npc,
      changes,
      {
        ncmResolveOldHp: 12
      }
    );
    await afterActorUpdate(
      npc,
      changes,
      {
        ncmResolveOldHp: 12
      }
    );
    assert.equal(
      messages.filter(message => {
        return message.content.includes('스트레스 −10');
      }).length,
      1
    );
    game.users.activeGM.isSelf = false;
    await afterActorUpdate(
      npc,
      changes,
      {
        ncmResolveOldHp: 12
      }
    );
    assert.equal(
      messages.length,
      1
    );
  }
);

test(
  'GM 이외에는 시트·카드 단추와 변경 함수 사용 불가',
  async () => {
    game.user = game.users[2];
    assert.equal(
      injectResolveSheet(
        {
          actor: actor('적')
        },
        {}
      ),
      false
    );
    await assert.rejects(
      changeActorResolve(
        actor('적'),
        {
          axis: '투지',
          direction: '차감'
        }
      ),
      /GM만/
    );
    const button = {
      dataset: {
        resolveAction: '0'
      },
      addEventListener() {}
    };
    renderResolveCard(
      {
        getFlag: () => ({
          used: []
        })
      },
      {
        querySelector() {},
        querySelectorAll: () => [ button ]
      }
    );
    assert.equal(
      button.disabled,
      true
    );
  }
);

test(
  '시트는 HP 바로 아래 원·노랑·빨강·톱니를 넣고 무최대 축은 숨김',
  () => {
    const inserted = [];
    const hp = {
      after: block => inserted.push(block)
    };
    const root = {
      ownerDocument: {
        createElement: () => ({
          setAttribute() {},
          addEventListener() {},
          innerHTML: ''
        })
      },
      querySelector: selector => selector.includes('.meter.hit-points') ? hp : null
    };
    const npc = actor(
      '적',
      'npc',
      {
        settings: {
          '투지': 3,
          '의지': 2
        },
        current: {
          '투지': 1,
          '의지': 0
        }
      }
    );
    injectResolveSheet(
      {
        actor: npc
      },
      root
    );
    assert.match(
      inserted[0].innerHTML,
      /is-shaken/
    );
    assert.match(
      inserted[0].innerHTML,
      /is-broken/
    );
    assert.equal(
      (inserted[0].innerHTML.match(/class="ncm-resolve-slot /g) ?? []).length,
      5
    );
    injectResolveSheet(
      {
        actor: actor('설정 없는 적')
      },
      root
    );
    assert.match(
      inserted[1].innerHTML,
      /data-resolve-settings/
    );
    assert.doesNotMatch(
      inserted[1].innerHTML,
      /ncm-resolve-slot /
    );
  }
);

test(
  '릴리스·기존 기능 경계: 코드 경로와 manifest·템플릿 동봉',
  async () => {
    const manifest = JSON.parse(await readFile(
      new URL(
        '../module.json',
        import.meta.url
      ),
      'utf8'
    ));
    assert.ok(manifest.styles.includes('styles/resolve.css'));
    const css = await readFile(
      new URL(
        '../styles/resolve.css',
        import.meta.url
      ),
      'utf8'
    );
    assert.match(
      css,
      /\.ncm-resolve-block/
    );
    const entry = await readFile(
      new URL(
        '../scripts/module.mjs',
        import.meta.url
      ),
      'utf8'
    );
    assert.match(
      entry,
      /registerResolve\(\)/
    );
    const template = await readFile(
      new URL(
        '../templates/resources/resource-manager.hbs',
        import.meta.url
      ),
      'utf8'
    );
    assert.match(
      template,
      /이번 장면 남은 오름/
    );
    assert.match(
      template,
      /새 장면/
    );
  }
);
