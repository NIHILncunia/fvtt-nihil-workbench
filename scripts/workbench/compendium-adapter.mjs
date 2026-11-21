import { isWorkbenchUser } from '../shared/workbench-access.mjs';
const MODULE_ID = 'nihil-compendium-module';
const EDITOR_TYPES = new Set(['Actor', 'Item']);
const AUTHORS = new Set(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);

export function modulePackChoices() {
  const concepts = new Map();
  const visit = (
    folders,
    parents = [],
  ) => {
    for (const folder of folders ?? []) {
      const names = [...parents, folder.name];
      for (const name of folder.packs ?? [])
        concepts.set(
          `${MODULE_ID}.${name}`,
          names.join(' / '),
        );
      visit(
        folder.folders,
        names,
      );
    }
  };
  visit(globalThis.game?.modules?.get?.(MODULE_ID)?.packFolders);
  return Array.from(globalThis.game?.packs?.values?.() ?? [])
    .filter(
      (pack) =>
        pack.collection?.startsWith(`${MODULE_ID}.`) &&
        EDITOR_TYPES.has(pack.documentName) &&
        pack.visible !== false &&
        (!pack.metadata?.system ||
          pack.metadata.system === globalThis.game?.system?.id),
    )
    .map((pack) => ({
      id: pack.collection,
      name: pack.title ?? pack.metadata?.label ?? pack.collection,
      concept: concepts.get(pack.collection) ?? 'NCM',
      documentName: pack.documentName,
      typeLabel: pack.documentName === 'Actor' ? '액터' : '아이템',
      locked: pack.locked,
    }));
}

export function requireModulePack(
  packId,
  documentName,
  { write = false } = {},
) {
  const pack = globalThis.game?.packs?.get?.(packId);
  if (
    !pack ||
    !modulePackChoices().some((choice) => choice.id === packId) ||
    pack.documentName !== documentName
  ) {
    throw new Error('이 모듈의 지원되는 컴펜디움을 다시 선택하십시오.');
  }
  if (
    write &&
    (!(AUTHORS.has(globalThis.game?.user?.id) || isWorkbenchUser()) ||
      pack.testUserPermission?.(
        globalThis.game.user,
        'OWNER',
      ) === false)
  )
    throw new Error('컴펜디움을 편집할 권한이 없습니다. 입력을 보존했습니다.');
  if (write && pack.locked)
    throw new Error(
      '컴펜디움이 잠겨 있습니다. 편집 잠금을 풀고 다시 저장하십시오. 입력을 보존했습니다.',
    );
  return pack;
}

export function rootDocument(document) {
  let root = document;
  while (root?.parent) root = root.parent;
  return root;
}

export function requirePackDocument(document) {
  const root = rootDocument(document);
  const folder = root?.documentName === 'Folder';
  const type = folder
    ? globalThis.game?.packs?.get?.(root.pack)?.documentName
    : root.documentName;
  const pack = requireModulePack(
    root.pack,
    type,
    { write: true },
  );
  if ((folder ? pack.folders : pack).get?.(root.id) !== root)
    throw new Error(
      '컴펜디움 문서가 삭제되었거나 바뀌었습니다. 다시 열어 최신 값을 확인하십시오. 입력을 보존했습니다.',
    );
  if (
    document !== root &&
    root.items?.get?.(document.id) !== document &&
    root.effects?.get?.(document.id) !== document
  ) {
    throw new Error(
      '소유 문서가 삭제되었거나 바뀌었습니다. 입력을 보존했습니다.',
    );
  }
  return pack;
}

export function packEditAllowed(
  packId,
  documentName,
) {
  try {
    requireModulePack(
      packId,
      documentName,
      { write: true },
    );
    return true;
  } catch {
    return false;
  }
}

export async function loadPackDocuments(pack) {
  const index = await pack.getIndex();
  const ids = Array.from(index.values()).map((entry) => entry._id ?? entry.id);
  const missing = ids.filter((id) => !pack.get(id));
  if (missing.length) await pack.getDocuments({ _id__in: missing });
  return ids.map((id) => pack.get(id)).filter(Boolean);
}

export async function createPackDocument(
  packId,
  documentName,
  source,
) {
  const pack = requireModulePack(
    packId,
    documentName,
    { write: true },
  );
  if (!String(source.name ?? '').trim())
    throw new Error('이름을 입력하십시오.');
  const created = await pack.documentClass.create(
    { ...source, name: source.name.trim() },
    { pack: pack.collection },
  );
  if (!created)
    throw new Error('컴펜디움 등록이 취소되었습니다. 입력을 보존했습니다.');
  if (created.pack !== pack.collection)
    throw new Error('등록 결과의 컴펜디움이 일치하지 않습니다.');
  return created;
}
