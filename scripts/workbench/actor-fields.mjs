import { addTokenPerceptionSections, detectionModeDeletions, validateTokenDetectionModes } from './token-fields.mjs';
import { addActorPurposeSections } from './actor-purpose-fields.mjs';
import { validateHabitat } from './actor-list-fields.mjs';

const ABILITIES = {
  str: '근력',
  dex: '민첩',
  con: '건강',
  int: '지능',
  wis: '지혜',
  cha: '매력',
};
const PROFICIENCIES = { 0: '비숙련', 0.5: '절반 숙련', 1: '숙련', 2: '전문화' };

export function actorPathValue(
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

function label(value) {
  return globalThis.game?.i18n?.localize?.(value) ?? value;
}

function choices(config) {
  return Object.entries(config ?? {}).map(([value, entry]) => ({
    value,
    label: label(
      typeof entry === 'object' ? (entry.label ?? entry.name ?? value) : entry,
    ),
  }));
}

function plain(value) {
  if (value instanceof Set) return [...value];
  return value;
}

function signedModifier(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value}` : '—';
}

export function actorAbilityCards(
  actor,
  fields = [],
) {
  return Object.entries(ABILITIES).map(([key, title]) => {
    const ability = actor.system?.abilities?.[key] ?? {};
    return {
      key,
      title,
      score: fields.find(field => field.path === `system.abilities.${key}.value`),
      proficiency: fields.find(field => field.path === `system.abilities.${key}.proficient`),
      isProficient: Number(ability.proficient ?? 0) > 0,
      modifier: signedModifier(ability.mod + (ability.checkBonus ?? 0)),
      saveModifier: signedModifier(ability.save?.value),
    };
  });
}

export function previewActorAbilityCards(
  actor,
  controls = {},
) {
  return previewActorCombatCards(
    actor,
    controls,
  ).abilities;
}

export function actorSkillCards(
  actor,
  fields = [],
) {
  const config = globalThis.CONFIG?.DND5E ?? {};
  const skills = actor.system?.skills ?? actor.toObject?.().system?.skills ?? {};
  return Object.entries(skills).map(([key, skill]) => ({
    key,
    title: label(config.skills?.[key]?.label ?? key),
    ability: ABILITIES[skill.ability ?? config.skills?.[key]?.ability] ?? '—',
    proficiency: fields.find(field => field.path === `system.skills.${key}.value`),
    isProficient: Number(skill.value ?? 0) > 0,
    modifier: signedModifier(skill.total),
    passive: Number.isFinite(skill.passive) ? String(skill.passive) : '—',
  }));
}

export function previewActorCombatCards(
  actor,
  controls = {},
) {
  const values = Object.fromEntries(
    Object.entries(controls)
      .filter(([name]) => /^field:system\.(abilities|skills)\./.test(name))
      .map(([name, value]) => [name.slice(6), value]),
  );
  const update = buildActorFieldUpdate(
    actor,
    values,
  );
  let preview = actor;
  if (Object.keys(update).length) {
    preview = actor.clone(
      update,
      { keepId: true, save: false },
    );
    preview.prepareData?.();
  }
  return {
    abilities: actorAbilityCards(preview),
    skills: actorSkillCards(preview),
  };
}

export function actorFieldSections(actor) {
  const source = actor.toObject();
  const config = globalThis.CONFIG?.DND5E ?? {};
  const sections = [];
  const covered = new Set();
  const section = (
    tab,
    title,
  ) => {
    const result = { tab, title, fields: [] };
    sections.push(result);
    return result;
  };
  const add = (
    group,
    path,
    title,
    kind = 'text',
    options = {},
  ) => {
    const raw = plain(actorPathValue(
      source,
      path,
    ));
    covered.add(path);
    const value =
      kind === 'json'
        ? JSON.stringify(
          raw ?? options.initial ?? [],
          null,
          2,
        )
        : (raw ?? options.initial ?? '');
    const optionsList = choices(options.choices);
    const selectedValues = kind === 'favorites' ? (raw ?? []).map(entry => entry.id) : raw ?? [];
    if (kind === 'set' || kind === 'favorites') {
      for (const entry of selectedValues) {
        if (!optionsList.some((option) => option.value === entry))
          optionsList.push({ value: entry, label: entry });
      }
    }
    if (
      kind !== 'set' && kind !== 'favorites' &&
      optionsList.length &&
      !optionsList.some((entry) => String(entry.value) === String(value))
    ) {
      optionsList.unshift({ value, label: value || '기본값' });
    }
    group.fields.push({
      path,
      name: `field:${path}`,
      label: title,
      kind,
      value,
      isBoolean: kind === 'boolean',
      isJson: kind === 'json',
      isMultiline: kind === 'multiline',
      isSet: kind === 'set' || kind === 'favorites',
      isNumber: kind === 'number',
      isColor: kind === 'color',
      pickerValue: /^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#ffffff',
      isSelect: kind !== 'set' && kind !== 'favorites' && optionsList.length > 0,
      ...options,
      options: optionsList.map((entry) => ({
        ...entry,
        selected:
          kind === 'set' || kind === 'favorites'
            ? selectedValues.includes(entry.value)
            : String(entry.value) === String(value),
      })),
    });
  };

  const combat = section(
    'combat',
    '방어·이니셔티브',
  );
  // dnd5e 6.x: ac.calc·ac.formula는 저장되지 않는다. 계산 방식은 목록(calcs), 사용자 공식은 공식 목록(formulas)이다.
  add(
    combat,
    'system.attributes.ac.calcs',
    'AC 계산 방식(여러 개 선택 시 가장 높은 값)',
    'set',
    {
      choices: config.armorClasses,
    },
  );
  add(
    combat,
    'system.attributes.ac.formulas',
    '사용자 AC 공식 목록(JSON, 예: [{"formula":"12 + @abilities.dex.mod","label":"비늘"}])',
    'json',
  );
  add(
    combat,
    'system.attributes.ac.override',
    'AC 고정값(입력하면 계산을 무시)',
    'number',
    {
      min: 0,
      integer: true,
      nullable: true,
    },
  );
  add(
    combat,
    'system.attributes.init.bonus',
    '이니셔티브 보너스 공식',
  );
  add(
    combat,
    'system.attributes.exhaustion',
    '탈진',
    'number',
    {
      min: 0,
      integer: true,
    },
  );
  const abilities = section(
    'combat',
    '능력치·내성',
  );
  for (const [key, title] of Object.entries(ABILITIES)) {
    add(
      abilities,
      `system.abilities.${key}.value`,
      title,
      'number',
      {
        min: 0,
        integer: true,
      },
    );
    add(
      abilities,
      `system.abilities.${key}.proficient`,
      `${title} 내성 숙련`,
      'number',
      {
        choices: { 0: '비숙련', 1: '숙련' },
      },
    );
    add(
      abilities,
      `system.abilities.${key}.bonuses.save`,
      `${title} 내성 보너스`,
    );
    add(
      abilities,
      `system.abilities.${key}.bonuses.check`,
      `${title} 판정 보너스`,
    );
  }
  abilities.isAbilities = true;
  abilities.cards = actorAbilityCards(
    actor,
    abilities.fields,
  );
  abilities.bonusFields = abilities.fields.filter(field => field.path.includes('.bonuses.'));
  const skills = section(
    'combat',
    '기술',
  );
  for (const [key, entry] of Object.entries(source.system?.skills ?? {})) {
    const title = label(config.skills?.[key]?.label ?? key);
    add(
      skills,
      `system.skills.${key}.value`,
      `${title} 숙련`,
      'number',
      {
        choices: PROFICIENCIES,
      },
    );
    covered.add(`system.skills.${key}.ability`);
    add(
      skills,
      `system.skills.${key}.bonuses.check`,
      `${title} 판정 보너스`,
    );
    add(
      skills,
      `system.skills.${key}.bonuses.passive`,
      `${title} 수동 판정 보너스`,
    );
  }
  skills.isSkills = true;
  skills.cards = actorSkillCards(
    actor,
    skills.fields,
  );
  skills.bonusFields = skills.fields.filter(field => field.path.includes('.bonuses.'));
  const movement = section(
    'combat',
    '이동·감각',
  );
  for (const [key, title] of Object.entries({
    walk: '보행',
    burrow: '굴파기',
    climb: '등반',
    fly: '비행',
    swim: '수영',
  })) {
    add(
      movement,
      `system.attributes.movement.${key}`,
      `${title} 속도·공식`,
    );
  }
  add(
    movement,
    'system.attributes.movement.units',
    '이동 단위',
    'text',
    {
      choices: { ft: '피트', m: '미터' },
    },
  );
  add(
    movement,
    'system.attributes.movement.hover',
    '공중 정지',
    'boolean',
  );
  add(
    movement,
    'system.attributes.movement.special',
    '특수 이동',
  );
  // dnd5e 5.3+: 감각 거리는 senses.ranges.<감각>에 있다.
  const senseTitles = {
    darkvision: '암시야',
    blindsight: '맹시야',
    tremorsense: '진동감지',
    truesight: '진실의 시야',
  };
  for (const key of Object.keys(config.senses ?? {})) {
    if (!Object.hasOwn(senseTitles, key)) {
      const entry = config.senses[key];
      senseTitles[key] = label(typeof entry === 'object' ? (entry.label ?? key) : entry);
    }
  }
  for (const [key, title] of Object.entries(senseTitles)) {
    add(
      movement,
      `system.attributes.senses.ranges.${key}`,
      title,
      'number',
      {
        min: 0,
        integer: true,
        nullable: true,
      },
    );
  }
  add(
    movement,
    'system.attributes.senses.units',
    '감각 단위',
    'text',
    {
      choices: { ft: '피트', m: '미터' },
    },
  );
  add(
    movement,
    'system.attributes.senses.special',
    '특수 감각',
  );

  const traits = section(
    'traits',
    '피해·상태·언어',
  );
  for (const [key, title] of Object.entries({
    di: '피해 면역',
    dr: '피해 저항',
    dv: '피해 취약',
    ci: '상태 면역',
    languages: '언어',
  })) {
    // Sets are edited as checked values; custom entries remain independently editable.
    const traitConfig =
      key === 'ci'
        ? config.conditionTypes
        : key === 'languages'
          ? config.languages
          : config.damageTypes;
    const flatten = (entries) =>
      Object.fromEntries(
        Object.entries(entries ?? {}).flatMap(([id, entry]) =>
          entry?.children
            ? Object.entries(flatten(entry.children))
            : [
                [
                  id,
                  typeof entry === 'object'
                    ? (entry.label ?? entry.name ?? id)
                    : entry,
                ],
              ],
        ),
      );
    add(
      traits,
      `system.traits.${key}.value`,
      title,
      'set',
      {
        choices: flatten(traitConfig),
      },
    );
    add(
      traits,
      `system.traits.${key}.custom`,
      `${title} 사용자 설명`,
    );
    if (['di', 'dr', 'dv'].includes(key)) {
      add(
        traits,
        `system.traits.${key}.bypasses`,
        `${title} 우회 조건`,
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
  }
  const spells = section(
    'spells',
    '시전·주문 슬롯',
  );
  add(
    spells,
    'system.attributes.spellcasting',
    '시전 능력치',
    'text',
    {
      choices: { '': '없음', ...ABILITIES },
    },
  );
  add(
    spells,
    'system.bonuses.spell.dc',
    '주문 내성 DC 보너스 공식',
  );
  add(
    spells,
    'system.bonuses.msak.attack',
    '근접 주문 공격 보너스',
  );
  add(
    spells,
    'system.bonuses.rsak.attack',
    '원거리 주문 공격 보너스',
  );
  for (const key of Object.keys(source.system?.spells ?? {})) {
    const title =
      key === 'pact' ? '계약 슬롯' : `${key.replace(
        'spell',
        '',
      )}레벨 슬롯`;
    add(
      spells,
      `system.spells.${key}.value`,
      `${title} 남은 수`,
      'number',
      {
        min: 0,
        integer: true,
      },
    );
    add(
      spells,
      `system.spells.${key}.override`,
      `${title} 최대 수 재정의`,
      'number',
      {
        min: 0,
        integer: true,
        nullable: true,
      },
    );
  }
  if (actor.type === 'character') {
    const resources = section(
      'growth',
      '사용자 자원',
    );
    for (const [key, title] of Object.entries({ primary: '자원 1', secondary: '자원 2', tertiary: '자원 3' })) {
      add(
        resources,
        `system.resources.${key}.label`,
        `${title} 이름`,
      );
      for (const field of ['value', 'max'])
        add(
          resources,
          `system.resources.${key}.${field}`,
          `${title} ${field === 'value' ? '현재' : '최대'}`,
          'number',
          { min: 0, integer: true },
        );
      for (const field of ['sr', 'lr'])
        add(
          resources,
          `system.resources.${key}.${field}`,
          `${title} ${field === 'sr' ? '짧은' : '긴'} 휴식 회복`,
          'boolean',
        );
    }
  }
  const token = section(
    'token',
    '배치할 토큰 기본값',
  );
  add(
    token,
    'prototypeToken.name',
    '토큰 이름',
  );
  for (const [key, title] of Object.entries({
    width: '너비 (칸)',
    height: '높이 (칸)',
  })) {
    add(
      token,
      `prototypeToken.${key}`,
      title,
      'number',
      { min: 0.1 },
    );
  }
  add(
    token,
    'prototypeToken.disposition',
    '소속',
    'number',
    {
      choices: { '-2': '비밀', '-1': '적대', 0: '중립', 1: '우호' },
    },
  );
  add(
    token,
    'prototypeToken.actorLink',
    '액터 데이터 연결',
    'boolean',
  );
  add(
    token,
    'prototypeToken.displayName',
    '이름 표시',
    'number',
    {
      choices: {
        0: '숨김',
        10: '제어 시',
        20: '소유자 가리키기',
        30: '누구나 가리키기',
        40: '소유자 항상',
        50: '항상',
      },
    },
  );
  add(
    token,
    'prototypeToken.displayBars',
    '자원 막대 표시',
    'number',
    {
      choices: {
        0: '숨김',
        10: '제어 시',
        20: '소유자 가리키기',
        30: '누구나 가리키기',
        40: '소유자 항상',
        50: '항상',
      },
    },
  );
  add(
    token,
    'prototypeToken.bar1.attribute',
    '막대 1 속성',
  );
  add(
    token,
    'prototypeToken.bar2.attribute',
    '막대 2 속성',
  );
  add(
    token,
    'prototypeToken.sight.enabled',
    '토큰 시야',
    'boolean',
  );
  add(
    token,
    'prototypeToken.sight.range',
    '시야 거리',
    'number',
    { min: 0, nullable: true },
  );
  add(
    token,
    'prototypeToken.texture.scaleX',
    '이미지 가로 배율',
    'number',
    {
      min: 0.01,
    },
  );
  add(
    token,
    'prototypeToken.texture.scaleY',
    '이미지 세로 배율',
    'number',
    {
      min: 0.01,
    },
  );
  add(
    token,
    'prototypeToken.texture.tint',
    '이미지 색조',
  );
  addTokenPerceptionSections({ section, add });
  addActorPurposeSections({ actor, source, config, section, add });
  const legacyPaths = [
    'name',
    'img',
    'prototypeToken.texture.src',
    'system.attributes.hp.value',
    'system.attributes.hp.max',
    'system.attributes.hp.temp',
    'system.attributes.ac.flat',
    'system.details.biography.value',
    'system.source.book',
    'system.source.page',
    'system.source.custom',
    'system.details.xp.value',
    'system.attributes.inspiration',
    'system.attributes.death.success',
    'system.attributes.death.failure',
    'system.details.cr',
    'system.traits.size',
    'system.details.type.value',
    'system.details.type.subtype',
    'system.details.type.custom',
    'system.attributes.spell.level',
    'system.attributes.hp.formula',
    'system.resources.legact.spent',
    'system.resources.legact.max',
    'system.resources.legres.spent',
    'system.resources.legres.max',
    'system.resources.lair.value',
    'system.resources.lair.initiative',
  ];
  legacyPaths.forEach((path) => covered.add(path));
  const advanced = section(
    'advanced',
    '추가 시스템 필드',
  );
  const walk = (
    data,
    prefix,
    schema,
  ) => {
    for (const [key, raw] of Object.entries(data ?? {})) {
      const path = `${prefix}.${key}`;
      if (covered.has(path) || key.startsWith('_')) continue;
      const field = schema?.fields?.[key] ?? schema?.[key];
      const name = field?.label ? label(field.label) : path;
      const value = plain(raw);
      if (Array.isArray(value)) add(
        advanced,
        path,
        name,
        'json',
      );
      else if (value && typeof value === 'object') walk(
        value,
        path,
        field,
      );
      else
        add(
          advanced,
          path,
          name,
          typeof value === 'boolean'
            ? 'boolean'
            : typeof value === 'number' ||
                field?.constructor?.name === 'NumberField'
              ? 'number'
              : 'text',
          {
            nullable: Boolean(field?.nullable ?? field?.options?.nullable),
            integer: Boolean(field?.integer ?? field?.options?.integer),
            min: field?.min ?? field?.options?.min,
            max: field?.max ?? field?.options?.max,
          },
        );
    }
  };
  walk(
    source.system,
    'system',
    actor.system?.schema,
  );
  return sections;
}

export function buildActorFieldUpdate(
  actor,
  values = {},
) {
  const descriptors = new Map(
    actorFieldSections(actor)
      .flatMap((section) => section.fields)
      .map((field) => [field.path, field]),
  );
  const source = actor.toObject();
  const update = {};
  for (const [path, raw] of Object.entries(values)) {
    const field = descriptors.get(path);
    if (!field) throw new Error(`편집할 수 없는 액터 필드입니다: ${path}`);
    let value = raw;
    if (field.kind === 'boolean') value = Boolean(raw);
    else if (field.kind === 'number') {
      value = raw === '' && field.nullable ? null : Number(raw);
      if (
        (raw === '' && !field.nullable) ||
        (value !== null &&
          (!Number.isFinite(value) ||
            (field.integer && !Number.isInteger(value)) ||
            (field.min != null && value < field.min) ||
            (field.max != null && value > field.max)))
      )
        throw new Error(`${field.label}: 올바른 범위의 숫자를 입력하십시오.`);
    } else if (field.kind === 'favorites') {
      const ids = [...new Set(Array.isArray(raw) ? raw : [])];
      if (ids.some(id => !field.options.some(option => option.value === id))) throw new Error('즐겨찾기는 소유 아이템이나 액티비티를 선택하십시오.');
      const original = source.system?.favorites ?? [];
      value = original.filter(entry => ids.includes(entry.id));
      let sort = Math.max(
        0,
        ...original.map(entry => entry.sort ?? 0),
      );
      for (const id of ids.filter(id => !original.some(entry => entry.id === id))) {
        sort += globalThis.CONST?.SORT_INTEGER_DENSITY ?? 100000;
        value.push({ id, type: field.choices[id].favoriteType, sort });
      }
    } else if (field.kind === 'set')
      value = [...new Set(Array.isArray(raw) ? raw : [])];
    else if (field.kind === 'json') {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`${field.label}: JSON 형식을 확인하십시오.`);
      }
      if (path === 'prototypeToken.detectionModes')
        value = validateTokenDetectionModes(value);
      if (path === 'system.details.habitat.value') value = validateHabitat(
        value,
        source.system?.details?.habitat?.value,
      );
      if (path === 'prototypeToken.detectionModes') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error(`${field.label}: 감지 모드 객체를 입력하십시오.`);
      } else if (!Array.isArray(value))
        throw new Error(`${field.label}: 배열을 입력하십시오.`);
    } else if (field.kind === 'color') {
      value = String(raw ?? '').trim();
      if (value && !/^#[0-9a-f]{6}$/i.test(value))
        throw new Error(`${field.label}: #RRGGBB 색상을 입력하거나 비우십시오.`);
      value = value || null;
    } else value = raw === '' && field.nullable ? null : field.kind === 'multiline' ? String(raw ?? '') : String(raw ?? '').trim();
    if (
      field.options.length &&
      field.kind !== 'set' && field.kind !== 'favorites' &&
      !field.options.some(
        (option) => String(option.value) === String(value ?? ''),
      )
    ) {
      throw new Error(`${field.label}: 목록의 값을 선택하십시오.`);
    }
    if (
      JSON.stringify(plain(actorPathValue(
        source,
        path,
      ))) !==
      JSON.stringify(value)
    )
      update[path] = value;
    const tool = /^system\.tools\.([^.]+)\.value$/.exec(path)?.[1];
    if (tool && value > 0 && !source.system?.tools?.[tool]) {
      update[`system.tools.${tool}.ability`] = globalThis.CONFIG?.DND5E?.tools?.[tool]?.ability ?? 'int';
    }
  }
  if (Object.hasOwn(update, 'prototypeToken.detectionModes'))
    Object.assign(update, detectionModeDeletions(
      source.prototypeToken?.detectionModes,
      update['prototypeToken.detectionModes'],
    ));
  const minimum = update['prototypeToken.light.darkness.min'] ?? source.prototypeToken?.light?.darkness?.min;
  const maximum = update['prototypeToken.light.darkness.max'] ?? source.prototypeToken?.light?.darkness?.max;
  if (minimum > maximum) throw new Error('활성 최소 어둠 수준은 최대 수준보다 클 수 없습니다.');
  for (const path of Object.keys(update).filter(path => /\.roll\.(min|max)$/.test(path))) {
    const prefix = path.replace(
      /\.(min|max)$/,
      '',
    );
    const low = Object.hasOwn(
      update,
      `${prefix}.min`,
    ) ? update[`${prefix}.min`] : actorPathValue(
      source,
      `${prefix}.min`,
    );
    const high = Object.hasOwn(
      update,
      `${prefix}.max`,
    ) ? update[`${prefix}.max`] : actorPathValue(
      source,
      `${prefix}.max`,
    );
    if (low != null && high != null && low > high) throw new Error('최소 주사위 값은 최대 주사위 값보다 클 수 없습니다.');
  }
  return update;
}
