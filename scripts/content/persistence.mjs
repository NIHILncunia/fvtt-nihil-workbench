import { advancementSourceList } from '../shared/advancement-source.mjs';
import { ACTIVITY_TYPES, ADVANCEMENT_TYPES, ITEM_TYPES } from './codes.mjs';
import {
  checkedResult,
  assertFields,
  copy,
  merge,
  MODULE_ID,
  object,
  paths,
  runtime,
  serial,
  stable,
  text,
} from './internal.mjs';

export function requireWritablePack(
  packId,
  documentName,
) {
  runtime();
  const pack = globalThis.game.packs?.get(packId);
  const manifest = globalThis.game.modules?.get(MODULE_ID);
  const registered = manifest?.packs?.some(
    (entry) => `${MODULE_ID}.${entry.name}` === packId,
  );
  if (
    !pack ||
    !registered ||
    !['Actor', 'Item'].includes(documentName) ||
    pack.documentName !== documentName ||
    pack.metadata?.system !== 'dnd5e' ||
    pack.metadata?.packageType === 'world'
  ) {
    throw new Error('이 모듈에 등록된 D&D5e Actor·Item 팩을 선택하십시오.');
  }
  if (
    !globalThis.game.user?.isGM ||
    pack.visible === false ||
    pack.testUserPermission?.(
      globalThis.game.user,
      'OWNER',
    ) === false
  )
    throw new Error('컴펜디움 작성 권한이 없습니다.');
  if (pack.locked) throw new Error('컴펜디움 편집 잠금을 해제하십시오.');
  return pack;
}

export function requireDocument(document) {
  if (!document) throw new Error('수정할 문서가 없습니다.');
  let root = document;
  while (root.parent) {
    const parent = root.parent;
    const collection =
      root.documentName === 'Item' ? parent.items : parent.effects;
    if (collection?.get(root.id) !== root)
      throw new Error('소유 문서가 삭제되었거나 바뀌었습니다.');
    root = parent;
  }
  const pack = requireWritablePack(
    root.pack,
    root.documentName,
  );
  if (pack.get(root.id) !== root)
    throw new Error('컴펜디움 문서가 삭제되었거나 바뀌었습니다.');
  if (
    [document, document.parent, root].some(
      (entry) =>
        entry &&
        (entry.isOwner === false ||
          entry.canUserModify?.(
            globalThis.game.user,
            'update',
          ) === false),
    )
  )
    throw new Error('문서를 수정할 권한이 없습니다.');
  return pack;
}

function strictSystem(
  source,
  model,
) {
  const fields = model?.schema?.fields;
  if (!fields) throw new Error('시스템 데이터 스키마를 찾지 못했습니다.');
  for (const key of Object.keys(source ?? {}))
    if (!(key in fields))
      throw new Error(`시스템 스키마에 없는 필드입니다: ${key}`);
  assertFields(
    source,
    fields,
    'system.',
  );
}

async function references(item) {
  const effects = new Set((item.effects ?? []).map((effect) => effect._id));
  for (const [id, activity] of Object.entries(item.system?.activities ?? {})) {
    if (!ACTIVITY_TYPES.includes(activity.type) && activity.type !== 'order')
      throw new Error(`지원하지 않는 액티비티입니다: ${activity.type}`);
    if (activity._id !== id)
      throw new Error('액티비티 ID와 저장 키가 다릅니다.');
    for (const reference of activity.effects ?? [])
      if (!effects.has(reference._id))
        throw new Error('액티비티가 참조하는 내장 효과가 없습니다.');
    if (activity.type === 'forward' && activity.activity?.id) {
      const linked = activity.activity.id;
      if (linked === id || !(linked in item.system.activities))
        throw new Error('연결 액티비티의 대상이 없거나 자기 자신입니다.');
      const visited = new Set([id]);
      let target = linked;
      while (item.system.activities[target]?.type === 'forward') {
        if (visited.has(target)) throw new Error('액티비티 연결이 순환합니다.');
        visited.add(target);
        target = item.system.activities[target].activity?.id;
        if (!target || !(target in item.system.activities))
          throw new Error('연결 액티비티의 대상이 없습니다.');
      }
    }
    if (activity.type === 'cast' && activity.spell?.uuid) {
      const spell = await globalThis.fromUuid?.(activity.spell.uuid);
      if (spell?.documentName !== 'Item' || spell.type !== 'spell')
        throw new Error('시전할 주문의 UUID가 올바르지 않습니다.');
    }
    for (const profile of activity.profiles ?? [])
      if (profile.uuid) {
        const actor = await globalThis.fromUuid?.(profile.uuid);
        if (actor?.documentName !== 'Actor')
          throw new Error('소환·변신 대상 액터의 UUID가 올바르지 않습니다.');
      }
  }
  for (const advancement of advancementSourceList(item.system?.advancement)) {
    if (!ADVANCEMENT_TYPES.includes(advancement.type))
      throw new Error('지원하지 않는 Advancement입니다.');
    const configuration = advancement.configuration ?? {};
    const references =
      advancement.type === 'ItemGrant'
        ? configuration.items?.map((entry) => entry.uuid)
        : advancement.type === 'ItemChoice'
          ? configuration.pool?.map((entry) => entry.uuid)
          : [];
    for (const uuid of references ?? []) {
      const target = await globalThis.fromUuid?.(uuid);
      if (!target || target.documentName !== 'Item')
        throw new Error(`부여할 아이템 UUID를 찾지 못했습니다: ${uuid}`);
    }
  }
}

export async function validateContentSource(
  documentName,
  input,
  options = {},
) {
  runtime();
  const source = object(input);
  text(
    source.name,
    '이름',
  );
  if (documentName === 'Actor' && source.type !== 'npc')
    throw new Error('콘텐츠 제작은 NPC만 지원합니다.');
  if (documentName === 'Item' && !ITEM_TYPES.includes(source.type))
    throw new Error('지원하지 않는 아이템 타입입니다.');
  const Class = globalThis.CONFIG?.[documentName]?.documentClass;
  if (!Class || !['Actor', 'Item', 'ActiveEffect'].includes(documentName))
    throw new Error('문서 클래스를 찾지 못했습니다.');
  // Validate with the installed system without publishing defaults or generated IDs.
  const model = new Class(
    copy(source),
    {
      pack: options.packId,
      parent: options.parent,
      strict: true,
    },
  );
  model.validate({ strict: true });
  assertFields(
    source,
    model.schema?.fields,
  );
  if (documentName !== 'ActiveEffect')
    strictSystem(
      source.system,
      model.system,
    );
  if (documentName === 'Item') await references(source);
  if (documentName === 'Actor')
    for (const item of source.items ?? []) {
      if (!ITEM_TYPES.includes(item.type))
        throw new Error('NPC 소유 아이템의 타입이 올바르지 않습니다.');
      const child = model.items.get(item._id);
      if (child) strictSystem(
        item.system,
        child.system,
      );
      await references(item);
    }
  return source;
}

function keyed(
  source,
  options,
) {
  const output = object(source);
  if (options.contentKey != null) {
    const contentKey = text(
      options.contentKey,
      '콘텐츠 키',
    );
    const old = output.flags?.[MODULE_ID]?.contentKey;
    if (old != null && old !== contentKey)
      throw new Error('소스와 옵션의 콘텐츠 키가 다릅니다.');
    output.flags ??= {};
    output.flags[MODULE_ID] ??= {};
    output.flags[MODULE_ID].contentKey = contentKey;
  }
  return output;
}

async function findKey(
  pack,
  key,
) {
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.contentKey`],
  });
  const matches = [...index.values()].filter(
    (entry) => entry.flags?.[MODULE_ID]?.contentKey === key,
  );
  if (matches.length > 1)
    throw new Error('같은 콘텐츠 키의 문서가 여러 개 있습니다.');
  return matches[0] ? pack.getDocument(matches[0]._id ?? matches[0].id) : null;
}

async function create(
  documentName,
  source,
  options,
) {
  const pack = requireWritablePack(
    options.packId,
    documentName,
  );
  const prepared = keyed(
    source,
    options,
  );
  const key = prepared.flags?.[MODULE_ID]?.contentKey;
  if (key && (await findKey(
    pack,
    key,
  )))
    throw new Error('이미 등록된 콘텐츠 키입니다. upsert를 사용하십시오.');
  await validateContentSource(
    documentName,
    prepared,
    options,
  );
  requireWritablePack(
    options.packId,
    documentName,
  );
  const result = checkedResult(
    await pack.documentClass.create(
      prepared,
      { pack: options.packId },
    ),
    '콘텐츠 생성',
  );
  if (result.pack !== options.packId)
    throw new Error('생성된 문서의 팩이 다릅니다.');
  return result;
}

export async function createCompendiumDocument(
  documentName,
  source,
  options = {},
) {
  return serial(
    `${options.packId}:${options.contentKey ?? ''}`,
    () =>
      create(
        documentName,
        source,
        options,
      ),
  );
}

export async function upsertCompendiumDocument(
  documentName,
  input,
  options = {},
) {
  const key = text(
    options.contentKey,
    '콘텐츠 키',
  );
  return serial(
    `${options.packId}:${key}`,
    async () => {
      const pack = requireWritablePack(
        options.packId,
        documentName,
      );
      const existing = await findKey(
        pack,
        key,
      );
      if (!existing) {
        if (options.expectedSource)
          throw new Error('수정 대상으로 읽었던 문서가 삭제되었습니다.');
        return create(
          documentName,
          input,
          options,
        );
      }
      if (!options.expectedSource)
        throw new Error('기존 문서 수정에는 expectedSource 원본이 필요합니다.');
      const baseline = existing.toObject();
      if (stable(baseline) !== stable(options.expectedSource))
        throw new Error('원본이 변경되었습니다. 최신 문서를 확인하십시오.');
      const patch = keyed(
        input,
        options,
      );
      if (
        (patch._id != null && patch._id !== existing.id) ||
        (patch.type != null && patch.type !== existing.type)
      )
        throw new Error('기존 문서의 ID·타입을 변경할 수 없습니다.');
      for (const field of ['_id', '_stats', 'ownership', 'folder'])
        if (field in patch)
          throw new Error(`upsert에서 직접 변경하지 않는 필드입니다: ${field}`);
      await validateContentSource(
        documentName,
        merge(
          baseline,
          patch,
        ),
        options,
      );
      requireDocument(existing);
      if (stable(existing.toObject()) !== stable(options.expectedSource))
        throw new Error('검사 중 원본이 변경되었습니다.');
      return checkedResult(
        await existing.update(Object.fromEntries(paths(patch))),
        '콘텐츠 수정',
      );
    },
  );
}
