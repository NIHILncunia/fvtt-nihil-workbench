import { prepareActorItemCopy } from '../shared/item-copy-adapter.mjs';
import { checkedResult, serial, text } from './internal.mjs';
import { requireDocument } from './persistence.mjs';

export async function attachItemToActor(
  actor,
  item,
) {
  return serial(
    `embedded:${actor?.uuid}`,
    async () => {
      requireDocument(actor);
      if (
        actor.documentName !== 'Actor' ||
        actor.type !== 'npc' ||
        item?.documentName !== 'Item'
      )
        throw new Error('NPC와 원본 Item을 선택하십시오.');
      // Read-only source packs are permitted; only the destination is a write target.
      if (
        item.compendium?.visible === false ||
        (item.isOwner === false &&
          item.testUserPermission?.(
            globalThis.game.user,
            'OBSERVER',
          ) === false)
      )
        throw new Error('원본 아이템을 읽을 권한이 없습니다.');
      const source = await prepareActorItemCopy(
        actor,
        item,
      );
      requireDocument(actor);
      const [created] = checkedResult(
        await actor.createEmbeddedDocuments(
          'Item',
          [source],
          {
            keepId: true,
            keepEmbeddedIds: true,
          },
        ),
        'NPC 아이템 추가',
      );
      return checkedResult(
        created,
        'NPC 아이템 추가',
      );
    },
  );
}

export async function linkActivityEffect(
  activity,
  effect,
) {
  const item = activity?.item;
  return serial(
    `embedded:${item?.uuid}`,
    async () => {
      requireDocument(item);
      if (
        item.system.activities?.get(activity.id) !== activity ||
        effect?.parent !== item ||
        item.effects.get(effect.id) !== effect
      )
        throw new Error('같은 아이템의 액티비티와 내장 효과를 연결하십시오.');
      if (!activity.schema?.fields?.effects)
        throw new Error('이 액티비티는 효과 연결을 지원하지 않습니다.');
      const references = activity.toObject().effects ?? [];
      if (references.some((entry) => entry._id === effect.id)) return activity;
      checkedResult(
        await item.updateActivity(
          activity.id,
          {
            effects: [...references, { _id: effect.id }],
          },
        ),
        '효과 연결',
      );
      return item.system.activities.get(activity.id);
    },
  );
}

export function buildContentLink(
  document,
  label = document?.name,
) {
  const uuid = text(
    typeof document === 'string' ? document : document?.uuid,
    '문서 UUID',
  );
  const title = text(
    label,
    '링크 이름',
  );
  if (
    !/^(Compendium|Actor|Item)\.[\w.-]+$/.test(uuid) ||
    /[\[\]{}<>\r\n]/.test(title)
  )
    throw new Error('UUID 링크에 사용할 수 없는 값입니다.');
  return `@UUID[${uuid}]{${title}}`;
}
