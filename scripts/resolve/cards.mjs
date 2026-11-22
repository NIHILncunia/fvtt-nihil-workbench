import {
  TABLES
} from './tables.mjs';

import {
  descriptionText
} from './parser.mjs';

import {
  runCardAction
} from './actions.mjs';

import {
  escapeHtml as e,
  pcStress
} from './stress.mjs';

import {
  MODULE_ID,
  activeGM,
  combatContext,
  readResolve,
  serial,
  storedResolve,
  warn
} from './store.mjs';

export const DEFAULT_AWAKENING = '전투가 끝날 때까지 명중 굴림과 내성 굴림이 유리해지고, 공격의 피해에 RT-02 약한 전개 피해만큼을 더한다.';

const turnRules = '강제 행동은 행동과 이동을 씁니다. 보너스 행동은 쓰지 않습니다. 행동을 할 수 없으면 제약대로 행동하고 외침은 없습니다. 외침은 30피트 안 대상에게 닿습니다. 적의 투지·의지 차감은 진행자가 해당 적 시트에서 처리합니다(한 적에게 전투당 1칸, 적 편 외침은 라운드마다 하나, 차감 상한에 포함).';

const paragraphs = text => e(text).split('\n').filter(Boolean).map(line => {
  return `<p>${line}</p>`;
}).join('');

const stress = (
  label,
  amount
) => ({
  label: label,
  kind: 'stress',
  amount: amount
});

export async function postCard(
  actor,
  title,
  body,
  actions = []
) {
  if (!activeGM()) return;
  const buttons = actions.map((
    action,
    index
  ) => {
    return `<button type="button" data-resolve-action="${index}">${e(action.label)}</button>`;
  }).join('');
  return globalThis.ChatMessage.create({
    content: `<section class="ncm-resolve-card"><h3>${e(actor.name)} — ${e(title)}</h3>${body}<div class="ncm-resolve-card-actions">${buttons}</div></section>`,
    whisper: Array.from(globalThis.game.users).filter(user => {
      return user.isGM;
    }).map(user => {
      return user.id;
    }),
    speaker: {
      alias: actor.name
    },
    flags: {
      [MODULE_ID]: {
        resolveCard: {
          actorUuid: actor.uuid,
          combatId: combatContext()?.id ?? null,
          actions: actions,
          used: []
        }
      }
    }
  });
}

function reaction(
  profile,
  kind
) {
  const feat = profile.reactions[kind];
  return feat ? `<h4>${e(feat.name)}</h4>${paragraphs(feat.text)}` : '';
}

function typeRow(
  profile,
  state,
  mode
) {
  const feat = profile.reactions[mode];
  return TABLES[mode]?.find(row => {
    return row.number === (feat?.type ?? state.type);
  });
}

function npcTurnText(
  profile,
  state,
  mode,
  forced
) {
  const feat = profile.reactions[mode];
  const row = typeRow(
    profile,
    state,
    mode
  );
  if (!feat) return row ? paragraphs(forced ? `${row.actions[profile.kind]}\n외침: ${row.cry}` : row.restriction) : '<p>먼저 유형을 정하세요.</p>';
  // 피트의 임의 서술은 요약하지 않는다. 표준 제약/강제 행동/외침 필드가 있으면 그 부분만 보여 준다.
  const labels = {};
  for (const match of feat.text.matchAll(/(제약|강제 행동(?:\([^)]*\))?|외침)\s*[:：]\s*([\s\S]*?)(?=(?:제약|강제 행동(?:\([^)]*\))?|외침)\s*[:：]|$)/g)) {
    labels[match[1].startsWith('강제') ? '강제 행동' : match[1]] = match[2].trim();
  }
  return paragraphs(forced && labels['강제 행동'] ? `${labels['강제 행동']}\n외침: ${labels.외침 ?? row?.cry ?? '피트 참조'}` : !forced && labels.제약 ? labels.제약 : feat.text);
}

function cryActions(text) {
  const match = descriptionText(text).match(/(?:PC|아군)(?:\s*스트레스)?\s*(?:스트레스\s*)?([+＋−-])\s*(3|5)/);
  if (!match) return [];
  const amount = (match[1] === '+' || match[1] === '＋' ? 1 : -1) * Number(match[2]);
  return [ stress(
    `외침 ${amount > 0 ? '+' : '−'}${Math.abs(amount)}`,
    amount
  ) ];
}

export async function publishEvent(
  actor,
  event
) {
  if (!activeGM()) return;
  const {
    profile,
    state
  } = readResolve(actor);
  const mode = event.mode ?? state.mode;
  const pc = storedResolve(actor).pc;
  let title = event.kind;
  let body = '';
  let actions = [];
  switch (event.kind) {
    case '꺾임':
    title = `${event.axis} 꺾임`;
    body = '<p>마지막 칸을 깎은 조건을 만든 PC를 고르세요. PC 행동이 아니었다면 스트레스를 바꾸지 않습니다.</p>';
    actions = [ stress(
      '꺾은 PC 스트레스 −5',
      -5
    ) ];
    break;

    case '각성한 적 꺾임':
    case '각성한 적 쓰러짐':
    actions = [ stress(
      '꺾거나 쓰러뜨린 PC 스트레스 −10',
      -10
    ) ];
    break;

    case '버팀':
    case '무너짐':
    body = reaction(
      profile,
      event.kind
    ) + '<p>다음 턴에 그 적의 행동으로 처리합니다.</p>';
    if (event.kind === '무너짐') body += '<p>결과 뒤에는 싸움을 그만둡니다. 공격받아도 다시 싸우지 않습니다. 증원은 남은 적의 4분의 1 이하가 두 라운드 뒤 끝에 도착합니다. 인질은 해치지 않으며 PC가 5피트 안에 오면 놓습니다. 이형의 마지막 목표가 PC면 다시 굴립니다. 달아나 본진에 알리면 RT-06 위협 +1입니다.</p>';
    if (!profile.reactions[event.kind]) actions.push({
      kind: 'rt-roll',
      table: event.kind,
      label: `RT-07 ${event.kind} d8`
    });
    break;

    case '페이즈 전환':
    body = '<p>이 전투의 첫 투지 꺾임입니다. 의지는 그대로 두고 투지를 가득 채웁니다. HP로 정한 2페이즈가 있으면 바로 시작합니다. 2페이즈가 없으면 기본 각성을 적용합니다.</p>' + paragraphs(DEFAULT_AWAKENING);
    actions = [ {
      kind: 'phase',
      label: '페이즈 전환'
    } ];
    break;

    case '페이즈 적용':
    body = '<p>투지를 가득 채웠습니다. 의지는 그대로입니다. 2페이즈 행동은 SBI를 따릅니다. 2페이즈가 없으면 아래 기본 각성을 적용합니다.</p>' + paragraphs(DEFAULT_AWAKENING);
    break;

    case '각성 판정':
    body = '<p>이름 있는 적·보스는 전투당 한 번 각성을 판정합니다. 6이 아니면 투지에 따라 폭주·붕괴합니다.</p>';
    actions = [ {
      kind: 'awakening-roll',
      label: '각성 d6'
    } ];
    break;

    case '각성 후보':
    body = '<p>각성 d6: 6</p>' + (reaction(
      profile,
      '각성'
    ) || paragraphs(DEFAULT_AWAKENING));
    actions = [ {
      kind: 'awakening-apply',
      offer: event.offer,
      label: '각성 적용'
    } ];
    break;

    case '각성 적용':
    body = (reaction(
      profile,
      '각성'
    ) || paragraphs(DEFAULT_AWAKENING)) + '<p>투지·의지를 가득 채우고 최대 HP의 4분의 1을 회복했습니다.</p>';
    actions = [ stress(
      '본 PC 스트레스 +10',
      10
    ) ];
    break;

    case '폭주':
    case '붕괴':
    body = (event.total ? `<p>각성 d6: ${event.total}</p>` : '') + reaction(
      profile,
      event.kind
    );
    body += event.kind === '폭주' ? '<p>명중 굴림과 이 적을 노리는 명중 굴림이 유리합니다. 투지는 변하지 않습니다. 의지 차감 조건을 받거나 3라운드 뒤 끝이 되면 붕괴합니다.</p>' : '<p>PC를 공격하거나 해치는 주문을 쓰지 않습니다. 회복해도 이 전투에는 다시 싸우지 않습니다.</p>';
    if (!profile.reactions[event.kind]) actions.push({
      kind: 'type-roll',
      mode: event.kind,
      label: `${event.kind} 유형 d12`
    });
    if (event.kind === '폭주') actions.push(stress(
      '본 PC 스트레스 +5',
      5
    ));
    break;

    case 'RT 결과':
    {
      const row = TABLES[event.table][event.total - 1];
      title = `RT-07 ${event.table} d8: ${event.total} (${profile.kind})`;
      body = paragraphs(row.actions[profile.kind]);
      if (event.table === '무너짐') body += '<p>다음 턴에 한 번 처리한 뒤 싸움을 그만둡니다. 공격받아도 다시 싸우지 않습니다. 인질은 해치지 않고 PC가 5피트 안에 오면 놓습니다. 이형의 마지막 목표가 PC면 다시 굴립니다.</p>';
      actions = [ {
        kind: 'rt-roll',
        table: event.table,
        label: '다시 굴림'
      } ];
      break;
    }

    case '유형 결과':
    {
      const row = TABLES[mode][event.total - 1];
      title = `${mode} ${event.total} ${row.name}`;
      body = paragraphs(`제약: ${row.restriction}\n강제 행동: ${row.actions[profile.kind]}\n외침: ${row.cry}`);
      actions = [ {
        kind: 'type-roll',
        mode: mode,
        label: '다시 굴림'
      } ];
      break;
    }

    case 'NPC 턴':
    title = `${mode} — 턴 시작`;
    body = paragraphs(turnRules);
    if (!typeRow(
      profile,
      state,
      mode
    ) && !profile.reactions[mode]) actions.push({
      kind: 'type-roll',
      mode: mode,
      label: `${mode} 유형 d12`
    });
    actions.push({
      kind: 'npc-turn',
      mode: mode,
      stamp: event.stamp,
      label: '턴 굴림 d6'
    });
    break;

    case 'NPC 턴 결과':
    {
      const forced = event.total <= 2;
      title = `턴 굴림 d6: ${event.total} — ${forced ? '강제 행동과 외침' : '제약'}`;
      body = npcTurnText(
        profile,
        state,
        mode,
        forced
      ) + paragraphs(turnRules);
      if (forced) {
        const feat = profile.reactions[mode];
        const cry = feat ? feat.text.match(/외침\s*[:：]([\s\S]*)/)?.[1] ?? '' : typeRow(
          profile,
          state,
          mode
        )?.cry ?? '';
        actions = cryActions(cry);
      }
      break;
    }

    case '결단 판정':
    actions = [ {
      kind: 'determination',
      label: '결단 판정 d20'
    } ];
    break;

    case '결단 결과':
    title = `결단 판정 d20: ${event.total} — ${event.pcKind}`;
    actions = [ {
      kind: 'pc-type-roll',
      pcKind: event.pcKind,
      roll: event.roll,
      label: '상태 d12'
    } ];
    break;

    case 'PC 상태 후보':
    {
      const row = TABLES[event.pcKind][event.total - 1];
      title = `${event.pcKind}: ${row.name} (d12: ${event.total})`;
      body = paragraphs([ ...TABLES['공통 효과'][event.pcKind], row.effect ?? row.restriction, row.action ? `강제 행동(진행자가 움직임): ${row.action}` : '', `외침: ${row.cry}`, '긴 휴식을 마칠 때까지' ].filter(Boolean).join('\n'));
      actions = [ {
        kind: 'pc-apply',
        pcKind: event.pcKind,
        roll: event.roll,
        number: event.total,
        label: '상태 적용'
      }, {
        kind: 'pc-type-roll',
        pcKind: event.pcKind,
        roll: event.roll,
        label: '다시 굴림'
      } ];
      break;
    }

    case 'PC 턴':
    title = `${pc?.kind}: ${pc ? TABLES[pc.kind][pc.number - 1].name : ''}`;
    actions = [ {
      kind: 'pc-turn',
      stamp: event.stamp,
      label: '턴 굴림 d6'
    } ];
    break;

    case 'PC 턴 결과':
    {
      if (!pc) return;
      const row = TABLES[pc.kind][pc.number - 1];
      title = `턴 굴림 d6: ${event.total} — ${pc.kind}: ${row.name}`;
      if (event.total <= 2) {
        body = paragraphs(pc.kind === '백색 맹세' ? `맹세의 외침: ${row.cry}` : `강제 행동(진행자가 PC를 움직입니다): ${row.action}\n외침: ${row.cry}`);
        body += '<p>외침은 30피트 안에서 듣거나 볼 수 있는 아군 PC에게 닿습니다. 적의 칸은 진행자가 그 적 시트에서 직접 깎습니다(전투당 한 적에게 1칸).</p>';
        actions = cryActions(row.cry);
      } else body = paragraphs(row.effect ?? row.restriction);
      break;
    }

    case '긴 휴식':
    if (!pc) return;
    actions = [ {
      kind: 'pc-release',
      pcKind: pc.kind,
      number: pc.number,
      label: pc.kind === '검은 광기' ? '상태 풀고 스트레스 70' : '상태 풀기'
    } ];
    break;

    default:
    return;
  }
  await postCard(
    actor,
    title,
    body,
    actions
  );
}

export async function selectPcs() {
  const actors = Array.from(globalThis.game.actors).filter(actor => {
    return pcStress(actor);
  });
  if (!actors.length) {
    warn('스트레스 자원이 있는 PC가 없습니다.');
    return null;
  }
  return globalThis.foundry.applications.api.DialogV2.wait({
    window: {
      title: '스트레스를 바꿀 PC'
    },
    content: `<div class="ncm-resolve-pcs">${actors.map(actor => {
      return `<label><input type="checkbox" name="pc" value="${e(actor.uuid)}">${e(actor.name)}</label>`;
    }).join('')}</div>`,
    buttons: [ {
      action: 'apply',
      label: '적용',
      callback: (
        _event,
        _button,
        dialog
      ) => {
        const selected = new Set(Array.from(dialog.element.querySelectorAll('[name="pc"]:checked')).map(input => {
          return input.value;
        }));
        return actors.filter(actor => {
          return selected.has(actor.uuid);
        });
      }
    }, {
      action: 'cancel',
      label: '취소',
      callback: () => null
    } ],
    close: () => null
  });
}

export function renderResolveCard(
  message,
  html
) {
  const card = message.getFlag?.(
    MODULE_ID,
    'resolveCard'
  );
  if (!card) return;
  const root = html?.querySelector ? html : html?.[0];
  for (const button of root?.querySelectorAll?.('[data-resolve-action]') ?? []) {
    const index = Number(button.dataset.resolveAction);
    button.disabled = !globalThis.game.user.isGM || card.used.includes(index);
    button.addEventListener(
      'click',
      async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!globalThis.game.user.isGM) return;
        button.disabled = true;
        try {
          await serial(
            `card:${message.id}`,
            async () => {
              const latest = message.getFlag(
                MODULE_ID,
                'resolveCard'
              );
              if (latest.used.includes(index)) return;
              if (latest.combatId !== (combatContext()?.id ?? null)) {
                warn('다른 전투의 카드입니다. 현재 전투의 카드를 사용하세요.');
                return;
              }
              const action = latest.actions[index];
              const actor = await globalThis.fromUuid(latest.actorUuid);
              if (!actor || !action) return;
              const pcs = action.kind === 'stress' ? await selectPcs() : [];
              if (action.kind === 'stress' && !pcs?.length) return;
              const applied = await runCardAction(
                actor,
                action,
                pcs
              );
              if (applied === false) {
                warn('현재 상태에 맞지 않거나 이미 적용한 카드입니다.');
                return;
              }
              await message.setFlag(
                MODULE_ID,
                'resolveCard',
                {
                  ...latest,
                  used: [ ...latest.used, index ]
                }
              );
            }
          );
        } catch (error) {
          globalThis.ui?.notifications?.error(error.message);
          console.error(
            `${MODULE_ID} | 투지·의지 카드`,
            error
          );
        } finally {
          button.disabled = !globalThis.game.user.isGM || message.getFlag(
            MODULE_ID,
            'resolveCard'
          ).used.includes(index);
        }
      }
    );
  }
}
