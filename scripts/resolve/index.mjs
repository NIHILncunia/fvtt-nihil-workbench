import {
  encounterRecord,
  rampageExpired
} from './rules.mjs';

import {
  publishEvent,
  renderResolveCard
} from './cards.mjs';

import {
  injectResolveSheet
} from './sheet.mjs';

import {
  registerResolveAbilityHooks
} from './abilities.mjs';

import {
  pcStress,
  removePcEffect,
  stressDefinition
} from './stress.mjs';

import {
  CLIENT_ID,
  MODULE_ID,
  STATUS,
  activeGM,
  combatContext,
  readResolve,
  resolveActor,
  saveResolve,
  serial,
  statusId,
  storedResolve
} from './store.mjs';

let registered = false;

const delivered = new Set();

function property(
  object,
  path
) {
  if (object == null) return undefined;
  if (Object.hasOwn(
    object,
    path
  )) return object[path];
  const parts = path.split('.');
  for (let index = parts.length - 1; index > 0; index--) {
    const prefix = parts.slice(
      0,
      index
    ).join('.');
    if (Object.hasOwn(
      object,
      prefix
    )) return property(
      object[prefix],
      parts.slice(index).join('.')
    );
  }
  return undefined;
}

export async function deliverNotice(actor) {
  if (!activeGM()) return;
  return serial(
    `notice:${actor.uuid}`,
    async () => {
      const state = storedResolve(actor);
      const acknowledged = new Set(state.notifiedIds ?? []);
      for (const notice of state.notices ?? []) {
        if (acknowledged.has(notice.id) || delivered.has(notice.id)) continue;
        delivered.add(notice.id);
        try {
          // 전투가 끝나거나 다른 전투로 넘어간 뒤 재접속한 오래된 카드는 만들지 않는다.
          if (notice.combatId === (combatContext(actor)?.id ?? null)) {
            for (const event of notice.events) await publishEvent(
              actor,
              event
            );
          }
          acknowledged.add(notice.id);
          await actor.update({
            [`flags.${MODULE_ID}.resolve.notifiedIds`]: [ ...acknowledged ]
          });
        } catch (error) {
          delivered.delete(notice.id);
          console.error(
            `${MODULE_ID} | 투지·의지 카드 생성 실패`,
            error
          );
          globalThis.ui?.notifications?.error('투지·의지 카드 생성에 실패했습니다. 콘솔을 확인하세요.');
          break;
        }
      }
    }
  );
}

export function beforeActorUpdate(
  actor,
  changes,
  options
) {
  if (!globalThis.game?.user?.isGM) return;
  options.ncmResolveOldHp = actor.system?.attributes?.hp?.value;
  if (actor.type === 'character') options.ncmResolveOldStress = pcStress(actor)?.value ?? null;
}

export async function afterActorUpdate(
  actor,
  changes,
  options = {}
) {
  if (!activeGM()) return;
  // 다른 클라이언트의 갱신에서도 preUpdate의 options는 갱신 알림에 포함된다.
  if (actor.type === 'character' && options.ncmResolveOldStress != null) {
    const current = pcStress(actor);
    if (current && options.ncmResolveOldStress < 100 && current.value === 100) {
      await serial(
        actor.uuid,
        async () => {
          const state = storedResolve(actor);
          if (state.pc?.kind === '검은 광기' || state.determinationPending) return;
          if (state.pc?.kind === '백색 맹세') await removePcEffect(actor);
          state.pc = null;
          state.determinationPending = true;
          state.determinationKind = null;
          state.determinationRoll = null;
          await saveResolve(
            actor,
            state,
            [ {
              kind: '결단 판정'
            } ]
          );
        }
      );
    }
  }
  const hp = property(
    changes,
    'system.attributes.hp.value'
  );
  if (actor.type === 'npc' && hp != null && hp <= 0 && options.ncmResolveOldHp > 0) {
    const representative = resolveActor(actor);
    await serial(
      representative.uuid,
      async () => {
        const {
          state
        } = readResolve(representative);
        const record = encounterRecord(
          state,
          combatContext(representative)?.id
        );
        if (state.awakened && !record.awakenedDefeat) {
          record.awakenedDefeat = true;
          await saveResolve(
            representative,
            state,
            [ {
              kind: '각성한 적 쓰러짐'
            } ]
          );
        }
      }
    );
  }
  // 투지·의지 변경을 만든 탭이 있으면 그 탭만 카드를 만든다. 같은 GM 계정의 다른 탭은 건너뛴다.
  if (!options.ncmResolveClient || options.ncmResolveClient === CLIENT_ID) await deliverNotice(actor);
  // 무리 대표의 값이 바뀌면 같은 장면의 다른 토큰 시트도 새 값을 보여 준다.
  if (property(
    changes,
    `flags.${MODULE_ID}.resolve`
  ) !== undefined || Object.keys(changes).some(key => {
    return key.startsWith(`flags.${MODULE_ID}.resolve`);
  })) {
    for (const app of globalThis.foundry?.applications?.instances?.values?.() ?? []) {
      const document = app.actor ?? app.document;
      if (document?.type === 'npc' && document !== actor && resolveActor(document).uuid === actor.uuid) app.render();
    }
  }
}

export async function combatUpdated(
  combat,
  changes
) {
  if (!activeGM() || !combat.started || !('round' in changes) && !('turn' in changes)) return;
  return serial(
    `combat:${combat.id}`,
    async () => {
      const stamp = `${combat.id}:${combat.round}:${combat.turn}`;
      if (combat.getFlag(
        MODULE_ID,
        'resolveTurnStamp'
      ) === stamp) return;
      await combat.setFlag(
        MODULE_ID,
        'resolveTurnStamp',
        stamp
      );
      const actors = new Map(Array.from(combat.combatants ?? []).filter(entry => {
        return entry.actor;
      }).map(entry => {
        const actor = resolveActor(entry.actor);
        return [ actor.uuid, actor ];
      }));
      for (const actor of actors.values()) {
        if (actor.type !== 'npc') continue;
        await serial(
          actor.uuid,
          async () => {
            const {
              state
            } = readResolve(actor);
            if (state.mode !== '폭주') return;
            if (state.modeCombatId !== combat.id || state.rampageStart == null) {
              state.modeCombatId = combat.id;
              state.rampageStart = combat.round;
              await saveResolve(
                actor,
                state
              );
            } else if (rampageExpired(
              state.rampageStart,
              combat.round
            )) {
              state.mode = '붕괴';
              state.type = null;
              await saveResolve(
                actor,
                state,
                [ {
                  kind: '붕괴'
                } ]
              );
            }
          }
        );
      }
      const input = combat.combatant?.actor;
      if (!input) return;
      const actor = resolveActor(input);
      // 무리는 대표 토큰 차례에만 한 번 굴린다.
      if (input.uuid !== actor.uuid) return;
      const {
        state,
        profile
      } = readResolve(actor);
      if (actor.type === 'npc' && [ '폭주', '붕괴' ].includes(state.mode) && state.modeStarted !== stamp) {
        const type = profile.reactions[state.mode]?.type ?? state.type;
        if (state.mode !== '붕괴' || type !== 3) await publishEvent(
          actor,
          {
            kind: 'NPC 턴',
            mode: state.mode,
            stamp: stamp
          }
        );
      }
      if (actor.type === 'character' && stressDefinition() && state.pc && state.pc.started !== stamp) {
        await publishEvent(
          actor,
          {
            kind: 'PC 턴',
            stamp: stamp
          }
        );
      }
    }
  );
}

export async function combatDeleted(combat) {
  if (!activeGM()) return;
  const actors = new Map(Array.from(combat.combatants ?? []).filter(entry => {
    return entry.actor;
  }).map(entry => {
    const actor = resolveActor(entry.actor);
    return [ actor.uuid, actor ];
  }));
  for (const actor of actors.values()) {
    await serial(
      actor.uuid,
      async () => {
        const state = storedResolve(actor);
        if (!state.encounters?.[combat.id]) return;
        // null은 Foundry의 flag 병합에서도 이전 전투의 배열·사용 기록을 지운다.
        state.encounters[combat.id] = null;
        await saveResolve(
          actor,
          state
        );
      }
    );
  }
}

export async function restCompleted(
  actor,
  result,
  config
) {
  if (!activeGM() || actor.type !== 'character' || !stressDefinition()) return;
  if (!(result?.longRest || result?.type === 'long' || config?.type === 'long')) return;
  if (storedResolve(actor).pc) await publishEvent(
    actor,
    {
      kind: '긴 휴식'
    }
  );
}

export function registerResolveStatuses() {
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.statusEffects ??= {};
  for (const [ name, [ , img ] ] of Object.entries(STATUS)) {
    const id = statusId(name);
    globalThis.CONFIG.statusEffects[id] ??= {
      id: id,
      name: name,
      img: img
    };
  }
}

export function registerResolve() {
  if (registered || !globalThis.Hooks?.on) return false;
  registered = true;
  registerResolveStatuses();
  registerResolveAbilityHooks(globalThis.Hooks);
  // dnd5e가 초기화 중 상태 목록을 다시 구성하더라도 모듈 상태를 유지한다.
  globalThis.Hooks.once(
    'setup',
    registerResolveStatuses
  );
  globalThis.Hooks.once(
    'ready',
    registerResolveStatuses
  );
  globalThis.Hooks.on(
    'renderActorSheetV2',
    injectResolveSheet
  );
  globalThis.Hooks.on(
    'renderActorSheet',
    injectResolveSheet
  );
  globalThis.Hooks.on(
    'renderChatMessageHTML',
    renderResolveCard
  );
  globalThis.Hooks.on(
    'preUpdateActor',
    beforeActorUpdate
  );
  globalThis.Hooks.on(
    'updateActor',
    afterActorUpdate
  );
  globalThis.Hooks.on(
    'updateCombat',
    combatUpdated
  );
  globalThis.Hooks.on(
    'deleteCombat',
    combatDeleted
  );
  globalThis.Hooks.on(
    'dnd5e.restCompleted',
    restCompleted
  );
  globalThis.Hooks.once(
    'ready',
    async () => {
      if (!activeGM()) return;
      stressDefinition({
        notify: true
      });
      for (const actor of globalThis.game.actors ?? []) await deliverNotice(actor);
      for (const scene of globalThis.game.scenes ?? []) {
        for (const token of scene.tokens ?? []) if (token.actor && !token.actorLink) await deliverNotice(token.actor);
      }
    }
  );
  return true;
}
