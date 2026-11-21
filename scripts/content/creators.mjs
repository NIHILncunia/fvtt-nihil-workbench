import { MonsterRole } from './codes.mjs';
import {
  buildCreatureType,
  buildDamageTraits,
  buildConditionImmunities,
  buildHitPoints,
  buildAbilityScores,
  buildSkills,
  buildMovement,
  buildSenses,
  buildNpcResources,
  buildPrototypeToken,
  buildDescription,
  buildArmorClass,
} from './builders.mjs';
import { code, merge, MODULE_ID, object } from './internal.mjs';
import { createCompendiumDocument } from './persistence.mjs';

export async function createNpc(
  input,
  options = {},
) {
  const source = object(input);
  if (source.type != null && source.type !== 'npc')
    throw new Error('NPC 소스를 전달하십시오.');
  source.type = 'npc';
  const system = (source.system ??= {});
  if (system.abilities) system.abilities = buildAbilityScores(system.abilities);
  if (system.skills) system.skills = buildSkills(system.skills);
  if (system.details?.type)
    system.details.type = buildCreatureType(system.details.type);
  if (system.attributes?.hp)
    system.attributes.hp = buildHitPoints(system.attributes.hp);
  if (system.attributes?.ac)
    system.attributes.ac = buildArmorClass(system.attributes.ac);
  if (system.attributes?.movement)
    system.attributes.movement = buildMovement(system.attributes.movement);
  if (system.attributes?.senses)
    system.attributes.senses = buildSenses(system.attributes.senses);
  if (system.resources) system.resources = buildNpcResources(system.resources);
  if (system.traits) {
    const damage = Object.fromEntries(
      ['di', 'dr', 'dv']
        .filter((key) => system.traits[key])
        .map((key) => [key, system.traits[key]]),
    );
    Object.assign(
      system.traits,
      buildDamageTraits(damage),
    );
    if (system.traits.ci)
      system.traits.ci = buildConditionImmunities(system.traits.ci);
  }
  if (source.prototypeToken)
    source.prototypeToken = buildPrototypeToken(source.prototypeToken);
  return createCompendiumDocument(
    'Actor',
    source,
    options,
  );
}

let templates;
async function loadTemplates() {
  if (!templates)
    templates = (async () => {
      const response = await fetch(
        new URL(
          '../../data/common-monster-templates.json',
          import.meta.url,
        ),
      );
      if (!response.ok)
        throw new Error(
          `기존 몬스터 템플릿을 읽지 못했습니다: ${response.status}`,
        );
      const data = await response.json();
      if (!Array.isArray(data) || data.length !== 90)
        throw new Error('기존 몬스터 템플릿의 개수가 다릅니다.');
      const pairs = new Set();
      for (const entry of data) {
        const pair = `${entry.folder}:${entry.cr}`;
        if (
          !['일반', '엘리트', '보스'].includes(entry.folder) ||
          !Number.isInteger(entry.cr) ||
          entry.cr < 1 ||
          entry.cr > 30 ||
          !Number.isInteger(entry.hp) ||
          entry.hp <= 0 ||
          pairs.has(pair)
        )
          throw new Error('기존 몬스터 템플릿 데이터가 올바르지 않습니다.');
        pairs.add(pair);
      }
      return data;
    })();
  try {
    return await templates;
  } catch (error) {
    templates = undefined;
    throw error;
  }
}

async function monster(
  role,
  input,
  options,
) {
  code(
    role,
    MonsterRole,
  );
  const source = object(input);
  const cr = source.system?.details?.cr;
  const folder = { normal: '일반', elite: '엘리트', boss: '보스' }[role];
  const template = (await loadTemplates()).find(
    (entry) => entry.folder === folder && entry.cr === cr,
  );
  if (!template)
    throw new Error(
      '일반·엘리트·보스 프리셋의 CR은 1~30 정수입니다. 다른 CR은 createNpc를 사용하십시오.',
    );
  const previousRole = source.flags?.[MODULE_ID]?.monsterRole;
  if (previousRole && previousRole !== role)
    throw new Error('소스의 몬스터 등급이 다릅니다.');
  const prepared = merge(
    {
      name: template.name,
      system: {
        attributes: {
          hp: {
            value: template.hp,
            max: template.hp,
            formula: String(template.hp),
          },
        },
      },
      flags: { [MODULE_ID]: { monsterRole: role } },
    },
    source,
  );
  if (
    source.system?.attributes?.hp?.max != null &&
    source.system.attributes.hp.value == null
  ) {
    prepared.system.attributes.hp.value = source.system.attributes.hp.max;
  }
  return createNpc(
    prepared,
    options,
  );
}

export async function createNormalMonster(
  source,
  options = {},
) {
  return monster(
    'normal',
    source,
    options,
  );
}
export async function createEliteMonster(
  source,
  options = {},
) {
  return monster(
    'elite',
    source,
    options,
  );
}
export async function createBossMonster(
  source,
  options = {},
) {
  return monster(
    'boss',
    source,
    options,
  );
}

async function item(
  type,
  input,
  options,
) {
  const source = object(input);
  if (source.type != null && source.type !== type)
    throw new Error('헬퍼와 소스의 아이템 타입이 다릅니다.');
  source.type = type;
  if (source.system?.description)
    source.system.description = buildDescription(source.system.description);
  return createCompendiumDocument(
    'Item',
    source,
    options,
  );
}

export async function createWeapon(
  source,
  options = {},
) {
  return item(
    'weapon',
    source,
    options,
  );
}
export async function createEquipment(
  source,
  options = {},
) {
  return item(
    'equipment',
    source,
    options,
  );
}
export async function createConsumable(
  source,
  options = {},
) {
  return item(
    'consumable',
    source,
    options,
  );
}
export async function createTool(
  source,
  options = {},
) {
  return item(
    'tool',
    source,
    options,
  );
}
export async function createLoot(
  source,
  options = {},
) {
  return item(
    'loot',
    source,
    options,
  );
}
export async function createSpecies(
  source,
  options = {},
) {
  return item(
    'race',
    source,
    options,
  );
}
export async function createBackground(
  source,
  options = {},
) {
  return item(
    'background',
    source,
    options,
  );
}
export async function createClass(
  source,
  options = {},
) {
  return item(
    'class',
    source,
    options,
  );
}
export async function createSubclass(
  source,
  options = {},
) {
  return item(
    'subclass',
    source,
    options,
  );
}
export async function createSpell(
  source,
  options = {},
) {
  return item(
    'spell',
    source,
    options,
  );
}
export async function createFeat(
  source,
  options = {},
) {
  return item(
    'feat',
    source,
    options,
  );
}
export async function createContainer(
  source,
  options = {},
) {
  return item(
    'container',
    source,
    options,
  );
}
export async function createFacility(
  source,
  options = {},
) {
  return item(
    'facility',
    source,
    options,
  );
}
