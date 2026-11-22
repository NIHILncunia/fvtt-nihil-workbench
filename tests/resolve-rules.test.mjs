import assert from 'node:assert/strict';

import test from 'node:test';

import {
  TABLES
} from '../scripts/resolve/tables.mjs';

import {
  GROUPS,
  parseResolveFeats,
  resolveProfile
} from '../scripts/resolve/parser.mjs';

import {
  PC_STRESS,
  brokenBranch,
  changeResolve,
  determination,
  encounterRecord,
  eventConditions,
  initialState,
  rampageExpired,
  recoverResolve,
  stage,
  stressChange
} from '../scripts/resolve/rules.mjs';

import {
  toDescriptionHtml
} from '../scripts/statblock-importer/core.mjs';

test(
  '조건에 우두머리·보스가 있어도 적의 등급·우두머리 여부로 오인하지 않음',
  () => {
    const parsed = parseResolveFeats([ {
      type: 'feat',
      name: '투지 3 · 의지 3',
      system: {
        description: {
          value: '일반.\n투지 차감(투지 차감 8)\n- 우두머리의 HP가 절반 이하가 됨(1칸)\n투지 향상(투지 향상 11)\n- 보스가 페이즈를 전환함(1칸)'
        }
      }
    } ]);
    assert.equal(
      parsed.grade,
      '일반'
    );
    assert.equal(
      parsed.leader,
      false
    );
  }
);

const karven = `엘리트, 이름 있음, 맹세단의 우두머리. 근거 없음. 근원은 맞수(은사슬 기사 「엘리네」).
투지 차감(투지 차감 1·6·11·12)
- 자기 HP가 절반 이하가 됨(1칸)
- 5피트 안의 맹세단원이 쓰러짐(1칸)
- 한 PC의 한 턴에 맹세단원 둘 이상이 쓰러짐(1칸)
- PC가 행동을 써서 위협하기 판정(성공 1칸, 큰 성공 2칸)
투지 향상(투지 향상 4·5·6·8)
- PC에게 장검 치명타를 맞힘(1칸)
- PC 하나가 기절·마비·무력화 상태가 됨(1칸)
- PC 하나가 전장 밖으로 물러남(1칸)
- 한 번에 최대 HP의 4분의 1 이상을 회복받음(1칸)
의지 차감(의지 차감 4·10·11, 근원 12 맞수)
- 보이지 않는 공격자에게 공격받음(1칸)
- 투지가 꺾인 뒤 투지 차감 조건을 또 받음(1칸)
- 엘리네에게 치명타를 맞음(2칸)
의지 향상(의지 향상 2·4·8)
- PC가 건 정신 내성 효과에 성공함(1칸)
- 동료가 각성함(1칸)
- PC가 구경꾼이나 제3자를 해침(1칸)`;

const feat = description => ({
  id: 'resolve',
  type: 'feat',
  name: '투지 4 · 의지 3',
  system: {
    description: {
      value: description
    }
  }
});

const reaction = {
  type: 'feat',
  name: '(폭주) 맹세의 사냥',
  system: {
    description: {
      value: '<p>유형: 집착. 제약: 자기 의지를 꺾은 PC만 노린다. 강제 행동(턴 굴림 1~2): 이름을 외치며 친다. 외침: 그 PC 스트레스 +5. (폭주 6 집착)</p>'
    }
  }
};

for (const [ format, text ] of [ [ '줄글', karven ], [ 'SBI 임포터의 p/br', toDescriptionHtml(karven) ], [ 'p/strong/em/ul/li', karven.split('\n').map(line => {
  return line.startsWith('- ') ? `<ul><li><em>${line.slice(2)}</em></li></ul>` : `<p><strong>${line}</strong></p>`;
}).join('') ] ]) {
  test(
    `카르벤 피트 파서: ${format}`,
    () => {
      const parsed = parseResolveFeats([ feat(text), reaction ]);
      assert.deepEqual(
        parsed.max,
        {
          '투지': 4,
          '의지': 3
        }
      );
      assert.equal(
        parsed.grade,
        '엘리트'
      );
      assert.equal(
        parsed.named,
        true
      );
      assert.equal(
        parsed.leader,
        true
      );
      assert.equal(
        parsed.basis,
        '근거 없음'
      );
      assert.match(
        parsed.origin,
        /엘리네/
      );
      assert.deepEqual(
        GROUPS.map(group => {
          return parsed.conditions[group].map(row => {
            return row.number;
          });
        }),
        [ [ 1, 6, 11, 12 ], [ 4, 5, 6, 8 ], [ 4, 10, 11 ], [ 2, 4, 8 ] ]
      );
      assert.equal(
        parsed.conditions['투지 차감'][3].choice,
        true
      );
      assert.equal(
        parsed.conditions['의지 차감'][2].amount,
        2
      );
      assert.equal(
        parsed.reactions.폭주.type,
        6
      );
      assert.match(
        parsed.reactions.폭주.text,
        /외침: 그 PC 스트레스/
      );
    }
  );
}

test(
  '—, 가운뎃점·공백 변형과 피트 정본 우선',
  () => {
    for (const separator of [ '·', 'ㆍ', '・', '∙', '⋅' ]) {
      const item = {
        ...feat('보스, 이름 있음'),
        name: ` 투지 —${separator}의지 5 `
      };
      const profile = resolveProfile(
        [ item ],
        {
          settings: {
            '투지': 6,
            '의지': 1,
            grade: '잡졸',
            kind: '이형',
            group: true
          }
        }
      );
      assert.deepEqual(
        profile.max,
        {
          '투지': null,
          '의지': 5
        }
      );
      assert.equal(
        profile.grade,
        '보스'
      );
      assert.equal(
        profile.kind,
        '이형'
      );
      assert.equal(
        profile.group,
        true
      );
    }
  }
);

test(
  '피트 없음은 설정과 48개, 잡졸은 간이 목록만 사용',
  () => {
    assert.equal(
      parseResolveFeats([]).source,
      null
    );
    const normal = resolveProfile(
      [],
      {
        settings: {
          '투지': 3,
          '의지': 4
        }
      }
    );
    assert.equal(
      GROUPS.flatMap(group => {
        return normal.conditions[group];
      }).length,
      48
    );
    const minion = resolveProfile(
      [],
      {
        settings: {
          grade: '잡졸',
          '투지': 2,
          '의지': 2
        }
      }
    );
    assert.deepEqual(
      GROUPS.map(group => {
        return minion.conditions[group].map(row => {
          return row.number;
        });
      }),
      [ [ 7, 8, 9, 11, 12 ], [ 1, 2, 5, 6, 7, 11, 12 ], [ 5, 8, 9, 12 ], [ 4, 7, 8, 12 ] ]
    );
    assert.deepEqual(
      resolveProfile(
        [],
        {}
      ).max,
      {
        '투지': null,
        '의지': null
      }
    );
  }
);

for (const [ max, expected ] of [ [ 2, [ '꺾임', '흔들림', '결연' ] ], [ 3, [ '꺾임', '흔들림', '동요', '결연' ] ], [ 5, [ '꺾임', '흔들림', '동요', '동요', '동요', '결연' ] ] ]) {
  test(
    `${max}칸의 단계 이름`,
    () => {
      return assert.deepEqual(
        Array.from(
          {
            length: max + 1
          },
          (
            _,
            value
          ) => {
            return stage(
              value,
              max
            );
          }
        ),
        expected
      );
    }
  );
}

const profile = (extra = {}) => ({
  max: {
    '투지': 5,
    '의지': 5
  },
  grade: '일반',
  named: false,
  ...extra
});

const combat = {
  id: 'c1',
  round: 2,
  turn: 1
};

test(
  '의지 차감 10 직접 선택과 투지 0 전환은 같은 전투당 사용 기록을 공유',
  () => {
    const first = changeResolve(
      {
        current: {
          '투지': 0
        }
      },
      profile(),
      request({
        axis: '의지',
        number: 10
      }),
      combat
    );
    assert.equal(
      first.delta,
      -1
    );
    assert.equal(
      first.state.encounters.c1.zeroTransfer,
      true
    );
    const converted = changeResolve(
      first.state,
      profile(),
      request({
        number: 6
      }),
      combat
    );
    assert.equal(
      converted.delta,
      0
    );
    assert.equal(
      changeResolve(
        {},
        profile(),
        request({
          axis: '의지',
          number: 10
        }),
        combat
      ).delta,
      0
    );
  }
);

const request = (extra = {}) => ({
  axis: '투지',
  direction: '차감',
  number: 4,
  amount: 1,
  ...extra
});

test(
  '한 축 한 라운드 차감 2칸, 일부만 반영하고 다음 라운드는 새 상한',
  () => {
    const first = changeResolve(
      {},
      profile(),
      request(),
      combat
    );
    const second = changeResolve(
      first.state,
      profile(),
      request({
        number: 9,
        amount: 2
      }),
      combat
    );
    assert.equal(
      second.delta,
      -1
    );
    assert.match(
      second.warnings.join(),
      /1칸만/
    );
    const blocked = changeResolve(
      second.state,
      profile(),
      request({
        number: 1
      }),
      combat
    );
    assert.equal(
      blocked.delta,
      0
    );
    assert.equal(
      blocked.state.encounters.c1.used.includes('투지 차감 1'),
      false
    );
    assert.equal(
      changeResolve(
        second.state,
        profile(),
        request({
          number: 1
        }),
        {
          ...combat,
          round: 3
        }
      ).delta,
      -1
    );
  }
);

test(
  '향상 1칸 상한과 의지 향상 11의 2칸 예외는 상한을 소비하지 않음',
  () => {
    const base = {
      current: {
        '투지': 2,
        '의지': 1
      }
    };
    const first = changeResolve(
      base,
      profile(),
      request({
        direction: '향상',
        number: 2
      }),
      combat
    );
    const blocked = changeResolve(
      first.state,
      profile(),
      request({
        direction: '향상',
        number: 3
      }),
      combat
    );
    assert.equal(
      blocked.delta,
      0
    );
    const exempt = changeResolve(
      base,
      profile(),
      request({
        axis: '의지',
        direction: '향상',
        number: 11,
        amount: 2
      }),
      combat
    );
    assert.equal(
      exempt.delta,
      2
    );
    const ordinary = changeResolve(
      exempt.state,
      profile(),
      request({
        axis: '의지',
        direction: '향상',
        number: 2
      }),
      combat
    );
    assert.equal(
      ordinary.delta,
      1
    );
    assert.equal(
      changeResolve(
        ordinary.state,
        profile(),
        request({
          axis: '의지',
          direction: '향상',
          number: 11,
          amount: 2,
          repeat: true
        }),
        combat
      ).delta,
      1
    );
  }
);

test(
  '전투 밖은 라운드 상한 없음, 최대치 초과 불가, 입력 상태 보존',
  () => {
    const input = {
      current: {
        '투지': 2,
        '의지': 1
      }
    };
    const clone = structuredClone(input);
    const result = changeResolve(
      input,
      profile(),
      request({
        direction: '향상',
        amount: 6
      })
    );
    assert.equal(
      result.state.current.투지,
      5
    );
    assert.equal(
      result.delta,
      3
    );
    assert.deepEqual(
      input,
      clone
    );
  }
);

test(
  '0칸 향상 불가, 가득 찬 축은 쓴 조건으로 기록하지 않음',
  () => {
    const zero = changeResolve(
      {
        current: {
          '투지': 0
        }
      },
      profile(),
      request({
        direction: '향상'
      }),
      combat
    );
    assert.equal(
      zero.delta,
      0
    );
    assert.match(
      zero.warnings.join(),
      /0칸/
    );
    const full = changeResolve(
      {},
      profile(),
      request({
        direction: '향상'
      }),
      combat
    );
    assert.deepEqual(
      full.state.encounters.c1.used,
      []
    );
  }
);

test(
  '쓴 조건 재사용은 확인 뒤 허용, 변하지 않은 조건은 기록 없음',
  () => {
    const first = changeResolve(
      {},
      profile(),
      request()
    );
    assert.deepEqual(
      first.state.encounters.outside.used,
      [ '투지 차감 4' ]
    );
    assert.equal(
      changeResolve(
        first.state,
        profile(),
        request()
      ).delta,
      0
    );
    assert.equal(
      changeResolve(
        first.state,
        profile(),
        request({
          repeat: true
        })
      ).delta,
      -1
    );
  }
);

test(
  '투지 0의 차감은 의지 차감 10으로 전투당 한 번, 다음 전투에는 가능',
  () => {
    const first = changeResolve(
      {
        current: {
          '투지': 0
        }
      },
      profile(),
      request(),
      combat
    );
    assert.equal(
      first.state.current.의지,
      4
    );
    assert.equal(
      first.state.encounters.c1.zeroTransfer,
      true
    );
    assert.ok(first.state.encounters.c1.used.includes('의지 차감 10'));
    assert.equal(
      changeResolve(
        first.state,
        profile(),
        request({
          number: 6
        }),
        combat
      ).delta,
      0
    );
    assert.equal(
      changeResolve(
        first.state,
        profile(),
        request({
          number: 6
        }),
        {
          ...combat,
          id: 'c2'
        }
      ).delta,
      -1
    );
  }
);

test(
  '폭주 중 투지 고정, 의지 차감은 쓴 것으로 기록하고 붕괴',
  () => {
    const base = {
      mode: '폭주',
      current: {
        '투지': 3,
        '의지': 0
      }
    };
    assert.equal(
      changeResolve(
        base,
        profile(),
        request(),
        combat
      ).delta,
      0
    );
    assert.equal(
      changeResolve(
        base,
        profile(),
        request({
          direction: '향상'
        }),
        combat
      ).delta,
      0
    );
    const collapse = changeResolve(
      base,
      profile(),
      request({
        axis: '의지'
      }),
      combat
    );
    assert.equal(
      collapse.state.mode,
      '붕괴'
    );
    assert.ok(collapse.state.encounters.c1.used.includes('의지 차감 4'));
    assert.deepEqual(
      collapse.events,
      [ {
        kind: '붕괴'
      } ]
    );
  }
);

test(
  '보스 첫 투지 꺾임은 페이즈, 그 뒤 무너짐; 이름 있는 적은 각성 판정',
  () => {
    const state = initialState(
      {
        current: {
          '투지': 1,
          '의지': 1
        }
      },
      profile()
    );
    const record = encounterRecord(
      state,
      'c1'
    );
    assert.equal(
      brokenBranch(
        '투지',
        state,
        profile({
          grade: '보스'
        }),
        record
      ),
      '페이즈 전환'
    );
    record.phase = true;
    assert.equal(
      brokenBranch(
        '투지',
        state,
        profile({
          grade: '보스'
        }),
        record
      ),
      '무너짐'
    );
    assert.equal(
      brokenBranch(
        '의지',
        state,
        profile({
          named: true
        }),
        record
      ),
      '각성 판정'
    );
    record.awakening = true;
    assert.equal(
      brokenBranch(
        '의지',
        state,
        profile({
          named: true
        }),
        record
      ),
      '폭주'
    );
    state.current.투지 = 0;
    assert.equal(
      brokenBranch(
        '의지',
        state,
        profile(),
        record
      ),
      '붕괴'
    );
    assert.equal(
      brokenBranch(
        '의지',
        state,
        profile({
          max: {
            '투지': null,
            '의지': 3
          }
        }),
        record
      ),
      '폭주'
    );
  }
);

test(
  '버팀은 한 전투 한 번, 다시 흔들려도 카드 없음',
  () => {
    const first = changeResolve(
      {
        current: {
          '투지': 2
        }
      },
      profile(),
      request(),
      combat
    );
    assert.deepEqual(
      first.events,
      [ {
        kind: '버팀'
      } ]
    );
    const healed = changeResolve(
      first.state,
      profile(),
      request({
        direction: '향상',
        number: 2
      }),
      combat
    );
    const again = changeResolve(
      healed.state,
      profile(),
      request({
        number: 6
      }),
      {
        ...combat,
        round: 3
      }
    );
    assert.deepEqual(
      again.events,
      []
    );
  }
);

test(
  'PC 판정 12는 한 축 한 라운드 한 번',
  () => {
    const first = changeResolve(
      {},
      profile(),
      request({
        number: 12
      }),
      combat
    );
    const again = changeResolve(
      first.state,
      profile(),
      request({
        number: 12,
        repeat: true
      }),
      combat
    );
    assert.equal(
      again.delta,
      0
    );
    assert.match(
      again.warnings.join(),
      /파티 전체/
    );
  }
);

test(
  '폭주는 R+3 끝, R+4 진입에 붕괴',
  () => {
    assert.equal(
      rampageExpired(
        5,
        8
      ),
      false
    );
    assert.equal(
      rampageExpired(
        5,
        9
      ),
      true
    );
    assert.equal(
      rampageExpired(
        null,
        9
      ),
      false
    );
  }
);

test(
  '전투 사이 회복은 상태·기록을 풀고 꺾인 축만 최소 1까지 최대치 감소',
  () => {
    const p = profile({
      max: {
        '투지': 1,
        '의지': 3
      }
    });
    const next = recoverResolve(
      {
        current: {
          '투지': 0,
          '의지': 0
        },
        broken: {
          '투지': true,
          '의지': true
        },
        mode: '붕괴',
        awakened: true,
        retreat: true,
        encounters: {
          c1: {
            used: [ '투지 차감 1' ]
          }
        }
      },
      p,
      true
    );
    assert.deepEqual(
      next.current,
      {
        '투지': 1,
        '의지': 2
      }
    );
    assert.deepEqual(
      next.reduction,
      {
        '투지': 0,
        '의지': 1
      }
    );
    assert.equal(
      next.mode,
      null
    );
    assert.equal(
      next.encounters.c1,
      null
    );
    assert.equal(
      next.awakened,
      false
    );
  }
);

test(
  '한 사건은 축·방향별 최대 칸, 동률은 번호가 작은 것, 차감 먼저',
  () => {
    const rows = eventConditions([ {
      group: '투지 차감',
      amount: 1,
      number: 4
    }, {
      group: '투지 차감',
      amount: 1,
      number: 1
    }, {
      group: '투지 차감',
      amount: 2,
      number: 9
    }, {
      group: '의지 차감',
      amount: 1,
      number: 6
    }, {
      group: '투지 향상',
      amount: 1,
      number: 4
    } ]);
    assert.deepEqual(
      rows.map(row => {
        return row.number;
      }),
      [ 9, 6, 4 ]
    );
    assert.equal(
      eventConditions([ {
        group: '투지 차감',
        amount: 1,
        number: 4
      }, {
        group: '투지 차감',
        amount: 1,
        number: 1
      } ])[0].number,
      1
    );
  }
);

test(
  '스트레스 ±15 상한·0~100·검은 광기·전투 밖',
  () => {
    const up = stressChange(
      80,
      10,
      {
        up: 12,
        down: 14
      }
    );
    assert.equal(
      up.value,
      83
    );
    assert.deepEqual(
      up.tally,
      {
        up: 15,
        down: 14
      }
    );
    const down = stressChange(
      80,
      -10,
      up.tally
    );
    assert.equal(
      down.value,
      79
    );
    assert.equal(
      stressChange(
        80,
        25,
        {
          up: 15,
          down: 15
        },
        {
          combat: false
        }
      ).value,
      100
    );
    assert.equal(
      stressChange(
        2,
        -10
      ).value,
      0
    );
    assert.equal(
      stressChange(
        100,
        -50,
        undefined,
        {
          black: true
        }
      ).delta,
      0
    );
  }
);

test(
  '결단 구간 16/17과 상태의 고정 스트레스',
  () => {
    assert.equal(
      determination(16),
      '검은 광기'
    );
    assert.equal(
      determination(17),
      '백색 맹세'
    );
    assert.equal(
      PC_STRESS.white,
      50
    );
    assert.equal(
      PC_STRESS.black,
      100
    );
    assert.equal(
      PC_STRESS.releasedBlack,
      70
    );
  }
);

test(
  '정본 표의 모든 행·종류 열 보존',
  () => {
    assert.equal(
      GROUPS.flatMap(group => {
        return TABLES[group];
      }).length,
      48
    );
    for (const group of GROUPS) assert.deepEqual(
      TABLES[group].map(row => {
        return row.number;
      }),
      Array.from(
        {
          length: 12
        },
        (
          _,
          i
        ) => {
          return i + 1;
        }
      )
    );
    for (const key of [ '폭주', '붕괴', '백색 맹세', '검은 광기' ]) assert.equal(
      TABLES[key].length,
      12
    );
    for (const key of [ '폭주', '붕괴', '버팀', '무너짐' ]) {
      assert.equal(
        TABLES[key].length,
        [ '버팀', '무너짐' ].includes(key) ? 8 : 12
      );
      for (const row of TABLES[key]) assert.deepEqual(
        Object.keys(row.actions),
        [ '사람', '짐승', '이형' ]
      );
    }
    assert.equal(
      TABLES['백색 맹세'][0].name,
      '몬타누스의 암벽'
    );
    assert.equal(
      TABLES.붕괴[2].actions.사람,
      '—'
    );
  }
);
