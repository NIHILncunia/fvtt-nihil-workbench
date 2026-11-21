import { advancementSourceList } from './advancement-source.mjs';
// Only known D&D5e references are transformed. Module flags and external UUIDs
// remain intact; copying one item does not import its dependencies or contents.
export async function prepareActorItemCopy(
  actor,
  item
) {
  const source = structuredClone(item.toObject());
  const oldId = source._id;
  const newId = globalThis.foundry.utils.randomID();
  if (!newId || actor.items?.has(newId))
    throw new Error('새 아이템 ID를 만들지 못했습니다. 다시 추가하십시오.');
  const oldUuid = item.uuid;
  const newUuid = `${actor.uuid}.Item.${newId}`;
  const sameActor = item.parent === actor;
  const linkedId = (id) => {
    if (id === oldId) return newId;
    if (sameActor && actor.items?.has(id)) return id;
    throw new Error('기존 액터의 성장 지급 결과가 연결되어 있습니다. 지급 결과를 정리한 라이브러리 원본을 선택하십시오.');
  };

  for (const advancement of advancementSourceList(source.system?.advancement)) {
    if (advancement.type === 'ItemGrant') {
      if (advancement.value?.added) advancement.value.added = Object.fromEntries(
        Object.entries(advancement.value.added).map(
          ([id, uuid]) => {
            return [linkedId(id), uuid];
          }
        )
      );
    }
    if (advancement.type === 'ItemChoice') {
      for (const [level, added] of Object.entries(advancement.value?.added ?? {})) {
        advancement.value.added[level] = Object.fromEntries(
          Object.entries(added).map(
            ([id, uuid]) => {
              return [linkedId(id), uuid];
            }
          )
        );
      }
      for (const replaced of Object.values(advancement.value?.replaced ?? {})) {
        for (const key of ['original', 'replacement']) {
          if (replaced[key]) replaced[key] = linkedId(replaced[key]);
        }
      }
    }
  }
  for (const key of ['advancementOrigin', 'advancementRoot']) {
    const value = source.flags?.dnd5e?.[key];
    if (!value) continue;
    const [id, ...suffix] = value.split('.');
    source.flags.dnd5e[key] = [linkedId(id), ...suffix].join('.');
  }

  const resolved = new Map();
  const effectIds = new Set((source.effects ?? []).map((effect) => effect._id));
  for (const activity of Object.values(source.system?.activities ?? {})) {
    for (const effect of activity.effects ?? []) {
      if (!effectIds.has(effect._id))
        throw new Error('액티비티에 연결된 효과가 없습니다. 원본의 효과 연결을 확인하십시오.');
    }
    for (const target of activity.consumption?.targets ?? []) {
      if (!['itemUses', 'material'].includes(target.type) || !target.target) continue;
      const id = target.target;
      if (id === oldId || (oldUuid && id === oldUuid)) {
        target.target = newId;
        continue;
      }
      if (id.includes('.') || sameActor) continue;
      // Identifiers are stable names; 16-character document IDs need the
      // original collection's UUID so a coincidental destination ID cannot win.
      if (!/^[a-zA-Z0-9]{16}$/.test(id)) continue;
      if (!resolved.has(id)) {
        const document = item.parent?.items?.get(id)
          ?? (item.pack
            ? await globalThis.game?.packs?.get(item.pack)?.getDocument(id)
            : globalThis.game?.items?.get(id));
        let identifier = false;
        if (!document) {
          const collection = item.pack
            ? await globalThis.game?.packs?.get(item.pack)?.getIndex({ fields: ['system.identifier'] })
            : item.parent?.items ?? globalThis.game?.items;
          identifier = Array.from(collection?.values?.() ?? []).some(
            (entry) => entry.system?.identifier === id
          );
        }
        const uuid = document?._stats?.compendiumSource
          ?? document?.flags?.dnd5e?.sourceId
          ?? document?.uuid;
        resolved.set(
          id,
          uuid ?? (identifier ? id : undefined)
        );
      }
      const uuid = resolved.get(id);
      if (!uuid)
        throw new Error('소모 대상 아이템의 원본을 찾을 수 없습니다. 원본 액티비티의 소모 연결을 확인하십시오.');
      target.target = uuid;
    }
  }
  for (const effect of source.effects ?? []) {
    if (oldUuid && effect.origin === oldUuid) effect.origin = newUuid;
  }
  const provenance = item.pack ? oldUuid : source._stats?.compendiumSource;
  for (const key of ['_stats', 'folder', 'ownership']) delete source[key];
  if (provenance) source._stats = { compendiumSource: provenance };
  else if (oldUuid) {
    source.flags ??= {};
    source.flags.dnd5e ??= {};
    source.flags.dnd5e.sourceId ??= oldUuid;
  }
  source._id = newId;
  if (Object.hasOwn(
    source.system ?? {},
    'container'
  )) source.system.container = null;
  return source;
}
