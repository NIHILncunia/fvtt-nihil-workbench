// 전투 요약과 리플레이(2026-11-28). 순수 함수라 node 시험으로 확인한다.
// 리플레이 재생기는 내보낸 HTML 안에서 돌도록 함수 원문을 그대로 넣는다(replayRuntimeSource).
//
// 재생 자료(payload):
//   { v: 2, width, height, image, frame: { x0, y0, k },
//     tokens: [{ id, name, img, disposition, w, h, x, y, hp, max }],
//     orders: { [round]: [tokenId, …] },
//     steps:  [{ type, round, id?, x?, y?, amount?, after?, label?, text }] }
// 출력 픽셀 = (캔버스 좌표 - x0/y0) * k
import { escapeHtml, formatDuration } from './shared.mjs';

const STEP_TYPES = new Set(['turn', 'move', 'join', 'damage', 'heal', 'down', 'defeated', 'status-on', 'status-off', 'crit', 'fumble']);

export function sideLabel(disposition) {
  if (disposition === 1) return '아군';
  if (disposition === -1) return '적';
  if (disposition === -2) return '비밀';
  return '중립';
}

function stepText(event) {
  switch (event.type) {
    case 'turn': return `${event.round}라운드 — ${event.name ?? '?'}의 차례`;
    case 'move': return `${event.target} 이동`;
    case 'join': return `${event.name} 전투 합류`;
    case 'damage': return `${event.source && event.source !== event.target ? `${event.source} → ` : ''}${event.target}: ${event.amount} 피해 (HP ${event.after})`;
    case 'heal': return `${event.target}: ${event.amount} 회복 (HP ${event.after})`;
    case 'down': return `${event.target} 쓰러짐`;
    case 'defeated': return `${event.target} 전투 불능`;
    case 'status-on': return `${event.target} 상태 +${event.label ?? event.status}`;
    case 'status-off': return `${event.target} 상태 −${event.label ?? event.status}`;
    case 'crit': return `${event.name} 자연 20!`;
    case 'fumble': return `${event.name} 자연 1`;
    default: return event.type;
  }
}

/** 공개판에서 뺄 참가자(숨긴 토큰). */
function hiddenSets(record) {
  const hidden = (record.participants ?? []).filter((participant) => participant.hidden);
  return {
    ids: new Set(hidden.map((participant) => participant.tokenId).filter(Boolean)),
    names: new Set(hidden.map((participant) => participant.name)),
  };
}

/** 기록 → 요약. 숨긴 참가자는 언제나 뺀다(공개 자료이므로). */
export function summarizeCombat(record) {
  const { ids: hiddenIds, names: hiddenNames } = hiddenSets(record);
  const isHiddenEvent = (event) => (event.tokenId ? hiddenIds.has(event.tokenId) : hiddenNames.has(event.target));
  const participants = (record.participants ?? [])
    .filter((participant) => !participant.hidden)
    .map((participant) => ({
      name: participant.name,
      tokenId: participant.tokenId,
      disposition: participant.disposition,
      dealt: participant.dealt ?? 0,
      taken: participant.taken ?? 0,
      healed: participant.healed ?? 0,
      downs: participant.downs ?? 0,
      crits: participant.crits ?? 0,
      fumbles: participant.fumbles ?? 0,
      startHp: participant.startHp ?? null,
      endHp: participant.hp?.value ?? null,
      maxHp: participant.hp?.max ?? null,
      defeated: Boolean(participant.defeated || (participant.hp?.value !== null && participant.hp?.value !== undefined && participant.hp.value <= 0)),
    }));
  const top = participants.filter((participant) => participant.dealt > 0).sort((left, right) => right.dealt - left.dealt)[0] ?? null;
  const perRound = new Map();
  for (const event of record.events ?? []) {
    if (!event.round) continue;
    if (!perRound.has(event.round)) perRound.set(event.round, { round: event.round, damage: 0, healed: 0, downs: [] });
    const entry = perRound.get(event.round);
    if (isHiddenEvent(event)) continue;
    if (event.type === 'damage') entry.damage += Number(event.amount) || 0;
    if (event.type === 'heal') entry.healed += Number(event.amount) || 0;
    if (event.type === 'down' || event.type === 'defeated') entry.downs.push(event.target);
  }
  return {
    id: record.id,
    combatId: record.combatId,
    sceneId: record.sceneId,
    sceneName: record.sceneName,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: Math.max(0, (record.endedAt ?? record.startedAt) - record.startedAt),
    rounds: record.round,
    top: top ? { name: top.name, dealt: top.dealt } : null,
    participants,
    timeline: [...perRound.values()]
      .sort((left, right) => left.round - right.round)
      .map((entry) => ({ ...entry, downs: [...new Set(entry.downs)] })),
  };
}

export function combatSummaryTableHtml(summary) {
  const rows = [...summary.participants]
    .sort((left, right) => (right.disposition - left.disposition) || (right.dealt - left.dealt))
    .map((participant) => {
      const hp = participant.maxHp ? `${participant.endHp ?? '?'}/${participant.maxHp}` : '';
      const dice = `${participant.crits ? `★${participant.crits}` : ''}${participant.fumbles ? ` ✗${participant.fumbles}` : ''}`.trim();
      return `<tr class="side-${participant.disposition}"><td>${escapeHtml(participant.name)}${participant.defeated ? ' <span class="down">✕</span>' : ''}</td><td>${sideLabel(participant.disposition)}</td><td>${participant.dealt}</td><td>${participant.taken}</td><td>${participant.healed || ''}</td><td>${hp}</td><td>${dice}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>이름</th><th>진영</th><th>준 피해</th><th>받은 피해</th><th>회복</th><th>끝 HP</th><th>20/1</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function combatCardHtml(
  summary,
  { replayHtml = '', anchorId = '' } = {},
) {
  const downs = summary.participants.filter((participant) => participant.defeated).map((participant) => escapeHtml(participant.name));
  const timeline = summary.timeline
    .filter((round) => round.damage || round.healed || round.downs.length)
    .map((round) => `<li>${round.round}라운드: 피해 ${round.damage}${round.healed ? ` · 회복 ${round.healed}` : ''}${round.downs.length ? ` · 쓰러짐 ${round.downs.map(escapeHtml).join(', ')}` : ''}</li>`)
    .join('');
  return `<section class="log-combat"${anchorId ? ` id="${anchorId}"` : ''}>
  <div class="log-combat-head">⚔️ 전투 종료${summary.sceneName ? ` — ${escapeHtml(summary.sceneName)}` : ''}<span>${summary.rounds}라운드 · ${formatDuration(summary.durationMs)}</span></div>
  <div class="log-combat-body">
    ${replayHtml}
    ${summary.top ? `<div>최다 피해: <b>${escapeHtml(summary.top.name)}</b> (${summary.top.dealt})</div>` : ''}
    ${combatSummaryTableHtml(summary)}
    ${downs.length ? `<div>쓰러짐: ${downs.join(', ')}</div>` : ''}
    ${timeline ? `<ul class="log-combat-rounds">${timeline}</ul>` : ''}
  </div>
</section>`;
}

export function combatStartHtml(
  summary,
  anchorId = '',
) {
  const names = summary.participants.map((participant) => escapeHtml(participant.name)).join(', ');
  return `<div class="message desc log-combat-start"${anchorId ? ` id="${anchorId}"` : ''}>⚔️ 전투 시작${summary.sceneName ? ` — ${escapeHtml(summary.sceneName)}` : ''}<div class="log-combat-names">${names}</div></div>`;
}

/** 기록 사건 → 재생 단계. 보이는 토큰만 남기고 같은 차례 표시는 하나로 줄인다. */
export function replayStepsFromRecord(
  record,
  visibleIds,
) {
  const visible = new Set(visibleIds);
  const steps = [];
  for (const event of record.events ?? []) {
    if (!STEP_TYPES.has(event.type)) continue;
    const id = event.tokenId ?? null;
    if (event.type === 'turn') {
      if (id && !visible.has(id)) continue;
    } else if (!id || !visible.has(id)) {
      continue;
    }
    const step = { type: event.type, round: event.round ?? null, text: stepText(event) };
    if (id) step.id = id;
    if (event.type === 'move' || event.type === 'join') {
      if (Number.isFinite(event.x)) step.x = event.x;
      if (Number.isFinite(event.y)) step.y = event.y;
    }
    if (event.type === 'damage' || event.type === 'heal') {
      step.amount = event.amount;
      step.after = event.after;
    }
    if (event.type === 'status-on' || event.type === 'status-off') {
      step.status = event.status;
      step.label = event.label ?? event.status;
    }
    const last = steps.at(-1);
    if (step.type === 'turn' && last?.type === 'turn' && last.id === step.id && last.round === step.round) continue;
    // 쓰러짐 뒤에 붙는 「사망」 상태는 같은 말을 되풀이하므로 뺀다.
    if (step.type === 'status-on' && step.status === 'dead' && steps.some((item) => item.id === id && (item.type === 'down' || item.type === 'defeated'))) continue;
    steps.push(step);
  }
  return steps;
}

/** 라운드별 차례 순서. 기록에 없으면(옛 기록) 각 라운드에 처음 나온 차례 순서로 만든다. */
export function replayOrders(
  record,
  visibleIds,
) {
  const visible = new Set(visibleIds);
  const orders = {};
  for (const round of record.rounds ?? []) {
    if (Array.isArray(round.order) && round.order.length) {
      orders[round.round] = round.order.filter((id) => visible.has(id));
    }
  }
  for (const event of record.events ?? []) {
    if (event.type !== 'turn' || !event.tokenId || !visible.has(event.tokenId)) continue;
    if (Array.isArray(record.rounds?.find((round) => round.round === event.round)?.order)) continue;
    orders[event.round] ??= [];
    if (!orders[event.round].includes(event.tokenId)) orders[event.round].push(event.tokenId);
  }
  return orders;
}

/** 0단계(시작 배치)와 각 단계 뒤의 판 상태. states[i]를 i번째 위치에서 보여 준다. */
export function computeReplayStates(payload) {
  const base = { pos: {}, hp: {}, down: {}, status: {}, present: {}, dealt: {}, active: null, round: 1, fx: null, recent: [] };
  for (const token of payload.tokens ?? []) {
    base.pos[token.id] = { x: token.x, y: token.y };
    base.hp[token.id] = token.hp;
    base.down[token.id] = false;
    base.status[token.id] = [];
    base.present[token.id] = !token.joinsLater;
    base.dealt[token.id] = 0;
  }
  const states = [base];
  let current = base;
  (payload.steps ?? []).forEach((step, index) => {
    const next = {
      pos: { ...current.pos },
      hp: { ...current.hp },
      down: { ...current.down },
      status: { ...current.status },
      present: { ...current.present },
      dealt: { ...current.dealt },
      active: current.active,
      round: step.round ?? current.round,
      fx: null,
      recent: [...current.recent, index].slice(-5),
    };
    const id = step.id;
    switch (step.type) {
      case 'turn':
        next.active = id ?? null;
        break;
      case 'join':
        next.present[id] = true;
        if (Number.isFinite(step.x) && Number.isFinite(step.y)) next.pos[id] = { x: step.x, y: step.y };
        break;
      case 'move':
        if (id in next.pos) next.pos[id] = { x: step.x, y: step.y };
        next.present[id] = true;
        break;
      case 'damage':
        next.hp[id] = step.after;
        next.fx = { id, text: `-${step.amount}`, color: '#e03131', hit: true };
        if (current.active && current.active !== id) next.dealt[current.active] = (next.dealt[current.active] || 0) + (Number(step.amount) || 0);
        break;
      case 'heal':
        next.hp[id] = step.after;
        next.fx = { id, text: `+${step.amount}`, color: '#2b9348' };
        break;
      case 'down':
      case 'defeated':
        next.down[id] = true;
        next.fx = { id, text: '쓰러짐', color: '#e03131', hit: true };
        break;
      case 'status-on':
        next.status[id] = [...(next.status[id] ?? []), step.label ?? step.status];
        next.fx = { id, text: `+${step.label ?? step.status}`, color: '#7048e8' };
        break;
      case 'status-off':
        next.status[id] = (next.status[id] ?? []).filter((status) => status !== (step.label ?? step.status));
        break;
      case 'crit':
        next.fx = { id, text: '★20', color: '#e0a800' };
        break;
      case 'fumble':
        next.fx = { id, text: '1…', color: '#868e96' };
        break;
      default:
        break;
    }
    states.push(next);
    current = next;
  });
  return states;
}

/**
 * 이름표가 겹치지 않게 세로로 밀어 낸다. labels: [{ x, y, w, h }] (가운데 x, 위 y).
 * 돌려주는 값은 같은 순서의 새 y.
 */
export function separateLabels(labels) {
  const placed = [];
  const order = labels.map((label, index) => ({ ...label, index })).sort((left, right) => left.y - right.y || left.x - right.x);
  const result = new Array(labels.length);
  for (const label of order) {
    let y = label.y;
    let moved = true;
    let guard = 0;
    while (moved && guard < 20) {
      moved = false;
      guard += 1;
      for (const other of placed) {
        const overlapX = Math.abs(label.x - other.x) < (label.w + other.w) / 2;
        const overlapY = y < other.y + other.h && y + label.h > other.y;
        if (overlapX && overlapY) {
          y = other.y + other.h + 1;
          moved = true;
        }
      }
    }
    placed.push({ x: label.x, y, w: label.w, h: label.h });
    result[label.index] = y;
  }
  return result;
}

/** 내보낸 페이지 안에서 돈다: .log-replay마다 재생기를 만든다. */
export function replayPlayerMain() {
  document.querySelectorAll('.log-replay').forEach((root) => {
    let payload;
    try {
      payload = JSON.parse(root.querySelector('.log-replay-data').textContent);
    } catch (error) {
      return;
    }
    const states = computeReplayStates(payload);
    const steps = payload.steps;
    const tokensById = {};
    payload.tokens.forEach((token) => { tokensById[token.id] = token; });
    const canvas = document.createElement('canvas');
    canvas.width = payload.width;
    canvas.height = payload.height;
    canvas.className = 'log-replay-canvas';
    canvas.tabIndex = 0;
    const bar = document.createElement('div');
    bar.className = 'log-replay-bar';
    bar.innerHTML = '<button type="button" data-r="first" title="처음">⏮</button><button type="button" data-r="prev-round" title="이전 라운드">«</button><button type="button" data-r="prev" title="이전">◀</button>'
      + '<button type="button" data-r="play" title="재생">▶</button><button type="button" data-r="next" title="다음">▶|</button><button type="button" data-r="next-round" title="다음 라운드">»</button><button type="button" data-r="last" title="끝">⏭</button>'
      + '<input type="range" min="0" value="0" aria-label="재생 위치"><select title="속도"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option></select>'
      + '<span class="log-replay-label"></span>';
    const order = document.createElement('div');
    order.className = 'log-replay-order';
    const caption = document.createElement('div');
    caption.className = 'log-replay-caption';
    const recent = document.createElement('ol');
    recent.className = 'log-replay-recent';
    root.prepend(recent);
    root.prepend(caption);
    root.prepend(order);
    root.prepend(bar);
    root.prepend(canvas);
    const range = bar.querySelector('input');
    range.max = String(steps.length);
    const label = bar.querySelector('.log-replay-label');
    const playButton = bar.querySelector('[data-r="play"]');
    const speedSelect = bar.querySelector('select');
    const ctx = canvas.getContext('2d');
    const background = new Image();
    background.src = payload.image;
    const images = {};
    payload.tokens.forEach((token) => {
      if (!token.img) return;
      const img = new Image();
      img.src = token.img;
      images[token.id] = img;
    });
    const frame = payload.frame;
    const ringColor = { 1: '#2f9e44', 0: '#e0a800', '-1': '#e03131', '-2': '#7048e8' };
    let index = 0;
    let timer = null;
    let anim = null;

    function boxOf(token, pos) {
      return { x: (pos.x - frame.x0) * frame.k, y: (pos.y - frame.y0) * frame.k, w: token.w * frame.k, h: token.h * frame.k };
    }

    function orderFor(round) {
      return (payload.orders && (payload.orders[round] || payload.orders[String(round)])) || payload.tokens.map((token) => token.id);
    }

    function renderOrder(state) {
      const ids = orderFor(state.round);
      order.innerHTML = '';
      ids.forEach((id) => {
        const token = tokensById[id];
        if (!token || !state.present[id]) return;
        const chip = document.createElement('span');
        chip.className = 'log-replay-chip side-' + token.disposition + (state.active === id ? ' is-active' : '') + (state.down[id] ? ' is-down' : '');
        const hp = state.hp[id];
        const ratio = token.max && hp !== null && hp !== undefined ? Math.max(0, Math.min(1, hp / token.max)) : null;
        chip.innerHTML = (token.img ? '<img alt="" src="' + token.img + '">' : '')
          + '<span class="name"></span>'
          + (ratio === null ? '' : '<span class="hp"><i style="width:' + Math.round(ratio * 100) + '%"></i></span>');
        chip.querySelector('.name').textContent = token.name;
        if (ratio !== null) chip.title = token.name + ' HP ' + hp + '/' + token.max;
        order.appendChild(chip);
      });
    }

    function renderRecent(state) {
      recent.innerHTML = '';
      state.recent.slice().reverse().forEach((stepIndex, position) => {
        const step = steps[stepIndex];
        const item = document.createElement('li');
        item.className = 'type-' + step.type + (position === 0 ? ' is-now' : '');
        item.textContent = step.text;
        recent.appendChild(item);
      });
    }

    function draw(stateIndex, t) {
      const state = states[stateIndex];
      const prev = states[Math.max(0, stateIndex - 1)];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (background.complete && background.naturalWidth) ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const labels = [];
      const drawn = [];
      payload.tokens.forEach((token) => {
        if (!state.present[token.id]) return;
        const to = state.pos[token.id];
        const from = t < 1 && prev.present[token.id] ? prev.pos[token.id] : to;
        const pos = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        const box = boxOf(token, pos);
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const r = Math.min(box.w, box.h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        if (state.down[token.id]) ctx.filter = 'grayscale(1) brightness(0.7)';
        const img = images[token.id];
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, box.x, box.y, box.w, box.h);
        else {
          ctx.fillStyle = '#555';
          ctx.fillRect(box.x, box.y, box.w, box.h);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold ' + Math.round(r) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(token.name || '?').slice(0, 1), cx, cy);
        }
        ctx.restore();
        const active = state.active === token.id;
        const hit = state.fx && state.fx.id === token.id && state.fx.hit;
        ctx.lineWidth = Math.max(2, r * (active ? 0.16 : 0.09));
        ctx.strokeStyle = hit ? '#ff6b6b' : active ? '#ffd43b' : (ringColor[String(token.disposition)] || '#e0a800');
        if (active || hit) {
          ctx.shadowColor = hit ? '#ff6b6b' : '#ffd43b';
          ctx.shadowBlur = r * (hit ? 0.9 * (1 - t * 0.5) : 0.6);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (state.down[token.id]) {
          ctx.strokeStyle = '#e03131';
          ctx.lineWidth = Math.max(3, r * 0.14);
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.55, cy - r * 0.55); ctx.lineTo(cx + r * 0.55, cy + r * 0.55);
          ctx.moveTo(cx + r * 0.55, cy - r * 0.55); ctx.lineTo(cx - r * 0.55, cy + r * 0.55);
          ctx.stroke();
        }
        const hp = state.hp[token.id];
        let bottom = box.y + box.h + 3;
        if (token.max && hp !== null && hp !== undefined) {
          const ratio = Math.max(0, Math.min(1, hp / token.max));
          const bw = box.w * 0.9;
          const bh = Math.max(4, r * 0.14);
          const bx = cx - bw / 2;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(bx - 1, bottom - 1, bw + 2, bh + 2);
          ctx.fillStyle = ratio > 0.5 ? '#40c057' : ratio > 0.25 ? '#fab005' : '#fa5252';
          ctx.fillRect(bx, bottom, bw * ratio, bh);
          bottom += bh + 3;
        }
        const statuses = state.status[token.id] || [];
        if (statuses.length) {
          ctx.font = '600 ' + Math.max(10, Math.round(r * 0.26)) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.fillStyle = '#d0bfff';
          const text = statuses.slice(0, 2).join('·') + (statuses.length > 2 ? '…' : '');
          ctx.strokeText(text, cx, box.y - 2);
          ctx.fillText(text, cx, box.y - 2);
        }
        const fontSize = Math.max(11, Math.round(r * 0.32));
        ctx.font = '600 ' + fontSize + 'px sans-serif';
        labels.push({ x: cx, y: bottom, w: ctx.measureText(token.name).width + 6, h: fontSize + 2 });
        drawn.push({ token: token, cx: cx, fontSize: fontSize, box: box });
      });
      const ys = separateLabels(labels);
      drawn.forEach((entry, i) => {
        ctx.font = '600 ' + entry.fontSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.fillStyle = state.active === entry.token.id ? '#ffe066' : '#fff';
        ctx.strokeText(entry.token.name, entry.cx, ys[i]);
        ctx.fillText(entry.token.name, entry.cx, ys[i]);
      });
      if (state.fx) {
        const token = tokensById[state.fx.id];
        if (token && state.present[token.id]) {
          const box = boxOf(token, state.pos[token.id]);
          const rise = 14 * Math.min(1, t);
          ctx.font = '800 ' + Math.max(18, Math.round(box.h * 0.4)) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.fillStyle = state.fx.color;
          ctx.strokeText(state.fx.text, box.x + box.w / 2, box.y - 4 - rise);
          ctx.fillText(state.fx.text, box.x + box.w / 2, box.y - 4 - rise);
        }
      }
    }

    function show(nextIndex, animate) {
      index = Math.max(0, Math.min(steps.length, nextIndex));
      range.value = String(index);
      const state = states[index];
      label.textContent = (state.round || 1) + '라운드 · ' + index + '/' + steps.length;
      caption.textContent = index === 0 ? '전투 시작 배치' : steps[index - 1].text;
      renderOrder(state);
      renderRecent(state);
      if (anim) cancelAnimationFrame(anim);
      if (!animate) { draw(index, 1); return; }
      const started = performance.now();
      const duration = 450 / Number(speedSelect.value || 1);
      const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        draw(index, t);
        if (t < 1) anim = requestAnimationFrame(tick);
      };
      anim = requestAnimationFrame(tick);
    }

    function roundJump(direction) {
      const currentRound = states[index].round || 1;
      if (direction < 0) {
        let target = 0;
        for (let i = index - 1; i >= 0; i -= 1) {
          if ((states[i].round || 1) < currentRound) { target = i; break; }
        }
        let first = target;
        while (first > 0 && (states[first - 1].round || 1) === (states[target].round || 1)) first -= 1;
        show(first, false);
        return;
      }
      for (let i = index + 1; i <= steps.length; i += 1) {
        if ((states[i].round || 1) > currentRound) { show(i, false); return; }
      }
      show(steps.length, false);
    }

    function stop() {
      clearInterval(timer);
      timer = null;
      playButton.textContent = '▶';
    }

    function play() {
      if (index >= steps.length) show(0, false);
      playButton.textContent = '⏸';
      timer = setInterval(() => {
        if (index >= steps.length) { stop(); return; }
        show(index + 1, true);
      }, 1000 / Number(speedSelect.value || 1));
    }

    bar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      const action = button && button.dataset.r;
      if (!action) return;
      if (action === 'play') { if (timer) stop(); else play(); return; }
      stop();
      if (action === 'first') show(0, false);
      if (action === 'prev') show(index - 1, false);
      if (action === 'next') show(index + 1, true);
      if (action === 'last') show(steps.length, false);
      if (action === 'prev-round') roundJump(-1);
      if (action === 'next-round') roundJump(1);
    });
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { stop(); show(index + 1, true); event.preventDefault(); }
      if (event.key === 'ArrowLeft') { stop(); show(index - 1, false); event.preventDefault(); }
      if (event.key === ' ') { if (timer) stop(); else play(); event.preventDefault(); }
    });
    canvas.addEventListener('click', () => canvas.focus());
    range.addEventListener('input', () => { stop(); show(Number(range.value), false); });
    speedSelect.addEventListener('change', () => { if (timer) { stop(); play(); } });
    background.onload = () => show(index, false);
    root.nxReplay = { states: states, steps: steps, get index() { return index; }, show: (i) => show(i, false), play: play, stop: stop };
    show(0, false);
  });
}

/** 내보낸 페이지에 넣을 재생기 원문. */
export function replayRuntimeSource() {
  return `(function(){\n${computeReplayStates.toString()}\n${separateLabels.toString()}\n(${replayPlayerMain.toString()})();\n})();`;
}
