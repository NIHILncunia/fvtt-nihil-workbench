import { getDocumentWorkbenchClass } from './document-workbench-app.mjs';

const LEVELS = Object.freeze({ 0: '조회 불가', 1: '제한 조회', 2: '조회 가능', 3: '조회·수정 가능' });
let OwnershipClass;

export function ownershipFields(source, users = []) {
  const ownership = source.ownership ?? {};
  return [{ id: 'default', name: '기본 권한 (개별 설정이 없는 사용자)' }, ...Array.from(users)
    .filter(user => !user.isGM).map(user => ({ id: user.id, name: user.name }))]
    .map(user => {
      if (!/^[A-Za-z0-9_-]+$/.test(user.id) || ['__proto__', 'prototype', 'constructor'].includes(user.id)) {
        throw new Error('사용자 ID를 확인하십시오.');
      }
      const original = ownership[user.id];
      const initial = String(original ?? (user.id === 'default' ? 0 : -1));
      return {
        path: `ownership.${user.id}`, title: user.name, original, initial, value: initial,
        number: true, integer: true, min: user.id === 'default' ? 0 : -1, max: 3,
        select: true,
        options: Object.entries({ ...(user.id === 'default' ? {} : { '-1': '기본 권한 따르기' }), ...LEVELS })
          .map(([value, label]) => ({ value, label, selected: value === initial })),
      };
    });
}

export function canManageOwnership(document, callerCanEdit = () => true) {
  if (!callerCanEdit() || !globalThis.game?.user?.isGM || document?.parent || document?.pack) return false;
  const collection = document?.documentName === 'Actor' ? globalThis.game?.actors
    : document?.documentName === 'Item' ? globalThis.game?.items : null;
  return Boolean(collection?.get?.(document.id) === document && document.canUserModify?.(globalThis.game.user, 'update') !== false);
}

export function ownershipPatch(patch, fields, current = null) {
  const allowed = new Set(fields.map(field => field.path));
  const result = {};
  for (const [path, value] of Object.entries(patch)) {
    if (!allowed.has(path) || !Number.isInteger(value) || value < (path === 'ownership.default' ? 0 : -1) || value > 3) {
      throw new Error('사용자 권한 값을 확인하십시오.');
    }
    result[path] = value;
  }
  // Foundry v14: 권한 묶음(DocumentOwnershipField)은 삭제 연산자를 받지 않는다.
  // 코어 권한 창처럼 바뀐 전체 권한을 ForcedReplacement(_replace)로 보낸다.
  const replace = globalThis._replace ?? globalThis.foundry?.data?.operators?.ForcedReplacement?.create;
  if (replace && current) {
    const ownership = { ...current };
    for (const [path, value] of Object.entries(result)) {
      const userId = path.slice('ownership.'.length);
      if (value === -1) delete ownership[userId];
      else ownership[userId] = value;
    }
    return { ownership: replace(ownership) };
  }
  // 연산자가 없는 환경(v13·단위 시험)은 예전 삭제 키를 쓴다.
  const legacy = {};
  for (const [path, value] of Object.entries(result)) {
    if (value === -1) legacy[path.replace('ownership.', 'ownership.-=')] = null;
    else legacy[path] = value;
  }
  return legacy;
}

function getOwnershipClass() {
  if (OwnershipClass) return OwnershipClass;
  class OwnershipWorkbench extends getDocumentWorkbenchClass() {
    static DEFAULT_OPTIONS = {
      window: { title: 'Nihil Workbench · 사용자 권한', resizable: true },
      position: { width: 640, height: 640 },
    };
    static PARTS = { main: { template: 'modules/nihil-compendium-module/templates/workbench/ownership-workbench.hbs' } };
  }
  OwnershipClass = OwnershipWorkbench;
  return OwnershipClass;
}

export function editOwnership(document, options = {}) {
  const callerCanEdit = options.canEdit ?? (() => true);
  if (!canManageOwnership(document, callerCanEdit)) {
    globalThis.ui?.notifications?.warn?.('월드 액터·아이템의 권한은 허용된 GM만 관리할 수 있습니다. 소유 아이템은 액터 권한을 따릅니다.');
    return null;
  }
  const fields = ownershipFields(document.toObject(), globalThis.game.users?.values?.() ?? []);
  const Class = getOwnershipClass();
  const app = new Class({
    title: `${document.name} · 사용자 권한`,
    help: '기본 권한과 사용자별 조회·수정 권한을 설정합니다. GM은 문서 권한에 관계없이 접근합니다. 소유 아이템은 액터 권한을 따르며, 워크벤치 진입은 기존 허용 사용자 정책을 유지합니다.',
    submitLabel: '권한 저장', discardMessage: '<p>저장하지 않은 권한 입력을 버리시겠습니까?</p>',
    fields, read: () => document.toObject(),
    ...options,
    canEdit: () => canManageOwnership(document, callerCanEdit),
    save: async patch => {
      // Recheck immediately before writing; keep unrelated ownership entries intact.
      if (!canManageOwnership(document, callerCanEdit)) throw new Error('현재 대상의 권한을 변경할 수 없습니다. 입력을 보존했습니다.');
      const updated = await document.update(ownershipPatch(patch, fields, document.toObject?.().ownership ?? document.ownership));
      if (!updated) throw new Error('권한 저장이 취소되었습니다. 입력을 보존했습니다.');
      return updated;
    },
  });
  app.render({ force: true });
  return app;
}
