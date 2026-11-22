import {
  GROUPS
} from './parser.mjs';

import {
  AXES,
  encounterRecord,
  stage
} from './rules.mjs';

import {
  changeActorResolve,
  recoverActor
} from './actions.mjs';

import {
  escapeHtml as e
} from './stress.mjs';

import {
  assertGM,
  combatContext,
  readResolve,
  saveResolve,
  serial,
  warn
} from './store.mjs';

function dialog(
  title,
  content,
  callback,
  label = '적용'
) {
  return globalThis.foundry.applications.api.DialogV2.wait({
    window: {
      title: title
    },
    content: `<div class="ncm-resolve-dialog">${content}</div>`,
    buttons: [ {
      action: 'apply',
      label: label,
      callback: (
        _event,
        _button,
        app
      ) => callback(app.element)
    }, {
      action: 'cancel',
      label: '취소',
      callback: () => null
    } ],
    close: () => null
  });
}

export async function configureResolve(input) {
  assertGM();
  const {
    actor,
    state,
    profile
  } = readResolve(input);
  const source = Boolean(profile.source);
  const fields = AXES.map(axis => {
    return `<label>${axis} 최대 <input name="${axis}" type="number" min="1" max="6" step="1" value="${source ? profile.baseMax[axis] ?? '' : state.settings?.[axis] ?? ''}" ${source ? 'disabled' : ''}></label>`;
  }).join('');
  const reductions = AXES.filter(axis => state.reduction?.[axis]).map(axis => {
    return `${axis}: 다시 만남으로 ${state.reduction[axis]}칸 감소, 현재 최대 ${profile.max[axis] ?? '없음'}`;
  }).join('<br>');
  const content = `${source ? '<p>피트가 정본입니다. 종류와 무리만 설정할 수 있습니다.</p>' : '<p>최대치를 비우면 해당 축을 사용하지 않습니다.</p>'}
    ${fields}
    ${reductions ? `<p>${reductions}</p>` : ''}
    <label>등급 <select name="grade" ${source ? 'disabled' : ''}>${[ '잡졸', '일반', '엘리트', '보스' ].map(grade => {
    return `<option ${grade === profile.grade ? 'selected' : ''}>${grade}</option>`;
  }).join('')}</select></label>
    <label><input name="named" type="checkbox" ${profile.named ? 'checked' : ''} ${source ? 'disabled' : ''}>이름 있음</label>
    <label>종류 <select name="kind">${[ '사람', '짐승', '이형' ].map(kind => {
    return `<option ${kind === profile.kind ? 'selected' : ''}>${kind}</option>`;
  }).join('')}</select></label>
    <label><input name="group" type="checkbox" ${profile.group ? 'checked' : ''}>무리(같은 장면의 같은 액터 토큰이 칸·아이콘을 함께 사용)</label>
    ${source ? `<p>${e(profile.basis)}<br>${e(profile.origin)}<br>${profile.leader ? '우두머리' : ''}</p>` : ''}`;
  const settings = await dialog(
    '투지·의지 설정',
    content,
    root => {
      const value = {
        ...state.settings,
        kind: root.querySelector('[name="kind"]').value,
        group: root.querySelector('[name="group"]').checked
      };
      if (!source) {
        for (const axis of AXES) {
          const raw = root.querySelector(`[name="${axis}"]`).value;
          if (raw && (!Number.isInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 6)) {
            warn('최대치는 1~6 사이의 정수로 입력하거나 비워 두세요.');
            return null;
          }
          value[axis] = raw ? Number(raw) : null;
        }
        value.grade = root.querySelector('[name="grade"]').value;
        value.named = root.querySelector('[name="named"]').checked;
      }
      return value;
    },
    '설정 저장'
  );
  if (!settings) return;
  await serial(
    actor.uuid,
    async () => {
      const latest = readResolve(actor).state;
      latest.settings = settings;
      await saveResolve(
        actor,
        latest
      );
      actor.sheet?.render();
      input.sheet?.render();
    }
  );
}

export async function chooseCondition(
  input,
  axis
) {
  assertGM();
  const {
    actor,
    profile,
    state
  } = readResolve(input);
  const record = encounterRecord(
    state,
    combatContext()?.id
  );
  const rows = GROUPS.filter(group => {
    return group.startsWith(axis);
  }).flatMap(group => {
    return profile.conditions[group];
  });
  const body = '<p>지금 일어난 사건만 적용합니다. 한 사건이 같은 축의 조건을 여러 개 채우면 가장 큰 칸 하나만 고릅니다(같으면 번호가 작은 것).</p>' + rows.map((
    row,
    index
  ) => {
    const used = record.used.includes(`${row.group} ${row.number}`);
    return `<label class="ncm-resolve-condition ${used ? 'is-used' : ''}"><input type="radio" name="condition" value="${index}"><span><strong>${e(row.group)} ${row.number}${used ? ' — 쓴 조건' : ''}</strong><br>${e(row.text)}${row.slots ? ` (${e(row.slots)}칸)` : ''}</span></label>`;
  }).join('');
  const chosen = await dialog(
    `${axis} 조건`,
    body,
    root => {
      const selected = root.querySelector('[name="condition"]:checked');
      return selected ? rows[Number(selected.value)] : null;
    }
  );
  if (!chosen) return;
  const repeat = record.used.includes(`${chosen.group} ${chosen.number}`);
  if (repeat && !await globalThis.foundry.applications.api.DialogV2.confirm({
    window: {
      title: '이미 쓴 조건'
    },
    content: `<p>${e(chosen.group)} ${chosen.number}은 이미 썼습니다. 다시 적용하시겠습니까?</p>`,
    yes: {
      label: '다시 적용'
    },
    no: {
      label: '취소'
    }
  })) return;
  let amount = chosen.amount;
  if (chosen.choice) {
    amount = await dialog(
      `${chosen.group} ${chosen.number}`,
      '<label>판정 결과 <select name="result"><option value="1">성공·대가 있는 성공: 1칸</option><option value="2">큰 성공: 2칸</option></select></label>',
      root => {
        return Number(root.querySelector('[name="result"]').value);
      }
    );
    if (amount == null) return;
  }
  await changeActorResolve(
    actor,
    {
      axis: axis,
      direction: chosen.group.endsWith('차감') ? '차감' : '향상',
      number: chosen.number,
      amount: amount,
      repeat: repeat
    }
  );
}

export async function recoverDialog(input) {
  assertGM();
  const {
    state,
    profile
  } = readResolve(input);
  const broken = AXES.some(axis => {
    return state.broken[axis] || profile.max[axis] && state.current[axis] === 0;
  });
  const result = await dialog(
    '전투 사이 회복',
    '<p>1시간(짧은 휴식) 이상 지났을 때 두 축을 가득 채우고 상태·아이콘을 풉니다.</p>' + (broken ? '<label><input type="checkbox" name="reduce">다시 만남: 꺾였던 축의 최대치를 1칸 줄이기(최소 1칸)</label>' : ''),
    root => {
      return {
        reduce: root.querySelector('[name="reduce"]')?.checked ?? false
      };
    }
  );
  if (result) await recoverActor(
    input,
    result.reduce
  );
}

export function injectResolveSheet(
  app,
  html
) {
  const input = app.actor ?? app.document;
  if (!globalThis.game?.user?.isGM || input?.type !== 'npc') return false;
  const root = html?.querySelector ? html : html?.[0];
  if (!root?.ownerDocument) return false;
  root.querySelector('.ncm-resolve-block')?.remove();
  // dnd5e 6.1.1 npc-header.hbs의 HP 막대. 다른 시트에서는 시트 본문 첫 줄로 대체한다.
  const hp = root.querySelector('.sheet-header .meter.hit-points, .meter.hit-points');
  const {
    profile,
    state
  } = readResolve(input);
  const block = root.ownerDocument.createElement('section');
  block.className = 'ncm-resolve-block';
  block.setAttribute(
    'aria-label',
    '투지와 의지'
  );
  const axes = AXES.filter(axis => {
    return profile.max[axis];
  });
  const rows = axes.map(axis => {
    const name = stage(
      state.current[axis],
      profile.max[axis]
    );
    const circles = Array.from(
      {
        length: profile.max[axis]
      },
      (
        _,
        index
      ) => {
        return `<button type="button" class="ncm-resolve-slot ${index < state.current[axis] ? 'is-filled' : ''}" data-resolve-axis="${axis}" aria-label="${axis} 1칸 차감. 우클릭하면 1칸 향상" title="클릭: 1칸 차감 / 우클릭: 1칸 향상"></button>`;
      }
    ).join('');
    return `<div class="ncm-resolve-row ${name === '흔들림' ? 'is-shaken' : name === '꺾임' ? 'is-broken' : ''}"><strong>${axis}</strong><div class="ncm-resolve-slots">${circles}</div><span>${name}</span><button type="button" data-resolve-condition="${axis}">조건</button></div>`;
  }).join('');
  if (!axes.length) block.className += ' is-empty';
  block.innerHTML = `<div class="ncm-resolve-tools">${axes.length ? '<span>투지와 의지</span>' : ''}<button type="button" data-resolve-settings aria-label="투지·의지 설정" title="투지·의지 설정"><i class="fa-solid fa-gear"></i></button></div>${rows}${axes.length ? '<button type="button" data-resolve-recover>전투 사이 회복</button>' : ''}`;
  if (hp) {
    hp.after(block);
  } else {
    (root.querySelector('.window-content') ?? root).prepend(block);
  }
  const run = task => Promise.resolve().then(task).catch(error => {
    globalThis.ui?.notifications?.error(error.message);
    console.error(
      'nihil-compendium-module | 투지·의지 시트',
      error
    );
  });
  block.addEventListener(
    'click',
    event => {
      const button = event.target.closest('button');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      run(async () => {
        if (button.hasAttribute('data-resolve-settings')) {
          await configureResolve(input);
        } else if (button.hasAttribute('data-resolve-recover')) {
          await recoverDialog(input);
        } else if (button.dataset.resolveCondition) {
          await chooseCondition(
            input,
            button.dataset.resolveCondition
          );
        } else if (button.dataset.resolveAxis) {
          await changeActorResolve(
            input,
            {
              axis: button.dataset.resolveAxis,
              direction: '차감',
              amount: 1
            }
          );
        }
        app.render();
      });
    }
  );
  block.addEventListener(
    'contextmenu',
    event => {
      const button = event.target.closest('[data-resolve-axis]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      run(async () => {
        await changeActorResolve(
          input,
          {
            axis: button.dataset.resolveAxis,
            direction: '향상',
            amount: 1
          }
        );
        app.render();
      });
    }
  );
  return true;
}
