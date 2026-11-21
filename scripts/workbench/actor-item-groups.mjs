import { itemTypeChoices } from './item-library.mjs';

const TYPES = {
  class: '클래스',
  subclass: '서브클래스',
  race: '종족',
  background: '배경',
  feat: '특성·특기',
  weapon: '공격·무기',
  equipment: '장비',
  consumable: '소모품',
  tool: '도구',
  loot: '전리품',
  container: '보관용품',
  backpack: '배낭',
  spell: '주문',
  facility: '시설',
};
const TABS = {
  growth: ['class', 'subclass', 'race', 'background'],
  background: ['race', 'background', 'facility'],
  traits: ['feat', 'weapon'],
  spells: ['spell'],
};

export function actorItemGroups(
  actor,
  tab,
) {
  const items = Array.from(
    actor.items?.contents ?? actor.items?.values?.() ?? actor.items ?? [],
  );
  const registered = itemTypeChoices();
  const types =
    tab === 'items'
      ? [
          ...new Set([
            ...Object.keys(TYPES),
            ...Object.keys(registered),
            ...items.map((item) => item.type),
          ]),
        ]
      : (TABS[tab] ?? []);
  return types
    .map((type) => ({
      type,
      title: TYPES[type] ?? registered[type] ?? type,
      canCreate: type in registered,
      rows: items
        .filter((item) => item.type === type)
        .map((item) => {
          const system = item.system ?? {};
          const summary = [];
          if (type === 'class') summary.push(`${system.levels ?? 0}레벨`);
          if (type === 'subclass') {
            const parent = items.find(
              (candidate) =>
                candidate.type === 'class' &&
                candidate.system?.identifier === system.classIdentifier,
            );
            summary.push(
              parent?.name ??
                (system.classIdentifier
                  ? `연결 클래스 없음: ${system.classIdentifier}`
                  : '클래스 미지정'),
            );
          }
          if (type === 'spell')
            summary.push(
              Number(system.level) === 0
                ? '소마법'
                : `${system.level ?? 0}레벨`,
            );
          if (system.quantity != null) summary.push(`수량 ${system.quantity}`);
          if (system.equipped) summary.push('장착');
          if (system.attuned) summary.push('조율');
          if (system.uses?.max)
            summary.push(
              `사용 ${system.uses.value ?? Math.max(
                0,
                Number(system.uses.max) - (system.uses.spent ?? 0),
              )}/${system.uses.max}`,
            );
          return {
            id: item.id ?? item._id,
            name: item.name,
            img: item.img,
            type,
            summary: summary.join(' | '),
          };
        }),
    }))
    .filter((group) => tab !== 'items' || group.canCreate || group.rows.length);
}
