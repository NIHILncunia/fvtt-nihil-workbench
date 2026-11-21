export function favoriteChoices(
  actor,
  source,
) {
  const items = Array.from(
    actor.items?.contents ?? actor.items?.values?.() ?? source.items ?? [],
  );
  const result = {};
  for (const item of items) {
    const uuid =
      item.getRelativeUUID?.(actor) ?? `.Item.${item.id ?? item._id}`;
    result[uuid] = { label: item.name, favoriteType: 'item' };
    const activities = item.system?.activities;
    for (const activity of Array.from(
      activities?.contents ??
        activities?.values?.() ??
        Object.values(activities ?? {}),
    )) {
      result[`${uuid}.Activity.${activity.id ?? activity._id}`] = {
        label: `${item.name} · ${activity.name}`,
        favoriteType: 'activity',
      };
    }
  }
  return result;
}

export function habitatRows(value) {
  const config = globalThis.CONFIG?.DND5E?.habitats ?? {};
  const labels = {
    any: '모든 환경',
    arctic: '극지',
    coastal: '해안',
    desert: '사막',
    forest: '숲',
    grassland: '초원',
    hill: '언덕',
    mountain: '산악',
    planar: '차원',
    swamp: '늪',
    underdark: '언더다크',
    underwater: '수중',
    urban: '도시',
  };
  return value.map((
    row,
    index,
  ) => {
    const options = Object.entries(config).map(([value, entry]) => ({
      value,
      label:
        labels[value] ??
        globalThis.game?.i18n?.localize?.(entry.label ?? entry) ??
        entry.label ??
        entry,
      selected: value === row.type,
    }));
    if (!options.some((option) => option.value === row.type))
      options.unshift({
        value: row.type ?? '',
        label: row.type || '서식지 선택',
        selected: true,
      });
    return { index, options, subtype: row.subtype ?? '' };
  });
}

export function readHabitatInputs(form) {
  const container = form?.querySelector?.('[data-actor-habitat]');
  const field = container?.querySelector?.('[data-habitat-source]');
  if (!field) return null;
  const source = JSON.parse(field.value);
  return Array.from(container.querySelectorAll('[data-habitat-row]')).map(
    (
      row,
      index,
    ) => {
      const original = source[index] ?? {};
      const type = row.querySelector('[data-habitat-type]').value;
      const subtype = row.querySelector('[data-habitat-subtype]').value;
      const result = { ...original, type };
      if (subtype !== (original.subtype ?? '')) result.subtype = subtype;
      return result;
    },
  );
}

export function validateHabitat(
  value,
  original,
) {
  if (
    !Array.isArray(value) ||
    value.some(
      (row) =>
        !row ||
        typeof row !== 'object' ||
        typeof row.type !== 'string' ||
        !row.type ||
        (row.subtype != null && typeof row.subtype !== 'string'),
    )
  )
    throw new Error('각 서식지의 유형과 설명을 확인하십시오.');
  const allowed = new Set([
    ...Object.keys(globalThis.CONFIG?.DND5E?.habitats ?? {}),
    ...(original ?? []).map((row) => row.type),
  ]);
  if (value.some((row) => !allowed.has(row.type)))
    throw new Error('목록에 있는 서식지를 선택하십시오.');
  return value;
}
