const MODULE_ID = 'nihil-compendium-module';

export function openStatblockImporter() {
  const openActorWorkbench = globalThis.game?.modules
    ?.get?.(MODULE_ID)
    ?.api
    ?.openActorWorkbench;
  if (typeof openActorWorkbench !== 'function') {
    globalThis.ui?.notifications?.error?.('Nihil Actor Workbench를 준비하지 못했습니다.');
    return null;
  }
  return openActorWorkbench({
    activeType: 'npc',
    creationMode: 'sbi',
  });
}
