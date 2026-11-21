function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
}

function getActivity(item, activityId) {
  return item?.system?.activities?.get?.(activityId)
    ?? values(item?.system?.activities).find((activity) => activity?.id === activityId)
    ?? null;
}

export function availableActivityTypes(item, activityTypes = {}) {
  return Object.entries(activityTypes)
    .filter(([, config]) => config?.configurable !== false)
    .filter(([, config]) => {
      const available = config?.documentClass?.availableForItem;
      return typeof available !== 'function' || available.call(config.documentClass, item) !== false;
    })
    .map(([value, config]) => ({
      value,
      label: config?.label ?? config?.metadata?.title ?? value,
    }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ko'));
}

export async function createActivity(item, type, data = {}) {
  if (!item?.createActivity) throw new Error('Item does not support createActivity().');
  const before = new Set(values(item.system?.activities).map((activity) => activity.id));
  await item.createActivity(type, data, { renderSheet: false });
  const created = values(item.system?.activities).find((activity) => !before.has(activity.id));
  if (!created) throw new Error('액티비티 생성이 취소되었습니다. 입력을 보존했습니다.');
  return created;
}

export async function duplicateActivity(item, activityId) {
  const activity = getActivity(item, activityId);
  if (!activity) throw new Error(`Activity ${activityId} not found.`);
  const source = activity.toObject ? activity.toObject() : { ...activity };
  delete source._id;
  delete source.id;
  source.name = `${activity.name || 'Activity'} (복제)`;
  return createActivity(item, activity.type, source);
}

export async function renameActivity(item, activityId, name) {
  const activity = getActivity(item, activityId);
  if (!activity?.update) throw new Error(`Activity ${activityId} cannot be updated.`);
  await activity.update({ name: String(name ?? '') });
  return activity;
}

export async function deleteActivity(item, activityId) {
  const activity = getActivity(item, activityId);
  if (!activity?.delete) throw new Error(`Activity ${activityId} cannot be deleted.`);
  return activity.delete();
}

export async function moveActivity(item, activityId, direction) {
  const activities = values(item?.system?.activities)
    .slice()
    .sort((a, b) => Number(a?.sort ?? 0) - Number(b?.sort ?? 0));
  const index = activities.findIndex((activity) => activity.id === activityId);
  if (index < 0) throw new Error(`Activity ${activityId} not found.`);
  const targetIndex = Math.max(0, Math.min(activities.length - 1, index + Math.sign(direction)));
  if (targetIndex === index) return item;
  const [moved] = activities.splice(index, 1);
  activities.splice(targetIndex, 0, moved);
  const updateData = Object.fromEntries(activities.map((activity, i) => [activity.id, { sort: (i + 1) * 1000 }]));
  if (!item?.update) throw new Error('Item does not support update().');
  return item.update({ 'system.activities': updateData });
}
