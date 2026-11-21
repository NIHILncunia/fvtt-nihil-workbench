import { requirePackDocument, rootDocument } from './compendium-adapter.mjs';

export function requireWriteResult(result, label = '변경사항 저장') {
  if (!result || (Array.isArray(result) && !result.length)) {
    throw new Error(`${label}이 취소되었습니다. 입력을 보존했습니다.`);
  }
  return result;
}

export function requireWritableItem(item, canManage) {
  const actor = item?.parent;
  if (rootDocument(item)?.pack) {
    if (!canManage || item.isOwner === false || actor?.isOwner === false
      || item.canUserModify?.(globalThis.game?.user, 'update') === false
      || actor?.canUserModify?.(globalThis.game?.user, 'update') === false) {
      throw new Error('대상을 수정할 권한이 없습니다. 입력을 보존했습니다.');
    }
    requirePackDocument(item);
    return item;
  }
  const collection = actor?.items ?? globalThis.game?.items;
  if (!item || item.pack || collection?.get?.(item.id) !== item
    || (actor && globalThis.game?.actors?.get?.(actor.id) !== actor)
    || !canManage || item.isOwner === false || actor?.isOwner === false
    || item.canUserModify?.(globalThis.game?.user, 'update') === false
    || actor?.canUserModify?.(globalThis.game?.user, 'update') === false) {
    throw new Error('대상이 삭제되었거나 수정할 권한이 없습니다. 입력을 보존했습니다.');
  }
  return item;
}
