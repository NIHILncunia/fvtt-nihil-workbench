import {
  TABLES
} from './tables.mjs';

import {
  AXES,
  changeResolve,
  encounterRecord,
  brokenBranch,
  determination,
  recoverResolve,
  stage
} from './rules.mjs';

import {
  applyPcState,
  applyStress,
  pcStress,
  releasePcState
} from './stress.mjs';

import {
  assertGM,
  combatContext,
  readResolve,
  resolveActor,
  saveResolve,
  serial,
  storedResolve,
  warn
} from './store.mjs';

export async function changeActorResolve(
  input,
  request
) {
  assertGM();
  const actor = resolveActor(input);
  return serial(
    actor.uuid,
    async () => {
      const {
        state,
        profile
      } = readResolve(actor);
      const result = changeResolve(
        state,
        profile,
        request,
        combatContext()
      );
      result.warnings.forEach(warn);
      if (result.changed) await saveResolve(
        actor,
        result.state,
        result.events
      );
      return result;
    }
  );
}

export async function recoverActor(
  input,
  reduce
) {
  assertGM();
  const actor = resolveActor(input);
  return serial(
    actor.uuid,
    async () => {
      const {
        state,
        profile
      } = readResolve(actor);
      await saveResolve(
        actor,
        recoverResolve(
          state,
          profile,
          reduce
        )
      );
    }
  );
}

export async function rollDie(sides) {
  const roll = await new globalThis.Roll(`1d${sides}`).evaluate();
  return roll.total;
}

function enterMode(
  state,
  mode
) {
  const combat = combatContext();
  state.mode = mode;
  state.type = null;
  state.rampageStart = mode === '폭주' ? combat?.round ?? null : null;
  state.modeStarted = combat ? `${combat.id}:${combat.round}:${combat.turn}` : null;
  state.modeCombatId = combat?.id ?? null;
}
/** 카드의 모든 변경은 최신 액터 상태를 다시 읽고 검증한 뒤 수행한다. */

export async function runCardAction(
  input,
  action,
  selected = []
) {
  assertGM();
  const actor = resolveActor(input);
  if (action.kind === 'stress') return applyStress(
    selected,
    action.amount
  );
  return serial(
    actor.uuid,
    async () => {
      const {
        profile
      } = readResolve(actor);
      const state = actor.type === 'npc' ? readResolve(actor).state : storedResolve(actor);
      const combat = combatContext();
      const record = actor.type === 'npc' ? encounterRecord(
        state,
        combat?.id
      ) : null;
      const events = [];
      switch (action.kind) {
        case 'phase':
        {
          if (state.current.투지 !== 0 || profile.grade !== '보스' || record.phase) return false;
          record.phase = true;
          state.current.투지 = profile.max.투지;
          state.stages.투지 = stage(
            state.current.투지,
            profile.max.투지
          );
          state.retreat = false;
          events.push({
            kind: '페이즈 적용'
          });
          break;
        }

        case 'awakening-roll':
        {
          if (state.current.의지 !== 0 || record.awakening || !(profile.named || profile.grade === '보스')) return false;
          record.awakening = true;
          const total = await rollDie(6);
          if (total === 6) {
            state.awakeningOffer = globalThis.foundry.utils.randomID();
            events.push({
              kind: '각성 후보',
              total: total,
              offer: state.awakeningOffer
            });
          } else {
            const mode = brokenBranch(
              '의지',
              state,
              profile,
              record
            );
            enterMode(
              state,
              mode
            );
            events.push({
              kind: mode,
              total: total
            });
          }
          break;
        }

        case 'awakening-apply':
        {
          if (!state.awakeningOffer || state.awakeningOffer !== action.offer || state.current.의지 !== 0) return false;
          state.awakeningOffer = null;
          state.awakened = true;
          state.retreat = false;
          state.mode = null;
          state.type = null;
          for (const axis of AXES) {
            state.current[axis] = profile.max[axis];
            state.stages[axis] = profile.max[axis] ? '결연' : null;
          }
          const hp = actor.system.attributes.hp;
          await actor.update({
            'system.attributes.hp.value': Math.min(
              hp.max,
              hp.value + Math.floor(hp.max / 4)
            )
          });
          events.push({
            kind: '각성 적용'
          });
          break;
        }

        case 'rt-roll':
        {
          const total = await rollDie(8);
          events.push({
            kind: 'RT 결과',
            table: action.table,
            total: total
          });
          break;
        }

        case 'type-roll':
        {
          if (state.mode !== action.mode) return false;
          const total = await rollDie(12);
          state.type = total;
          events.push({
            kind: '유형 결과',
            mode: state.mode,
            total: total
          });
          break;
        }

        case 'npc-turn':
        {
          if (state.mode !== action.mode || !combat || action.stamp !== `${combat.id}:${combat.round}:${combat.turn}`) return false;
          if (!state.type && !profile.reactions[state.mode]) {
            warn('턴 굴림 전에 유형 d12로 유형을 정하세요.');
            return false;
          }
          if (state.mode === '붕괴' && (profile.reactions.붕괴?.type ?? state.type) === 3) return false;
          const total = await rollDie(6);
          events.push({
            kind: 'NPC 턴 결과',
            mode: state.mode,
            total: total
          });
          break;
        }

        case 'determination':
        {
          if (!state.determinationPending || state.pc?.kind === '검은 광기' || pcStress(actor)?.value !== 100) return false;
          const total = await rollDie(20);
          state.determinationKind = determination(total);
          state.determinationRoll = globalThis.foundry.utils.randomID();
          state.determinationPending = false;
          events.push({
            kind: '결단 결과',
            pcKind: state.determinationKind,
            total: total,
            roll: state.determinationRoll
          });
          break;
        }

        case 'pc-type-roll':
        {
          if (state.determinationKind !== action.pcKind || state.determinationRoll !== action.roll) return false;
          const total = await rollDie(12);
          state.pcCandidate = total;
          events.push({
            kind: 'PC 상태 후보',
            pcKind: action.pcKind,
            total: total,
            roll: action.roll
          });
          break;
        }

        case 'pc-apply':
        {
          if (state.pc || pcStress(actor)?.value !== 100 || state.determinationKind !== action.pcKind || state.determinationRoll !== action.roll || state.pcCandidate !== action.number) return false;
          await applyPcState(
            actor,
            action.pcKind,
            action.number
          );
          return true;
        }

        case 'pc-turn':
        {
          if (!state.pc || !combat || action.stamp !== `${combat.id}:${combat.round}:${combat.turn}`) return false;
          const total = await rollDie(6);
          events.push({
            kind: 'PC 턴 결과',
            total: total
          });
          break;
        }

        case 'pc-release':
        {
          if (!state.pc || state.pc.kind !== action.pcKind || state.pc.number !== action.number) return false;
          await releasePcState(actor);
          return true;
        }

        default:
        return false;
      }
      await saveResolve(
        actor,
        state,
        events
      );
      return true;
    }
  );
}
