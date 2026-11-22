export const AXES = [ '투지', '의지' ];
// 파생: 시작 R 이후 세 번의 폭주 턴을 보장하고 R+3 끝, 곧 R+4 진입에 붕괴한다.

export const RAMPAGE_ROUND_OFFSET = 4;

export const PC_STRESS = Object.freeze({
  white: 50,
  black: 100,
  releasedBlack: 70
});

export function stage(
  value,
  max
) {
  if (value <= 0) return '꺾임';
  if (value >= max) return '결연';
  if (value === 1) return '흔들림';
  return '동요';
}

export function initialState(
  stored,
  profile
) {
  const state = structuredClone(stored ?? {});
  state.current ??= {};
  state.broken ??= {};
  state.encounters ??= {};
  state.mode ??= null;
  state.type ??= null;
  state.awakened ??= false;
  state.retreat ??= false;
  for (const axis of AXES) {
    state.current[axis] = profile.max[axis] == null ? null : Math.max(
      0,
      Math.min(
        profile.max[axis],
        state.current[axis] ?? profile.max[axis]
      )
    );
  }
  state.stages = Object.fromEntries(AXES.map(axis => {
    return [ axis, profile.max[axis] == null ? null : stage(
      state.current[axis],
      profile.max[axis]
    ) ];
  }));
  return state;
}

export function encounterRecord(
  state,
  id = 'outside'
) {
  return state.encounters[id] ??= {
    used: [],
    rounds: [],
    braced: false,
    phase: false,
    awakening: false,
    zeroTransfer: false,
    awakenedDefeat: false
  };
}

export function brokenBranch(
  axis,
  state,
  profile,
  record
) {
  if (axis === '투지') return profile.grade === '보스' && !record.phase ? '페이즈 전환' : '무너짐';
  if ((profile.named || profile.grade === '보스') && !record.awakening) return '각성 판정';
  return profile.max.투지 == null || state.current.투지 > 0 ? '폭주' : '붕괴';
}

export function rampageExpired(
  start,
  round
) {
  return Number.isFinite(start) && round >= start + RAMPAGE_ROUND_OFFSET;
}
/** 한 사건에서 축마다 가장 큰 조건 하나. 동률은 원래 번호 순, 차감 먼저. */

export function eventConditions(conditions) {
  const chosen = [];
  for (const axis of AXES) {
    for (const direction of [ '차감', '향상' ]) {
      const rows = conditions.filter(row => {
        return row.group === `${axis} ${direction}`;
      }).sort((
        a,
        b
      ) => {
        return b.amount - a.amount || a.number - b.number;
      });
      if (rows.length) chosen.push(rows[0]);
    }
  }
  return chosen.sort((
    a,
    b
  ) => {
    return Number(a.group.endsWith('향상')) - Number(b.group.endsWith('향상'));
  });
}

export function changeResolve(
  stored,
  profile,
  request,
  combat = null
) {
  const state = initialState(
    stored,
    profile
  );
  const record = encounterRecord(
    state,
    combat?.id
  );
  const events = [];
  const warnings = [];
  const originalKey = request.number ? `${request.axis} ${request.direction} ${request.number}` : null;
  let {
    axis,
    direction,
    number,
    amount = 1
  } = request;
  const result = () => ({
    state: state,
    events: events,
    warnings: warnings,
    changed: events.length > 0 || delta !== 0,
    delta: delta
  });
  let delta = 0;
  if (profile.max[axis] == null) return result();
  if (originalKey && record.used.includes(originalKey) && !request.repeat) {
    warnings.push('이미 쓴 조건입니다. 다시 적용하려면 확인이 필요합니다.');
    return result();
  }
  if (state.mode === '폭주' && axis === '투지') {
    warnings.push('폭주 중에는 투지가 변하지 않습니다.');
    return result();
  }
  if (axis === '투지' && direction === '차감' && state.current.투지 === 0 && originalKey) {
    if (record.zeroTransfer) {
      warnings.push('투지 0에서 의지 차감 10으로 바꾸는 처리는 전투당 한 번입니다.');
      return result();
    }
    axis = '의지';
    direction = '차감';
    number = 10;
    amount = 1;
    warnings.push('투지가 0이므로 의지 차감 10으로 의지 1칸을 깎습니다(전투당 한 번).');
  }
  if (profile.max[axis] == null) return result();
  if (axis === '의지' && direction === '차감' && number === 10) {
    if (profile.max.투지 == null || state.current.투지 !== 0 || record.zeroTransfer) {
      warnings.push('의지 차감 10은 투지가 0인 적에게 전투당 한 번만 적용합니다.');
      return result();
    }
  }
  if (state.mode === '폭주' && axis === '의지' && direction === '차감' && originalKey) {
    record.used = [ ...new Set([ ...record.used, originalKey ]) ];
    if (number === 10) record.zeroTransfer = true;
    state.mode = '붕괴';
    state.type = null;
    events.push({
      kind: '붕괴'
    });
    return result();
  }
  if (direction === '향상' && state.current[axis] === 0) {
    warnings.push('0칸인 축은 향상할 수 없습니다. 페이즈 전환·각성 또는 전투 사이 회복이 필요합니다.');
    return result();
  }
  const round = combat ? record.rounds.find(row => {
    return row.round === combat.round;
  }) ?? {
    round: combat.round,
    changes: {},
    checks: []
  } : null;
  if (round && !record.rounds.includes(round)) record.rounds.push(round);
  const check = `${axis} 판정`;
  if (round && number === 12 && round.checks.includes(check)) {
    warnings.push('이 축의 PC 판정은 파티 전체를 합쳐 라운드마다 한 번입니다.');
    return result();
  }
  const capKey = `${axis} ${direction}`;
  const exempt = axis === '의지' && direction === '향상' && number === 11;
  let allowed = amount;
  if (round && !exempt) allowed = Math.min(
    amount,
    Math.max(
      0,
      (direction === '차감' ? 2 : 1) - (round.changes[capKey] ?? 0)
    )
  );
  const before = state.current[axis];
  const after = direction === '차감' ? Math.max(
    0,
    before - allowed
  ) : Math.min(
    profile.max[axis],
    before + allowed
  );
  delta = after - before;
  if (allowed < amount) warnings.push(`라운드 상한(한 축 차감 2칸·향상 1칸)으로 ${Math.abs(delta)}칸만 반영합니다.`);
  if (!delta) return result();
  state.current[axis] = after;
  state.stages[axis] = stage(
    after,
    profile.max[axis]
  );
  if (round && !exempt) round.changes[capKey] = (round.changes[capKey] ?? 0) + Math.abs(delta);
  if (round && number === 12) round.checks.push(check);
  if (originalKey) record.used = [ ...new Set([ ...record.used, originalKey ]) ];
  if (request.axis === '투지' && axis === '의지') {
    record.zeroTransfer = true;
    record.used = [ ...new Set([ ...record.used, '의지 차감 10' ]) ];
  }
  if (axis === '의지' && direction === '차감' && number === 10) record.zeroTransfer = true;
  if (axis === '투지' && after === 1 && before !== 1 && !record.braced) {
    record.braced = true;
    events.push({
      kind: '버팀'
    });
  }
  if (after === 0 && before > 0) {
    state.broken[axis] = true;
    events.push({
      kind: '꺾임',
      axis: axis
    });
    if (state.awakened) events.push({
      kind: '각성한 적 꺾임'
    });
    const branch = brokenBranch(
      axis,
      state,
      profile,
      record
    );
    if (branch === '무너짐') state.retreat = true;
    if ([ '폭주', '붕괴' ].includes(branch)) {
      state.mode = branch;
      state.type = null;
      state.rampageStart = branch === '폭주' ? combat?.round ?? null : null;
      state.modeStarted = combat ? `${combat.id}:${combat.round}:${combat.turn}` : null;
      state.modeCombatId = combat?.id ?? null;
    }
    events.push({
      kind: branch
    });
  }
  return result();
}

export function recoverResolve(
  stored,
  profile,
  reduce = false
) {
  const state = initialState(
    stored,
    profile
  );
  state.reduction ??= {};
  for (const axis of AXES) {
    const loss = reduce && state.broken[axis] && profile.max[axis] > 1 ? 1 : 0;
    state.reduction[axis] = (state.reduction[axis] ?? 0) + loss;
    state.current[axis] = profile.max[axis] == null ? null : profile.max[axis] - loss;
    state.stages[axis] = profile.max[axis] == null ? null : '결연';
    state.broken[axis] = false;
  }
  for (const id of Object.keys(state.encounters)) state.encounters[id] = null;
  state.mode = null;
  state.type = null;
  state.retreat = false;
  state.awakened = false;
  state.rampageStart = null;
  state.modeStarted = null;
  state.modeCombatId = null;
  state.awakeningOffer = null;
  return state;
}

export function stressChange(
  value,
  amount,
  tally = {
    up: 0,
    down: 0
  },
  {
    combat = true,
    black = false
  } = {}
) {
  if (black) return {
    value: value,
    delta: 0,
    tally: {
      ...tally
    },
    reason: '검은 광기 중에는 스트레스가 변하지 않습니다.'
  };
  const key = amount >= 0 ? 'up' : 'down';
  const allowed = combat ? Math.min(
    Math.abs(amount),
    Math.max(
      0,
      15 - (tally[key] ?? 0)
    )
  ) : Math.abs(amount);
  const next = Math.max(
    0,
    Math.min(
      100,
      value + Math.sign(amount) * allowed
    )
  );
  const delta = next - value;
  return {
    value: next,
    delta: delta,
    tally: {
      ...tally,
      [key]: (tally[key] ?? 0) + Math.abs(delta)
    },
    reason: allowed < Math.abs(amount) ? '전투당 스트레스 오름·내림 상한 15까지만 반영합니다.' : null
  };
}

export function determination(total) {
  return total >= 17 ? '백색 맹세' : '검은 광기';
}
