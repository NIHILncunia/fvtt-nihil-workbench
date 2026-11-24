import {
  buildDocumentPatch,
  editableDocumentRoots,
  readDocumentFields,
} from './document-fields.mjs';
import { requirePackDocument, rootDocument } from './compendium-adapter.mjs';
import {
  changeTypeOf,
  effectChangeTypeOptions,
  isEffectChangesPath,
  isValidChangeType,
} from '../shared/effect-change-types.mjs';

let EditorClass;

// v14 변경값의 value는 AnyField라 객체(예: AC 공식 { formula, label })가 올 수 있다.
export function changeValueText(value) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function parseChangeValue(text, original) {
  if (original && typeof original === 'object') {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('객체 형식의 변경값은 JSON으로 입력하십시오.');
    }
  }
  return text;
}

export function getDocumentWorkbenchClass() {
  if (EditorClass) return EditorClass;
  const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
    globalThis.foundry.applications.api;
  class DocumentWorkbench extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: ['ncm-workbench', 'ncm-document-workbench'],
      tag: 'form',
      window: { title: 'Nihil Workbench · 전체 설정', resizable: true },
      position: { width: 900, height: 760 },
      actions: {
        addChange: DocumentWorkbench._addChange,
        removeChange: DocumentWorkbench._removeChange,
        clearColor: DocumentWorkbench._clearColor,
      },
      form: { closeOnSubmit: false, handler: DocumentWorkbench._save },
    };
    static PARTS = {
      main: {
        template:
          'modules/nihil-compendium-module/templates/workbench/document-workbench.hbs',
      },
    };

    constructor(config) {
      super(config.applicationOptions ?? {});
      this.config = config;
      this.fields = config.fields ?? readDocumentFields(
        config.read(),
        config.schema,
        config.roots
      );
      for (const field of this.fields) {
        field.effectChanges = isEffectChangesPath(field.path);
        field.colorPicker = config.colorPaths?.includes(field.path) === true;
        if (config.folderForm && field.path === 'sorting')
          for (const option of field.options)
            option.label = { a: '이름순', m: '수동 정렬' }[option.value] ?? option.label;
      }
      this.saved = false;
      this.saving = false;
    }

    values() {
      const values = Object.fromEntries(
        Array.from(this.element?.querySelectorAll?.('[data-document-path]') ?? []).map(
          (control) => [
            control.dataset.documentPath,
            control.type === 'checkbox' ? control.checked : control.value,
          ],
        ),
      );
      if (this.element?.querySelector?.('[data-effect-changes]')) {
        const changesField = this.fields.find((field) => field.effectChanges);
        const originals = JSON.parse(changesField.value);
        const changes = Array.from(
          this.element.querySelectorAll('[data-effect-change]'),
        ).map((
          row,
          index,
        ) => {
          const original = originals[index] ?? {};
          const inputValue = row.querySelector('[data-change-value]').value;
          const { mode, ...rest } = original;
          const value = {
            ...rest,
            key: row.querySelector('[data-change-key]').value,
            type: row.querySelector('[data-change-type]').value,
            value: inputValue === changeValueText(original.value)
              ? original.value ?? '' : parseChangeValue(inputValue, original.value),
          };
          const priority = row.querySelector('[data-change-priority]').value;
          if (priority !== '') value.priority = Number(priority);
          else if (Object.hasOwn(
            original,
            'priority',
          )) value.priority = null;
          return value;
        });
        values[changesField.path] = JSON.stringify(
          changes,
          null,
          2
        );
      }
      return values;
    }

    async _prepareContext() {
      const changes = this.fields.find((field) => field.effectChanges);
      return {
        title: this.config.title,
        help: this.config.help,
        fields: this.fields,
        canEdit: this.config.canEdit(),
        submitLabel: this.config.submitLabel ?? '전체 설정 저장',
        changeRows: changes
          ? JSON.parse(changes.value).map((
            row,
            index
          ) => ({
              ...row,
              index,
              value: changeValueText(row.value),
              type: changeTypeOf(row),
              types: effectChangeTypeOptions(changeTypeOf(row)),
            }))
          : [],
      };
    }

    async _onRender(
      context,
      options,
    ) {
      await super._onRender?.(
        context,
        options,
      );
      if (!this.config.folderForm || this.folderEscapeElement === this.element) return;
      this.folderEscapeElement = this.element;
      this.element.addEventListener(
        'keydown',
        (event) => this._onFolderEscape(event),
      );
    }

    _onFolderEscape(event) {
      if (!this.config.folderForm || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      void this.close();
    }

    capture() {
      for (const [path, value] of Object.entries(this.values())) {
        const field = this.fields.find((entry) => entry.path === path);
        if (!field) continue;
        field.value = value;
        for (const option of field.options)
          option.selected = String(option.value) === String(value);
      }
    }

    static _clearColor(
      event,
      target,
    ) {
      event.preventDefault();
      if (!this.config.canEdit()) return;
      const picker = target.closest('[data-folder-color]')?.querySelector('color-picker');
      if (picker) picker.value = '';
    }

    static async _addChange(event) {
      event.preventDefault();
      if (!this.config.canEdit()) return;
      this.capture();
      const field = this.fields.find((entry) => entry.effectChanges);
      const changes = JSON.parse(field.value);
      changes.push({ key: '', type: 'add', value: '', phase: 'initial', priority: null });
      field.value = JSON.stringify(
        changes,
        null,
        2
      );
      await this.render({ force: true });
    }

    static async _removeChange(
      event,
      target
    ) {
      event.preventDefault();
      if (!this.config.canEdit()) return;
      this.capture();
      const field = this.fields.find((entry) => entry.effectChanges);
      const changes = JSON.parse(field.value);
      changes.splice(
        Number(target.dataset.changeIndex),
        1
      );
      field.value = JSON.stringify(
        changes,
        null,
        2
      );
      await this.render({ force: true });
    }

    static async _save(event) {
      event.preventDefault();
      if (this.saving) return;
      if (!this.config.canEdit())
        return globalThis.ui?.notifications?.warn?.('현재 대상의 수정 권한이 없습니다.');
      this.saving = true;
      try {
        const { patch, conflicts } = buildDocumentPatch(
          this.fields,
          this.values(),
          this.config.read(),
        );
        const changesPath = this.fields.find((field) => field.effectChanges)?.path;
        if (
          changesPath &&
          patch[changesPath]?.some(
            (change) =>
              !change.key?.trim() ||
              !isValidChangeType(change.type) ||
              (change.priority != null && !Number.isFinite(change.priority)),
          )
        )
          throw new Error('효과의 변경 경로·적용 방식·우선순위를 확인하십시오.');
        if (conflicts.length)
          throw new Error(
            `다른 곳에서 변경된 필드가 있습니다. 입력을 보존했습니다. 창을 다시 열어 최신 값을 확인하십시오: ${conflicts.join(', ')}`,
          );
        this.config.validate?.(patch);
        if (this.config.alwaysSave || Object.keys(patch).length)
          this.result = await this.config.save(patch);
        this.saved = true;
        await this.close();
        await this.config.afterSave?.();
        globalThis.ui?.notifications?.info?.('워크벤치 설정을 저장했습니다.');
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      } finally {
        this.saving = false;
      }
    }

    async close(options = {}) {
      // 생성 요청 중 코어 호출자에게 취소를 먼저 반환하지 않는다.
      if (this.saving && !this.saved) return this;
      let dirty = false;
      try {
        dirty =
          Object.keys(
            buildDocumentPatch(
              this.fields,
              this.values(),
              this.config.read()
            ).patch,
          ).length > 0;
      } catch {
        dirty = true;
      }
      if (
        !this.saved &&
        !options.force &&
        dirty &&
        !(await DialogV2.confirm({
          window: { title: '입력 버리기' },
          content: this.config.discardMessage ?? '<p>저장하지 않은 전체 설정 입력을 버리시겠습니까?</p>',
        }))
      )
        return this;
      const result = await super.close(options);
      if (!this.closeNotified) {
        this.closeNotified = true;
        this.config.onClose?.(this.saved ? this.result : null);
      }
      return result;
    }
  }
  EditorClass = DocumentWorkbench;
  return EditorClass;
}

export function openDocumentWorkbench(config) {
  const Class = getDocumentWorkbenchClass();
  const app = new Class(config);
  try {
    app.renderPromise = Promise.resolve(app.render({ force: true }));
  } catch (error) {
    app.renderPromise = Promise.reject(error);
  }
  app.renderPromise.catch((error) => globalThis.ui?.notifications?.error?.(error.message));
  return app;
}

export function editDocument(
  document,
  options = {}
) {
  return openDocumentWorkbench({
    title: `${document.name ?? document.label ?? '문서'} · 전체 설정`,
    help: '추가 필드와 모듈 설정까지 수정합니다. 목록과 복합값은 JSON으로 입력합니다. 저장은 변경한 필드에만 적용됩니다.',
    read: () => document.toObject(),
    schema: {
      fields: {
        ...document.schema?.fields,
        ...(document.system?.schema ? { system: document.system.schema } : {}),
      },
    },
    roots: editableDocumentRoots(document),
    ...(document.documentName === 'Folder' ? {
      folderForm: true,
      colorPaths: ['color'],
      applicationOptions: {
        classes: ['ncm-folder-workbench'],
        position: { width: 640, height: 'auto' },
        window: { title: 'Nihil Workbench · 폴더 편집' },
      },
    } : {}),
    canEdit: () =>
      document.isOwner !== false &&
      document.parent?.isOwner !== false &&
      document.item?.isOwner !== false,
    save: (patch) => {
      if (rootDocument(document)?.pack) requirePackDocument(document.parent ?? document);
      return document.update(patch);
    },
    ...options,
  });
}

export function editToken(
  actor,
  afterSave
) {
  const source = actor.toObject().prototypeToken;
  return openDocumentWorkbench({
    title: `${actor.name} · 전체 토큰 설정`,
    help: '기본 토큰의 시야, 조명, 감지 모드와 모듈 설정을 편집합니다. 앞으로 배치할 토큰에 적용됩니다.',
    read: () => actor.toObject().prototypeToken,
    schema: actor.prototypeToken?.schema,
    roots: [
      ...new Set([
        ...Object.keys(source),
        ...Object.keys(actor.prototypeToken?.schema?.fields ?? {}),
      ]),
    ].filter((key) => !['_id', 'actorId', 'actorData', 'delta', 'x', 'y'].includes(key)),
    canEdit: () => actor.isOwner !== false,
    save: (patch) => {
      if (actor.pack) requirePackDocument(actor);
      return actor.update(
        Object.fromEntries(
          Object.entries(patch).map(([path, value]) => [`prototypeToken.${path}`, value]),
        ),
      );
    },
    afterSave,
  });
}
