import { favoriteChoices } from './actor-list-fields.mjs';

const ABILITIES = {
  str: '근력',
  dex: '민첩',
  con: '건강',
  int: '지능',
  wis: '지혜',
  cha: '매력',
};
const PROFICIENCIES = { 0: '비숙련', 0.5: '절반 숙련', 1: '숙련', 2: '전문화' };
const WEAPON_NAMES = {
  club: '곤봉',
  dagger: '단검',
  greatclub: '대형 곤봉',
  handaxe: '손도끼',
  javelin: '투창',
  lighthammer: '가벼운 망치',
  mace: '철퇴',
  quarterstaff: '육척봉',
  sickle: '낫',
  spear: '창',
  lightcrossbow: '경쇠뇌',
  dart: '다트',
  shortbow: '단궁',
  sling: '슬링',
  battleaxe: '전투도끼',
  flail: '도리깨',
  glaive: '글레이브',
  greataxe: '대형 도끼',
  greatsword: '대검',
  halberd: '할버드',
  lance: '랜스',
  longsword: '장검',
  maul: '대형 망치',
  morningstar: '모닝스타',
  pike: '파이크',
  rapier: '레이피어',
  scimitar: '시미터',
  shortsword: '소검',
  trident: '삼지창',
  warpick: '전투 곡괭이',
  warhammer: '전투 망치',
  whip: '채찍',
  blowgun: '바람총',
  handcrossbow: '손쇠뇌',
  heavycrossbow: '중쇠뇌',
  longbow: '장궁',
  net: '그물',
  musket: '머스킷',
  pistol: '권총',
};
const TOOL_NAMES = {
  alchemist: '연금술사 도구',
  bagpipes: '백파이프',
  brewer: '양조 도구',
  calligrapher: '서예 도구',
  card: '카드',
  carpenter: '목공 도구',
  cartographer: '지도 제작 도구',
  chess: '드래곤 체스',
  cobbler: '구두 수선 도구',
  cook: '요리 도구',
  dice: '주사위',
  disg: '변장 도구',
  drum: '북',
  dulcimer: '덜시머',
  flute: '플루트',
  forg: '위조 도구',
  glassblower: '유리공 도구',
  herb: '약초학 도구',
  horn: '호른',
  jeweler: '보석 세공 도구',
  leatherworker: '가죽 세공 도구',
  lute: '류트',
  lyre: '리라',
  mason: '석공 도구',
  navg: '항해 도구',
  painter: '화가 도구',
  panflute: '팬플루트',
  pois: '독 제조 도구',
  potter: '도공 도구',
  shawm: '숌',
  smith: '대장장이 도구',
  thief: '도둑 도구',
  tinker: '땜장이 도구',
  viol: '비올',
  weaver: '직조 도구',
  woodcarver: '목각 도구',
};

function valueAt(
  source,
  path,
) {
  return path.split('.').reduce(
    (
      value,
      key,
    ) => value?.[key],
    source,
  );
}

function configLabel(
  config,
  key,
) {
  const entry = config?.[key];
  const title = typeof entry === 'object' ? entry?.label : entry;
  return globalThis.game?.i18n?.localize?.(title ?? key) ?? title ?? key;
}

// Stored fields only: derived level, proficiency, AC and HP remain system calculations.
export function addActorPurposeSections({
  actor,
  source,
  config,
  section,
  add,
}) {
  const existing = (
    group,
    path,
    title,
    kind = 'text',
    options = {},
  ) => {
    const keys = path.split('.');
    const parent = valueAt(
      source,
      keys.slice(
        0,
        -1,
      ).join('.'),
    );
    if (
      parent && Object.hasOwn(
        parent,
        keys.at(-1),
      )
    )
      add(
        group,
        path,
        title,
        kind,
        options,
      );
  };
  const background = section(
    'background',
    '성격·공개 소개',
  );
  for (const [key, title] of Object.entries({
    alignment: '성향',
    ideal: '이상',
    bond: '유대',
    flaw: '결점',
    appearance: '외형',
    trait: '성격',
    gender: '성별',
    eyes: '눈',
    height: '키',
    faith: '신앙',
    hair: '머리카락',
    skin: '피부',
    age: '나이',
    weight: '체중',
  }))
    existing(
      background,
      `system.details.${key}`,
      title,
      ['ideal', 'bond', 'flaw', 'appearance', 'trait'].includes(key)
        ? 'multiline'
        : 'text',
    );
  existing(
    background,
    'system.details.biography.public',
    '공개 소개 (HTML 사용 가능)',
    'multiline',
  );
  existing(
    background,
    'system.source.revision',
    '출처 리비전',
    'number',
    {
      min: 1,
      integer: true,
    },
  );
  existing(
    background,
    'system.source.rules',
    '규칙 연도',
    'text',
    {
      choices: { '': '규칙 미지정', 2024: '2024 규칙', 2014: '2014 레거시' },
    },
  );
  existing(
    background,
    'system.source.license',
    '출처 라이선스',
  );
  const origin = section(
    actor.type === 'character' ? 'growth' : 'background',
    '소유 항목 연결',
  );
  origin.hint =
    '레벨은 클래스 아이템에서 계산됩니다. 항목 편집과 추가는 아래 목록을 사용하십시오.';
  for (const [key, type, title] of [
    ['race', 'race', '종족'],
    ['background', 'background', '배경'],
    ['originalClass', 'class', '시작 클래스'],
  ]) {
    const items = (source.items ?? []).filter((item) => item.type === type);
    existing(
      origin,
      `system.details.${key}`,
      title,
      'text',
      {
        choices: {
          '': '지정하지 않음',
          ...Object.fromEntries(
            items.map((item) => [item._id ?? item.id, item.name]),
          ),
        },
      },
    );
  }
  const survival = section(
    'combat',
    '생명력·집중·죽음 내성',
  );
  existing(
    survival,
    'system.attributes.movement.bonus',
    '공통 이동 보너스 공식',
  );
  existing(
    survival,
    'system.attributes.movement.ignoredDifficultTerrain',
    '무시하는 험지',
    'set',
    { choices: { all: '모든 험지', ...config.difficultTerrainTypes } },
  );
  for (const [path, title, options] of [
    ['hp.dt', '피해 역치', { min: 0, nullable: true }],
    ['hp.tempmax', '최대 HP 임시 보정', {}],
    ['concentration.limit', '동시 집중 최대 수', { min: 0 }],
    ['attunement.max', '조율 최대 수', { min: 0 }],
    ['loyalty.value', '충성도', { min: 0, max: 20, nullable: true }],
    ['hd.spent', '소모한 히트 다이스', { min: 0, nullable: true }],
  ])
    existing(
      survival,
      `system.attributes.${path}`,
      title,
      'number',
      {
        integer: true,
        ...options,
      },
    );
  for (const [path, title] of [
    ['hp.bonuses.level', '레벨당 HP 보너스 공식'],
    ['hp.bonuses.overall', '전체 HP 보너스 공식'],
    ['concentration.bonuses.save', '집중 내성 보너스 공식'],
    ['death.bonuses.save', '죽음 내성 보너스 공식'],
  ])
    existing(
      survival,
      `system.attributes.${path}`,
      title,
    );
  if (actor.type === 'npc') {
    for (const [key, title] of Object.entries({
      success: '죽음 내성 성공',
      failure: '죽음 내성 실패',
    }))
      existing(
        survival,
        `system.attributes.death.${key}`,
        title,
        'number',
        {
          min: 0,
          integer: true,
        },
      );
    const npc = section(
      'npc',
      '추가 몬스터 정보',
    );
    existing(
      npc,
      'system.traits.size',
      '크기',
      'text',
      { choices: config.actorSizes },
    );
    existing(
      npc,
      'system.details.type.value',
      '생물 유형',
      'text',
      { choices: config.creatureTypes },
    );
    existing(
      npc,
      'system.details.type.subtype',
      '하위 유형',
    );
    existing(
      npc,
      'system.details.type.custom',
      '사용자 유형',
    );
    existing(
      npc,
      'system.details.type.swarm',
      '떼를 이루는 개체 크기',
      'text',
      { nullable: true, choices: { '': '떼가 아님', ...config.actorSizes } },
    );
    existing(
      npc,
      'system.traits.important',
      '중요 NPC',
      'boolean',
    );
    existing(
      npc,
      'system.details.habitat.custom',
      '서식지 설명',
    );
    const habitats = section(
      'npc',
      '서식지',
    );
    existing(
      habitats,
      'system.details.habitat.value',
      '서식지',
      'json',
    );
    habitats.isHabitats = true;
    existing(
      npc,
      'system.details.treasure.value',
      '보물 유형',
      'set',
      {
        choices: Object.fromEntries(
          Object.entries(config.treasure ?? config.treasureTypes ?? {}).map(
            ([key, entry]) => [
              key,
              {
                any: '모든 유형',
                arcana: '마법 물품',
                armaments: '무장',
                implements: '도구',
                individual: '개인 보물',
                relics: '유물',
              }[key] ?? entry,
            ],
          ),
        ),
      },
    );
    existing(
      npc,
      'system.attributes.price.value',
      '가격',
      'number',
      {
        min: 0,
        nullable: true,
      },
    );
    existing(
      npc,
      'system.attributes.price.denomination',
      '가격 화폐',
      'text',
      {
        choices: config.currencies,
      },
    );
    const lair = section(
      'legendary',
      '소굴 위치',
    );
    existing(
      lair,
      'system.resources.lair.inside',
      '현재 소굴 안에 있음',
      'boolean',
    );
  } else {
    const prof = section(
      'traits',
      '무기·방어구 숙련',
    );
    existing(
      prof,
      'system.traits.size',
      '크기',
      'text',
      {
        choices: config.actorSizes,
      },
    );
    for (const [key, title, values] of [
      ['weaponProf', '무기', config.weaponProficiencies],
      ['armorProf', '방어구', config.armorProficiencies],
    ]) {
      existing(
        prof,
        `system.traits.${key}.value`,
        `${title} 숙련`,
        'set',
        {
          choices: values,
        },
      );
      existing(
        prof,
        `system.traits.${key}.custom`,
        `${title} 숙련 사용자 설명`,
      );
    }
    const weapons = Object.fromEntries(
      Object.keys(config.weaponIds ?? {}).map((key) => [
        key,
        WEAPON_NAMES[key] ??
          configLabel(
            config.weapons,
            key,
          ),
      ]),
    );
    for (const [key, title] of Object.entries({
      value: '선택한 무기 숙련술',
      bonus: '추가 무기 숙련술',
    }))
      existing(
        prof,
        `system.traits.weaponProf.mastery.${key}`,
        title,
        'set',
        {
          choices: key === 'value' ? weapons : config.weaponMasteries,
        },
      );
    const bastion = section(
      'background',
      '보루',
    );
    existing(
      bastion,
      'system.bastion.name',
      '보루 이름',
    );
    existing(
      bastion,
      'system.bastion.description',
      '보루 설명 (HTML 사용 가능)',
      'multiline',
    );
    const favorites = section(
      'items',
      '즐겨찾기',
    );
    favorites.hint =
      '소유 아이템과 액티비티를 선택합니다. 기존 즐겨찾기의 순서와 추가 데이터는 보존합니다.';
    existing(
      favorites,
      'system.favorites',
      '즐겨찾기에 표시할 항목',
      'favorites',
      {
        choices: favoriteChoices(
          actor,
          source,
        ),
      },
    );
  }
  const currency = section(
    'items',
    '화폐',
  );
  for (const key of Object.keys(source.system?.currency ?? {}))
    existing(
      currency,
      `system.currency.${key}`,
      configLabel(
        config.currencies,
        key,
      ),
      'number',
      { min: 0, integer: true },
    );
  const bonuses = section(
    'combat',
    '전역 판정·공격 보너스',
  );
  for (const [key, title] of Object.entries({
    check: '능력 판정',
    save: '내성',
    skill: '기술 판정',
  }))
    existing(
      bonuses,
      `system.bonuses.abilities.${key}`,
      `${title} 보너스 공식`,
    );
  for (const [key, title] of Object.entries({
    mwak: '근접 무기',
    rwak: '원거리 무기',
    msak: '근접 주문',
    rsak: '원거리 주문',
  })) {
    if (['mwak', 'rwak'].includes(key))
      existing(
        bonuses,
        `system.bonuses.${key}.attack`,
        `${title} 명중 보너스 공식`,
      );
    existing(
      bonuses,
      `system.bonuses.${key}.damage`,
      `${title} 피해 보너스 공식`,
    );
  }
  const roll = section(
    'combat',
    '판정 규칙·능력치 상한',
  );
  roll.collapsed = true;
  const rollFields = (
    prefix,
    title,
  ) => {
    for (const [key, text] of Object.entries({
      min: '최소 주사위 값',
      max: '최대 주사위 값',
    }))
      existing(
        roll,
        `${prefix}.roll.${key}`,
        `${title} ${text}`,
        'number',
        {
          nullable: true,
          integer: true,
          min: 1,
          max: 20,
        },
      );
    existing(
      roll,
      `${prefix}.roll.mode`,
      `${title} 굴림 방식`,
      'number',
      {
        choices: { '-1': '불리점', 0: '보통', 1: '이점' },
      },
    );
  };
  for (const [key, title] of Object.entries(ABILITIES)) {
    existing(
      roll,
      `system.abilities.${key}.max`,
      `${title} 상한`,
      'number',
      {
        nullable: true,
        min: 0,
        integer: true,
      },
    );
    rollFields(
      `system.abilities.${key}.check`,
      `${title} 판정`,
    );
    rollFields(
      `system.abilities.${key}.save`,
      `${title} 내성`,
    );
  }
  for (const [key, title] of Object.entries({
    init: '이니셔티브',
    concentration: '집중',
    death: '죽음 내성',
  })) {
    const prefix = `system.attributes.${key}`;
    if (key !== 'death')
      existing(
        roll,
        `${prefix}.ability`,
        `${title} 기반 능력`,
        'text',
        {
          choices: { '': '시스템 기본값', ...ABILITIES },
        },
      );
    rollFields(
      prefix,
      title,
    );
  }
  for (const key of Object.keys(source.system?.skills ?? {}))
    rollFields(
      `system.skills.${key}`,
      configLabel(
        config.skills,
        key,
      ),
    );
  const tools = section(
    'traits',
    '도구 숙련',
  );
  tools.hint =
    '숙련을 선택하면 해당 도구 판정을 등록합니다. 비숙련은 숙련 보정을 적용하지 않습니다.';
  for (const key of new Set([
    ...Object.keys(config.tools ?? {}),
    ...Object.keys(source.system?.tools ?? {}),
  ])) {
    const title = TOOL_NAMES[key] ?? configLabel(
      config.tools,
      key,
    );
    add(
      tools,
      `system.tools.${key}.value`,
      `${title} 숙련`,
      'number',
      {
        initial: 0,
        choices: PROFICIENCIES,
      },
    );
    if (!source.system?.tools?.[key]) continue;
    existing(
      tools,
      `system.tools.${key}.ability`,
      `${title} 기반 능력`,
      'text',
      { choices: ABILITIES },
    );
    existing(
      tools,
      `system.tools.${key}.bonuses.check`,
      `${title} 보너스 공식`,
    );
    rollFields(
      `system.tools.${key}`,
      title,
    );
  }
  const communication = section(
    'traits',
    '특수 의사소통·피해 조정',
  );
  for (const key of new Set([
    ...Object.keys(config.communicationTypes ?? {}),
    ...Object.keys(source.system?.traits?.languages?.communication ?? {}),
  ])) {
    const title = configLabel(
      config.communicationTypes,
      key,
    );
    const prefix = `system.traits.languages.communication.${key}`;
    add(
      communication,
      `${prefix}.value`,
      `${title} 거리`,
      'number',
      {
        min: 0,
        initial: 0,
      },
    );
    add(
      communication,
      `${prefix}.units`,
      `${title} 단위`,
      'text',
      {
        choices: { ft: '피트', m: '미터' },
        initial: source.system?.attributes?.movement?.units ?? 'ft',
      },
    );
  }
  for (const key of new Set([
    ...Object.keys(config.damageTypes ?? {}),
    ...Object.keys(source.system?.traits?.dm?.amount ?? {}),
  ]))
    add(
      communication,
      `system.traits.dm.amount.${key}`,
      `${configLabel(
        config.damageTypes,
        key,
      )} 피해 조정 공식`,
    );
  existing(
    communication,
    'system.traits.dm.bypasses',
    '피해 조정 우회 조건',
    'set',
    {
      choices: Object.fromEntries(
        Object.entries(config.itemProperties ?? {}).filter(
          ([, value]) => value.isPhysical,
        ),
      ),
    },
  );
}
