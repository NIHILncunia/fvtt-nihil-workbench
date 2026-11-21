import { prepareActorItemCopy } from './item-copy-adapter.mjs';
import { requireWriteResult } from './write-result.mjs';
import { requirePackDocument } from './compendium-adapter.mjs';

export function createPackItemContext(item) {
  requireItem(item);
  return {
    kind: 'pack',
    item,
    update(partial) {
      requirePackDocument(item);
      return item.update(partial);
    },
  };
}

function requireItem(item) {
  if (!item?.id) throw new Error('Item 문서가 필요합니다.');
}

function requireActor(actor) {
  if (!actor?.id) throw new Error('Actor 문서가 필요합니다.');
}

function readItemSource(item) {
  if (typeof item?.toObject !== 'function') {
    throw new Error('Embedded Item 원본을 읽을 수 없습니다.');
  }
  return item.toObject();
}

function actorOwnsItem(actor, item) {
  return Boolean(item?.parent && (item.parent === actor || item.parent.id === actor.id));
}

export function createWorldItemContext(item) {
  requireItem(item);
  return {
    kind: 'world',
    item,
    update(partial) {
      if (typeof item.update !== 'function') {
        throw new Error('World Item 갱신 API를 사용할 수 없습니다.');
      }
      return item.update(partial);
    },
    create(source) {
      if (typeof globalThis.Item?.create !== 'function') {
        throw new Error('World Item 생성 API를 사용할 수 없습니다.');
      }
      return globalThis.Item.create(source);
    },
    remove() {
      if (typeof item.delete !== 'function') {
        throw new Error('World Item 삭제 API를 사용할 수 없습니다.');
      }
      return item.delete();
    },
    duplicate() {
      if (typeof item.clone !== 'function') {
        throw new Error('World Item 복제 API를 사용할 수 없습니다.');
      }
      return item.clone({ name: `${item.name} (복제)` }, { save: true });
    },
  };
}

export function createEmbeddedItemContext(actor, item) {
  requireActor(actor);
  requireItem(item);
  if (!actorOwnsItem(actor, item)) {
    throw new Error('소유 Actor와 Embedded Item이 일치하지 않습니다.');
  }
  return {
    kind: 'embedded',
    actor,
    item,
    update(partial) {
      if (typeof actor.updateEmbeddedDocuments !== 'function') {
        throw new Error('Actor Embedded Item 갱신 API를 사용할 수 없습니다.');
      }
      const { _id: _ignoredId, ...safePartial } = partial ?? {};
      return actor.updateEmbeddedDocuments('Item', [{ ...safePartial, _id: item.id }]);
    },
    async create(source) {
      if (typeof actor.createEmbeddedDocuments !== 'function') {
        throw new Error('Actor Embedded Item 생성 API를 사용할 수 없습니다.');
      }
      return (await actor.createEmbeddedDocuments('Item', [source]))[0] ?? null;
    },
    remove() {
      if (typeof actor.deleteEmbeddedDocuments !== 'function') {
        throw new Error('Actor Embedded Item 삭제 API를 사용할 수 없습니다.');
      }
      return actor.deleteEmbeddedDocuments('Item', [item.id]);
    },
    async duplicate() {
      if (typeof actor.createEmbeddedDocuments !== 'function') {
        throw new Error('Actor Embedded Item 생성 API를 사용할 수 없습니다.');
      }
      const source = await prepareActorItemCopy(
        actor,
        item,
      );
      // A duplicate in the same Actor retains its existing storage location.
      const original = readItemSource(item);
      if (Object.hasOwn(
        original.system ?? {},
        'container',
      )) source.system.container = original.system.container;
      source.name = `${item.name} (복제)`;
      return requireWriteResult(
        await actor.createEmbeddedDocuments(
          'Item',
          [source],
          { keepId: true, keepEmbeddedIds: true },
        ),
        '소유 아이템 복제',
      )[0];
    },
  };
}
