import { isWorkbenchUser } from '../shared/workbench-access.mjs';
import { openDocumentWorkbench } from './document-workbench-app.mjs';

const MODULE_ID = 'nihil-compendium-module';
const installed = new WeakSet();
const LABELS = {
  Actor: '액터', Item: '아이템', Scene: '씬', JournalEntry: '저널',
  RollTable: '표', Cards: '카드', Macro: '매크로', Playlist: '재생목록',
  Compendium: '컴펜디움',
};

function folderClass() {
  return globalThis.CONFIG?.Folder?.documentClass ?? globalThis.Folder?.implementation ?? globalThis.Folder;
}

export function canCreateWorkbenchFolder(
  type,
  operation = {},
) {
  const user = globalThis.game?.user;
  const Class = folderClass();
  if (!isWorkbenchUser(user) || !user?.isGM || Class?.canUserCreate?.(user) !== true) return false;
  if (!operation.pack) return true;
  const pack = globalThis.game?.packs?.get(operation.pack);
  return Boolean(
    pack && pack.documentName === type && !pack.locked &&
    pack.testUserPermission?.(
      user,
      'OWNER',
    ) === true && pack.documentClass?.canUserCreate?.(user) === true,
  );
}

export function openFolderWorkbench({
  data,
  createOptions = {},
  dialogOptions = {},
  afterCreate,
  onClose,
  canCreate = () => true,
  requireCoreSheet = false,
}) {
  const Class = folderClass();
  if (!globalThis.customElements?.get('color-picker'))
    throw new Error('Foundry 색상 선택기를 사용할 수 없습니다.');
  // 코어와 같은 임시 문서로 기본값·스키마를 얻고, 실제 생성 시에도 같은 operation을 사용한다.
  const draft = new Class(
    { name: Class.defaultName({ pack: createOptions.pack }), sorting: 'a', ...data },
    createOptions,
  );
  const source = draft.toObject();
  if (requireCoreSheet && draft._getSheetClass?.() !== globalThis.foundry?.applications?.sheets?.FolderConfig)
    throw new Error('다른 모듈의 폴더 시트는 원래 생성 경로를 사용합니다.');
  const title = `${LABELS[source.type] ?? source.type} 폴더 생성`;
  const app = openDocumentWorkbench({
    title,
    applicationOptions: {
      ...dialogOptions,
      classes: [...(dialogOptions.classes ?? []), 'ncm-folder-workbench'],
      position: { width: 640, height: 'auto', ...dialogOptions.position },
      window: { ...dialogOptions.window, title: `Nihil Workbench · ${title}` },
    },
    alwaysSave: true,
    submitLabel: '폴더 생성',
    help: '이름과 색상, 정렬 방식을 정합니다. 색상은 비워 둘 수 있습니다.',
    read: () => source,
    roots: ['name', 'color', 'sorting'],
    schema: draft.schema,
    folderForm: true,
    colorPaths: ['color'],
    canEdit: () => canCreateWorkbenchFolder(
      source.type,
      createOptions,
    ) && canCreate(),
    save: async (patch) => {
      if (!canCreateWorkbenchFolder(
        source.type,
        createOptions,
      ) || !canCreate()) throw new Error('현재 폴더를 생성할 권한이 없습니다.');
      const created = await Class.create(
        { ...source, ...patch },
        // DocumentSheetV2의 신규 문서 제출과 같이 명시한 ID를 보존한다.
        { ...createOptions, keepId: true },
      );
      if (!created) throw new Error('폴더 생성이 취소되었습니다. 입력을 보존했습니다.');
      // 생성 후 화면 갱신 실패를 생성 실패로 오인하여 중복 저장하지 않는다.
      try {
        await afterCreate?.(created);
      } catch (error) {
        globalThis.ui?.notifications?.warn?.(`폴더는 생성됐지만 목록 갱신에 실패했습니다: ${error.message}`);
      }
      return created;
    },
    onClose,
  });
  app.renderPromise = app.renderPromise.then(() => {
    if (app.rendered === false)
      throw new Error('폴더 창이 표시되지 않아 기본 창으로 돌아갑니다.');
    return app;
  });
  return app;
}

// 워크벤치의 직접 진입도 초기화·렌더 실패 시 코어 생성 경로로 돌아간다.
export function openWorkbenchFolder(config) {
  const fallback = async () => {
    if (config.canCreate && !config.canCreate()) return null;
    const created = await folderClass().createDialog(
      config.data,
      config.createOptions,
    );
    if (created) {
      try {
        await config.afterCreate?.(created);
      } catch (error) {
        globalThis.ui?.notifications?.warn?.(`폴더는 생성됐지만 목록 갱신에 실패했습니다: ${error.message}`);
      }
    }
    return created;
  };
  const recover = async (app) => {
    try {
      if (app) await app.close({ force: true }).catch(() => {});
      return await fallback();
    } catch (error) {
      globalThis.ui?.notifications?.error?.(error.message);
      return null;
    }
  };
  let app;
  try {
    app = openFolderWorkbench(config);
  } catch {
    return recover();
  }
  app.renderPromise.catch(
    () => recover(app),
  ).catch(
    (error) => globalThis.ui?.notifications?.error?.(error.message),
  );
  return app;
}

export async function folderCreateDialog(
  original,
  data = {},
  createOptions = {},
  dialogOptions = {},
) {
  const fallback = () => original(
    data,
    createOptions,
    dialogOptions,
  );
  // 별도 모듈이 확장한 시트·콜백 계약이나 구형 시그니처는 원래 체인에 맡긴다.
  const ordinaryDialog = Object.keys(dialogOptions).every(
    (key) => ['position', 'window', 'classes', 'id'].includes(key),
  );
  const legacyOptions = ['top', 'left', 'width', 'height', 'scale', 'zIndex', 'title', 'id', 'classes'];
  let app;
  try {
    if (!ordinaryDialog || legacyOptions.some((key) => key in createOptions) ||
      !Object.hasOwn(
        LABELS,
        data.type,
      ) || !canCreateWorkbenchFolder(
        data.type,
        createOptions,
      )) return fallback();
    if (!globalThis.customElements?.get('color-picker')) return fallback();
    let resolve;
    const completion = new Promise((done) => { resolve = done; });
    app = openFolderWorkbench({ data, createOptions, dialogOptions, onClose: resolve, requireCoreSheet: true });
    await app.renderPromise;
    return completion;
  } catch (error) {
    if (app) {
      app.config.onClose = undefined;
      await app.close({ force: true }).catch(() => {});
    }
    globalThis.console?.warn?.(
      'Nihil Workbench: 폴더 기본 창으로 복구합니다.',
      error,
    );
    return fallback();
  }
}

export function installFolderCreateDialog() {
  const Class = folderClass();
  if (!Class?.createDialog || installed.has(Class)) return false;
  const wrap = function (
    original,
    ...args
  ) {
    return folderCreateDialog(
      original,
      ...args,
    );
  };
  if (globalThis.libWrapper?.register) {
    try {
      globalThis.libWrapper.register(
        MODULE_ID,
        'CONFIG.Folder.documentClass.createDialog',
        wrap,
        'MIXED',
      );
    } catch (error) {
      globalThis.console?.warn?.(
        'Nihil Workbench: 폴더 연결을 등록하지 못했습니다. 기본 창을 유지합니다.',
        error,
      );
      return false;
    }
  } else {
    const original = Class.createDialog;
    Class.createDialog = function (...args) {
      return wrap.call(
        this,
        original.bind(this),
        ...args,
      );
    };
  }
  installed.add(Class);
  return true;
}
