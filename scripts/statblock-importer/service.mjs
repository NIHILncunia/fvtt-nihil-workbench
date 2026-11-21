import {
  createLocalizationPlan,
  parseImportPackage,
} from './core.mjs';

const SBI_MODULE_ID = '5e-statblock-importer';

function requireSbiApi(sbi) {
  if (sbi?.active === false) {
    throw new Error('5e Statblock Importer가 활성화되어 있지 않습니다.');
  }
  if (!sbi?.api?.import || !sbi.api?.parse) {
    throw new Error('5e Statblock Importer API를 찾을 수 없습니다.');
  }
  return sbi;
}

export function getSbiModule() {
  return globalThis.game?.modules?.get?.(SBI_MODULE_ID) ?? null;
}

export function validateStatblockImport(rawPayload, sbi = getSbiModule()) {
  const importer = requireSbiApi(sbi);
  const importPackage = parseImportPackage(rawPayload);
  const preview = importer.api.parse(importPackage.statblock);
  if (!preview?.actor) {
    throw new Error('SBI가 스탯블록에서 Actor 데이터를 생성하지 못했습니다.');
  }
  return {
    importPackage,
    preview: preview.actor,
  };
}

export async function importLocalizedStatblock(
  { rawPayload, folderId = null } = {},
  sbi = getSbiModule(),
) {
  const importer = requireSbiApi(sbi);
  const { importPackage } = validateStatblockImport(rawPayload, importer);
  const destinationFolderId = folderId || null;
  const result = await importer.api.import(
    importPackage.statblock,
    destinationFolderId,
  );
  const actor5e = result?.actor5e;
  if (!actor5e) throw new Error('SBI가 Actor를 생성하지 못했습니다.');
  const recovery = { actorId: actor5e.id, importPackage, folderId: destinationFolderId, importIssues: result?.importIssues ?? null };
  try {
    return await localizeActor(
      actor5e,
      recovery
    );
  } catch (error) {
    error.actor5e = actor5e;
    error.recovery = recovery;
    throw error;
  }
}

export async function resumeStatblockLocalization(recovery) {
  const actor = globalThis.game?.actors?.get?.(recovery?.actorId);
  if (!actor || actor.type !== 'npc' || !actor.isOwner) throw new Error('생성한 NPC를 찾을 수 없거나 수정 권한이 없습니다.');
  return localizeActor(
    actor,
    recovery
  );
}

async function localizeActor(
  actor5e,
  { importPackage, folderId: destinationFolderId, importIssues }
) {
  const localization = importPackage.localization;
  const actorUpdate = {};
  if ((actor5e.folder?.id ?? null) !== destinationFolderId) {
    actorUpdate.folder = destinationFolderId;
  }
  if (localization.actorName && actor5e.name !== localization.actorName) {
    actorUpdate.name = localization.actorName;
    actorUpdate['prototypeToken.name'] = localization.actorName;
  }
  if (Object.keys(actorUpdate).length && !await actor5e.update(actorUpdate)) {
    throw new Error('생성한 NPC의 한글화 저장이 취소되었습니다. 생성된 액터에서 다시 적용할 수 있습니다.');
  }

  const { itemUpdates, unmatched } = createLocalizationPlan(actor5e.items, localization);
  if (itemUpdates.length) {
    const updated = await actor5e.updateEmbeddedDocuments('Item', itemUpdates);
    const ids = new Set(Array.from(updated ?? []).map(item => item.id ?? item._id));
    if (itemUpdates.some(item => !ids.has(item._id))) {
      throw new Error('소유 항목의 한글화가 일부 저장되지 않았습니다. 생성된 액터에서 다시 적용할 수 있습니다.');
    }
  }

  return {
    actor5e,
    importIssues,
    itemUpdates,
    unmatched,
  };
}
