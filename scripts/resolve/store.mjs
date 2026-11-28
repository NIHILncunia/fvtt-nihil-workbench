import {
  resolveProfile
} from './parser.mjs';

import {
  initialState
} from './rules.mjs';

export const MODULE_ID = 'nihil-compendium-module';
// 같은 GM 계정으로 탭을 둘 열어도 카드를 한 번만 만들도록 이 탭을 구분한다(2026-11-28).
export const CLIENT_ID = Math.random().toString(36).slice(2, 12);

export const STATUS = Object.freeze({
  '퇴각': [ 'retreat', 'icons/svg/wingfoot.svg' ],
  '폭주': [ 'rampage', 'icons/svg/sword.svg' ],
  '붕괴': [ 'collapse', 'icons/svg/terror.svg' ],
  '각성': [ 'awakening', 'icons/svg/aura.svg' ],
  '백색 맹세': [ 'white-oath', 'icons/svg/angel.svg' ],
  '검은 광기': [ 'black-madness', 'icons/svg/skull.svg' ]
});

export function statusId(name) {
  return `nihil-resolve-${STATUS[name][0]}`;
}

export function storedResolve(actor) {
  return structuredClone(actor?.getFlag?.(
    MODULE_ID,
    'resolve'
  ) ?? {});
}

export function scenePeers(actor) {
  const scene = actor?.token?.parent ?? globalThis.canvas?.scene;
  const baseId = actor?.token?.actorId ?? actor?.id;
  return Array.from(scene?.tokens ?? []).filter(token => {
    return token.actorId === baseId && token.actor;
  }).sort((
    a,
    b
  ) => {
    return a.id.localeCompare(b.id);
  });
}
/** 무리는 같은 장면·기본 액터의 id가 가장 앞선 토큰을 대표로 쓴다. */

export function resolveActor(actor) {
  const peers = scenePeers(actor);
  if (storedResolve(actor).settings?.group || peers.some(token => {
    return storedResolve(token.actor).settings?.group;
  })) {
    return peers[0]?.actor ?? actor;
  }
  return actor;
}

export function readResolve(input) {
  const actor = resolveActor(input);
  const stored = storedResolve(actor);
  const profile = resolveProfile(
    actor.items ?? [],
    stored
  );
  return {
    actor: actor,
    profile: profile,
    state: initialState(
      stored,
      profile
    )
  };
}

/** 비연결 액터는 토큰·장면으로, 연결된 액터는 액터 id로 참가 전투를 찾는다. */
export function actorCombat(actor) {
  if (!actor) return null;
  const token = actor.token;
  const sceneId = token?.parent?.id;
  const participates = combat => {
    if (!combat?.started) return false;
    return Array.from(combat.combatants ?? []).some(entry => {
      if (token && !token.actorLink) {
        return sceneId != null && (combat.scene?.id ?? combat.sceneId) === sceneId && (entry.tokenId ?? entry.token?.id) === token.id;
      }
      return (entry.actorId ?? entry.actor?.id) === actor.id;
    });
  };
  const current = globalThis.game?.combat;
  if (participates(current)) return current;
  return Array.from(globalThis.game?.combats ?? []).filter(participates).sort((
    a,
    b
  ) => {
    return (b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0) || a.id.localeCompare(b.id);
  })[0] ?? null;
}

export function combatContext(actor) {
  const combat = actorCombat(actor);
  if (!combat) return null;
  return {
    id: combat.id,
    round: combat.round,
    turn: combat.turn
  };
}

export function activeGM() {
  return Boolean(globalThis.game?.user?.isGM && globalThis.game?.users?.activeGM?.isSelf);
}

export function assertGM() {
  if (!globalThis.game?.user?.isGM) throw new Error('투지·의지 조작은 GM만 할 수 있습니다.');
}

export function warn(message) {
  globalThis.ui?.notifications?.warn(message);
}

const jobs = new Map();

export function serial(
  key,
  task
) {
  const pending = (jobs.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  jobs.set(
    key,
    pending
  );
  pending.finally(() => {
    if (jobs.get(key) === pending) jobs.delete(key);
  }).catch(() => {});
  return pending;
}

export async function syncIcons(
  actor,
  state
) {
  const targets = state.settings?.group ? scenePeers(actor).map(token => {
    return token.actor;
  }) : [ actor ];
  for (const target of new Set(targets.length ? targets : [ actor ])) {
    for (const name of [ '퇴각', '폭주', '붕괴', '각성' ]) {
      const active = name === '퇴각' ? Boolean(state.retreat) : name === '각성' ? Boolean(state.awakened) : state.mode === name;
      if (target.toggleStatusEffect) await target.toggleStatusEffect(
        statusId(name),
        {
          active: active
        }
      );
    }
  }
}

export async function saveResolve(
  actor,
  state,
  events = []
) {
  assertGM();
  if (actor.type === 'npc' && state.mode) {
    const profile = resolveProfile(
      actor.items ?? [],
      state
    );
    const preset = profile.reactions[state.mode]?.type;
    if (preset != null) state.type = preset;
  }
  const notified = new Set(storedResolve(actor).notifiedIds ?? []);
  state.notices = (state.notices ?? []).filter(notice => {
    return !notified.has(notice.id);
  });
  if (events.length) {
    state.notices.push({
      id: globalThis.foundry.utils.randomID(),
      combatId: combatContext(actor)?.id ?? null,
      events: events
    });
  }
  // 알림 확인은 별도 큐가 leaf 경로로 갱신한다. 오래된 전체 flag 복사로 덮지 않는다.
  delete state.notifiedIds;
  await actor.update(
    {
      [`flags.${MODULE_ID}.resolve`]: state
    },
    {
      ncmResolveClient: CLIENT_ID
    }
  );
  if (actor.type === 'npc') await syncIcons(
    actor,
    state
  );
  return state;
}
