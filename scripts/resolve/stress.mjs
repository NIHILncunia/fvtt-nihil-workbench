import {
  getSortedResourceDefinitions
} from '../resources/resource-definitions.mjs';

import {
  getActorResourceStore,
  buildActorResourceEntry,
  setActorResourceValue
} from '../resources/actor-resources.mjs';

import {
  TABLES
} from './tables.mjs';

import {
  PC_STRESS,
  stressChange
} from './rules.mjs';

import {
  MODULE_ID,
  actorCombat,
  assertGM,
  combatContext,
  saveResolve,
  serial,
  statusId,
  storedResolve,
  warn
} from './store.mjs';

let missingNotified = false;

export function stressDefinition({
  notify = false
} = {}) {
  const definition = getSortedResourceDefinitions().find(row => {
    return row.name === '스트레스';
  });
  if (!definition && notify && globalThis.game?.user?.isGM && !missingNotified) {
    missingNotified = true;
    warn('스트레스 자원이 없어 PC 결단 판정을 사용하지 않습니다. 자원 관리에서 스트레스를 등록하세요.');
  }
  return definition;
}

export function pcStress(actor) {
  const definition = stressDefinition();
  if (!definition || actor.type !== 'character') return null;
  const store = getActorResourceStore(actor);
  if (!store[definition.id]) return null;
  return {
    definition: definition,
    value: buildActorResourceEntry(
      definition,
      store[definition.id]
    ).value
  };
}

export async function applyStress(
  actors,
  amount
) {
  assertGM();
  // 한 카드의 여러 PC와 서로 다른 카드의 전투 누적 갱신을 같은 큐에서 직렬화한다.
  return serial(
    'resolve-stress',
    async () => {
      for (const actor of actors) {
        const entry = pcStress(actor);
        if (!entry) continue;
        const combat = actorCombat(actor);
        const tallies = structuredClone(combat?.getFlag(
          MODULE_ID,
          'resolveStress'
        ) ?? {});
        const result = stressChange(
          entry.value,
          amount,
          tallies[actor.uuid],
          {
            combat: Boolean(combat),
            black: storedResolve(actor).pc?.kind === '검은 광기'
          }
        );
        if (result.reason) warn(`${actor.name}: ${result.reason}`);
        if (!result.delta) continue;
        await setActorResourceValue(
          actor,
          entry.definition.id,
          result.value
        );
        if (combat) {
          tallies[actor.uuid] = result.tally;
          await combat.setFlag(
            MODULE_ID,
            'resolveStress',
            tallies
          );
        }
      }
    }
  );
}

export async function removePcEffect(actor) {
  const ids = Array.from(actor.effects ?? []).filter(effect => {
    return effect.getFlag?.(
      MODULE_ID,
      'resolvePc'
    );
  }).map(effect => {
    return effect.id;
  });
  if (ids.length) await actor.deleteEmbeddedDocuments(
    'ActiveEffect',
    ids
  );
}

export async function applyPcState(
  actor,
  kind,
  number
) {
  assertGM();
  const entry = pcStress(actor);
  const row = TABLES[kind]?.find(item => {
    return item.number === number;
  });
  if (!entry || !row || ![ '백색 맹세', '검은 광기' ].includes(kind)) return;
  await removePcEffect(actor);
  const state = storedResolve(actor);
  const context = combatContext(actor);
  const description = [ ...TABLES['공통 효과'][kind], row.effect ?? row.restriction, row.action ? `강제 행동(턴 굴림 1~2, 진행자가 움직임): ${row.action}` : '', `외침: ${row.cry}`, '긴 휴식을 마칠 때까지', '수치는 진행자가 적용합니다.' ].filter(Boolean).map(text => {
    return `<p>${escapeHtml(text)}</p>`;
  }).join('');
  await actor.createEmbeddedDocuments(
    'ActiveEffect',
    [ {
      name: `${kind}: ${row.name}`,
      img: globalThis.CONFIG.statusEffects[statusId(kind)]?.img,
      showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS,
      description: description,
      statuses: [ statusId(kind) ],
      changes: [],
      flags: {
        [MODULE_ID]: {
          resolvePc: true
        }
      }
    } ]
  );
  state.pc = {
    kind: kind,
    number: number,
    started: context ? `${context.id}:${context.round}:${context.turn}` : null
  };
  state.determinationPending = false;
  state.determinationKind = null;
  state.determinationRoll = null;
  state.pcCandidate = null;
  await saveResolve(
    actor,
    state
  );
  // 결단 판정의 값 변경은 전투·장면 상한과 별개. 검은 광기 적용 전에 이미 100이다.
  await setActorResourceValue(
    actor,
    entry.definition.id,
    kind === '백색 맹세' ? PC_STRESS.white : PC_STRESS.black
  );
}

export async function releasePcState(actor) {
  assertGM();
  const state = storedResolve(actor);
  const black = state.pc?.kind === '검은 광기';
  const entry = pcStress(actor);
  await removePcEffect(actor);
  state.pc = null;
  state.determinationKind = null;
  state.determinationRoll = null;
  state.pcCandidate = null;
  await saveResolve(
    actor,
    state
  );
  if (black && entry) await setActorResourceValue(
    actor,
    entry.definition.id,
    PC_STRESS.releasedBlack
  );
}

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    char => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '\'': '&#39;'
      }[char];
    }
  );
}
