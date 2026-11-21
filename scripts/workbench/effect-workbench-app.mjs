import { getDocumentWorkbenchClass } from './document-workbench-app.mjs';
import { requirePackDocument, rootDocument } from './compendium-adapter.mjs';
import {
  effectFields,
  effectGroups,
  effectStatusOptions,
  migrateLegacyShowIcon,
  validateEffectPatch,
} from './effect-fields.mjs';

let EffectEditorClass;

// v14 start는 null을 허용하는 묶음이고 time은 필수다. start가 비어 있는데 일부 칸만 넣으면
// 검증에 걸리므로, 그때는 현재 월드 시간을 기본값으로 한 전체 묶음으로 바꿔 보낸다.
export function effectStartPatch(patch, source, worldTime = globalThis.game?.time?.worldTime ?? 0) {
  const keys = Object.keys(patch).filter((key) => key.startsWith('start.'));
  if (!keys.length || source?.start) return patch;
  const start = { combat: null, combatant: null, initiative: null, round: null, turn: null, time: worldTime };
  const next = { ...patch };
  for (const key of keys) {
    const value = next[key];
    delete next[key];
    start[key.slice('start.'.length)] = value;
  }
  if (start.time == null) start.time = worldTime;
  next.start = start;
  return next;
}

export function canEditWorkbenchEffect(effect, callerCanEdit = () => true) {
  const parent = effect?.parent;
  const owner = parent?.documentName === 'Item' && parent.parent?.documentName === 'Actor' ? parent.parent : parent;
  const collection = owner?.documentName === 'Actor' ? globalThis.game?.actors
    : owner?.documentName === 'Item' ? globalThis.game?.items : null;
  if (rootDocument(parent)?.pack) {
    try {
      requirePackDocument(parent);
      return Boolean(effect && callerCanEdit()
        && [effect, parent, owner].every(document => document?.isOwner !== false
          && document?.canUserModify?.(globalThis.game?.user, 'update') !== false)
        && parent.effects?.get?.(effect.id) === effect);
    } catch {
      return false;
    }
  }
  return Boolean(effect && callerCanEdit()
    && !effect.pack && !parent?.pack && !owner?.pack
    && [effect, parent, parent?.parent, owner].every(document => document?.isOwner !== false
      && document?.canUserModify?.(globalThis.game?.user, 'update') !== false)
    && (!collection?.get || collection.get(owner.id) === owner)
    && (!parent?.effects?.get || parent.effects.get(effect.id) === effect)
    && (parent === owner || !owner?.items?.get || owner.items.get(parent.id) === parent));
}

function getEffectEditorClass() {
  if (EffectEditorClass) return EffectEditorClass;
  const Base = getDocumentWorkbenchClass();
  class EffectWorkbench extends Base {
    static DEFAULT_OPTIONS = {
      window: {
        title: 'Nihil Workbench · 효과 편집기',
        resizable: true,
      },
      actions: {
        addStatus: EffectWorkbench._addStatus,
        pickEffectImage: EffectWorkbench._pickImage,
      },
    };

    static PARTS = {
      main: {
        template:
          'modules/nihil-compendium-module/templates/workbench/effect-workbench.hbs',
      },
    };

    values() {
      const values = super.values();
      const controls = this.element?.querySelector?.('[data-effect-statuses]');
      if (controls) {
        values.statuses = JSON.stringify(
          Array.from(controls.querySelectorAll('[data-status-id]'))
            .filter((control) => control.checked)
            .map((control) => control.dataset.statusId),
        );
      }
      return values;
    }

    async _prepareContext() {
      const context = await super._prepareContext();
      const statuses = this.fields.find((field) => field.path === 'statuses');
      return {
        ...context,
        groups: effectGroups(this.fields),
        statusOptions: effectStatusOptions(
          JSON.parse(statuses.value),
          globalThis.CONFIG?.statusEffects ?? [],
        ),
        parentName: this.config.parentName,
        effectType: this.config.effectType,
      };
    }

    static async _addStatus(event) {
      event.preventDefault();
      if (!this.config.canEdit()) return;
      const input = this.element.querySelector('[data-new-status]');
      const id = input.value.trim();
      if (!id) return;
      this.capture();
      const field = this.fields.find((entry) => entry.path === 'statuses');
      const selected = JSON.parse(field.value);
      if (!selected.includes(id)) selected.push(id);
      field.value = JSON.stringify(selected);
      await this.render({
        force: true,
      });
    }

    static async _pickImage(event) {
      event.preventDefault();
      if (!this.config.canEdit()) return;
      const Picker =
        globalThis.CONFIG?.ux?.FilePicker ??
        globalThis.foundry?.applications?.apps?.FilePicker;
      if (!Picker) return;
      new Picker({
        type: 'image',
        current: this.element.querySelector('[data-document-path="img"]').value,
        callback: (path) => {
          const input = this.element.querySelector(
            '[data-document-path="img"]',
          );
          if (input && this.config.canEdit()) input.value = path;
        },
      }).render(true);
    }
  }
  EffectEditorClass = EffectWorkbench;
  return EffectEditorClass;
}

export function editEffect(
  effect,
  options = {},
) {
  const source = effect.toObject();
  const callerCanEdit = options.canEdit ?? (() => true);
  const Class = getEffectEditorClass();
  const app = new Class({
    title: `${effect.name ?? '효과'} · 효과 편집`,
    parentName: effect.parent?.name ?? '연결 대상 없음',
    effectType:
      source.type === 'enchantment' ? '아이템 마법 부여' : '일반 효과',
    help: '변경값, 지속시간과 상태를 편집합니다. 빈 지속시간은 제한 없음이며 시작 시간은 자동으로 바꾸지 않습니다.',
    submitLabel: '효과 저장',
    discardMessage: '<p>저장하지 않은 효과 입력을 버리시겠습니까?</p>',
    fields: effectFields(
      source,
      {
        dae: Boolean(globalThis.game?.modules?.get?.('dae')?.active),
        itemEffect: effect.parent?.documentName === 'Item',
        combats: Array.from(globalThis.game?.combats?.values?.() ?? []),
      },
    ),
    read: () => effect.toObject(),
    save: async (patch) => {
      const source = effect.toObject();
      const updated = await effect.update(migrateLegacyShowIcon(effectStartPatch(patch, source), source));
      if (!updated) throw new Error('효과 저장이 취소되었습니다. 입력을 보존했습니다.');
      return updated;
    },
    validate: validateEffectPatch,
    ...options,
    canEdit: () => canEditWorkbenchEffect(effect, callerCanEdit),
  });
  app.render({
    force: true,
  });
  return app;
}
