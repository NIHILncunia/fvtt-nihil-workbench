import { isWorkbenchUser } from '../shared/workbench-access.mjs';
import {
  createPackDocument,
  modulePackChoices,
  packEditAllowed,
  requireModulePack,
} from './compendium-adapter.mjs';
import {
  openPackActorWorkbench,
  refreshPackActorWorkbenches,
} from './actor-workbench-app.mjs';
import {
  openPackItemWorkbench,
  refreshPackItemWorkbenches,
} from './workbench-app.mjs';
import { itemTypeChoices } from './item-library.mjs';
import { lockWorkbenchControls } from './save-state.mjs';

let WorkbenchClass;
let workbench;
const AUTHORS = new Set(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);

export function compendiumCreationTypes(documentName) {
  return documentName === 'Actor'
    ? { character: 'PC', npc: 'NPC' }
    : itemTypeChoices();
}

export function getCompendiumWorkbenchClass() {
  if (WorkbenchClass) return WorkbenchClass;
  const { ApplicationV2, HandlebarsApplicationMixin } =
    globalThis.foundry.applications.api;
  WorkbenchClass = class CompendiumWorkbench extends (
    HandlebarsApplicationMixin(ApplicationV2)
  ) {
    static DEFAULT_OPTIONS = {
      id: 'ncm-compendium-workbench',
      classes: ['ncm-workbench', 'ncm-compendium-workbench'],
      tag: 'form',
      window: { title: 'Nihil Workbench · 컴펜디움 제작', resizable: true },
      position: { width: 720, height: 700 },
      actions: {
        choose: this._choose,
        refresh: this._refresh,
        toggleLock: this._toggleLock,
        create: this._create,
        edit: this._edit,
        page: this._page,
      },
      form: {
        handler: this._choose,
        closeOnSubmit: false,
        submitOnChange: false,
      },
    };
    static PARTS = {
      main: {
        template:
          'modules/nihil-compendium-module/templates/workbench/compendium-workbench.hbs',
      },
    };
    packId = '';
    concept = '';
    query = '';
    page = 0;
    busy = false;
    drafts = new Map();
    error = '';

    captureDraft() {
      if (this.busy || !this.packId || !this.element?.querySelector) return;
      const name = this.element.querySelector('[name=packEntryName]');
      if (!name) return;
      this.drafts.set(
        this.packId,
        {
          name: name.value,
          type: this.element.querySelector('[name=packEntryType]')?.value,
          img: this.element.querySelector('[name=packEntryImg]')?.value ?? '',
        },
      );
    }

    async render(options = {}) {
      if (this.busy) return this;
      this.captureDraft();
      return super.render(options);
    }

    async close(options = {}) {
      if (this.busy) return this;
      this.captureDraft();
      if (
        Array.from(this.drafts.values()).some(
          (draft) => draft.name.trim() || draft.img.trim(),
        ) &&
        !(await globalThis.foundry.applications.api.DialogV2.confirm({
          window: { title: '컴펜디움 등록 입력' },
          content: '<p>아직 등록하지 않은 입력을 버리고 닫으시겠습니까?</p>',
        }))
      )
        return this;
      return super.close(options);
    }

    async _prepareContext() {
      const choices = modulePackChoices();
      const concepts = [...new Set(choices.map((choice) => choice.concept))];
      if (!concepts.includes(this.concept)) this.concept = concepts[0] ?? '';
      const packs = choices.filter((choice) => choice.concept === this.concept);
      if (!packs.some((choice) => choice.id === this.packId))
        this.packId = packs[0]?.id ?? '';
      const choice = packs.find((entry) => entry.id === this.packId);
      const pack = choice
        ? requireModulePack(
          choice.id,
          choice.documentName,
        )
        : null;
      const index = pack
        ? await pack.getIndex({ fields: ['type', 'img'] })
        : new Map();
      const matches = Array.from(index.values())
        .filter((entry) =>
          String(entry.name)
            .toLocaleLowerCase()
            .includes(this.query.toLocaleLowerCase()),
        )
        .sort((
          left,
          right,
        ) =>
          String(left.name).localeCompare(
            String(right.name),
            'ko',
          ),
        );
      const pages = Math.max(
        1,
        Math.ceil(matches.length / 100),
      );
      this.page = Math.min(
        this.page,
        pages - 1,
      );
      const types = pack ? compendiumCreationTypes(pack.documentName) : {};
      const draft = this.drafts.get(this.packId) ?? {
        name: '',
        img: '',
        type: Object.keys(types)[0],
      };
      return {
        concepts: concepts.map((value) => ({
          value,
          selected: value === this.concept,
        })),
        packs: packs.map((entry) => ({
          ...entry,
          selected: entry.id === this.packId,
        })),
        pack: choice,
        query: this.query,
        entries: matches
          .slice(
            this.page * 100,
            (this.page + 1) * 100,
          )
          .map((entry) => ({
            id: entry._id ?? entry.id,
            name: entry.name,
            img: entry.img,
            type: types[entry.type] ?? entry.type,
          })),
        types: Object.entries(types).map(([value, label]) => ({
          value,
          label,
          selected: value === draft.type,
        })),
        draft,
        canWrite: Boolean(
          pack && packEditAllowed(
            pack.collection,
            pack.documentName,
          ),
        ),
        canToggleLock: Boolean(pack && globalThis.game.user.isGM),
        error: this.error,
        total: matches.length,
        pageLabel: `${this.page + 1} / ${pages}`,
        hasPrevious: this.page > 0,
        hasNext: this.page < pages - 1,
      };
    }

    _onRender(
      context,
      options,
    ) {
      super._onRender(
        context,
        options,
      );
      for (const control of this.element.querySelectorAll(
        '[name=packConcept], [name=packTarget]',
      )) {
        control.addEventListener(
          'change',
          (event) =>
            this.constructor._choose.call(
              this,
              event,
            ),
        );
      }
    }

    static async _choose(event) {
      event.preventDefault();
      if (this.busy) return;
      this.captureDraft();
      this.concept =
        this.element.querySelector('[name=packConcept]')?.value ?? '';
      this.packId =
        this.element.querySelector('[name=packTarget]')?.value ?? '';
      this.query = this.element.querySelector('[name=packSearch]')?.value ?? '';
      this.page = 0;
      this.error = '';
      // The DOM still belongs to the prior pack; do not recapture it under the new ID.
      this.busy = true;
      const unlock = lockWorkbenchControls(this);
      try {
        await super.prototype.render.call(
          this,
          { force: true },
        );
      } catch (error) {
        this.error = error.message;
        globalThis.ui?.notifications?.error?.(error.message);
      } finally {
        unlock();
        this.busy = false;
      }
    }

    static async _refresh(event) {
      event.preventDefault();
      await this.render({ force: true });
      refreshPackActorWorkbenches();
      refreshPackItemWorkbenches();
    }

    static async _toggleLock(event) {
      event.preventDefault();
      if (this.busy || !globalThis.game.user.isGM) return;
      const choice = modulePackChoices().find(
        (entry) => entry.id === this.packId,
      );
      if (!choice) return;
      this.captureDraft();
      const pack = requireModulePack(
        this.packId,
        choice.documentName,
      );
      this.busy = true;
      const unlock = lockWorkbenchControls(this);
      try {
        await pack.configure({ locked: !pack.locked });
      } catch (error) {
        this.error = error.message;
      } finally {
        unlock();
        this.busy = false;
      }
      await this.render({ force: true });
      refreshPackActorWorkbenches();
      refreshPackItemWorkbenches();
    }

    async editEntry(id) {
      const choice = modulePackChoices().find(
        (entry) => entry.id === this.packId,
      );
      if (!choice) throw new Error('컴펜디움을 다시 선택하십시오.');
      const pack = requireModulePack(
        this.packId,
        choice.documentName,
      );
      if (!(await pack.getDocument(id)))
        throw new Error('항목이 삭제되었습니다. 목록을 다시 확인하십시오.');
      return choice.documentName === 'Actor'
        ? openPackActorWorkbench(
          this.packId,
          id,
        )
        : openPackItemWorkbench(
          this.packId,
          id,
        );
    }

    static async _edit(
      event,
      target,
    ) {
      event.preventDefault();
      if (this.busy) return;
      try {
        await this.editEntry(target.dataset.entryId);
      } catch (error) {
        this.error = error.message;
        await this.render({ force: true });
      }
    }

    static async _create(event) {
      event.preventDefault();
      if (this.busy) return;
      this.captureDraft();
      const packId = this.packId;
      const choice = modulePackChoices().find((entry) => entry.id === packId);
      if (!choice) return;
      const draft = this.drafts.get(packId);
      this.busy = true;
      const unlock = lockWorkbenchControls(this);
      let created;
      try {
        if (
          !draft ||
          !(draft.type in compendiumCreationTypes(choice.documentName))
        )
          throw new Error('등록할 문서 유형을 선택하십시오.');
        created = await createPackDocument(
          packId,
          choice.documentName,
          {
            ...draft,
            folder: null,
          },
        );
        this.drafts.delete(packId);
        this.error = '';
      } catch (error) {
        this.error = error.message;
      } finally {
        unlock();
        this.busy = false;
      }
      // A successful registration clears only that pack's creation inputs.
      if (created) await super.prototype.render.call(
        this,
        { force: true },
      );
      else await this.render({ force: true });
      if (created) {
        globalThis.ui?.notifications?.info?.(
          `${created.name} · ${choice.name}에 등록했습니다.`,
        );
        try {
          await this.editEntry(created.id);
        } catch (error) {
          this.error = `등록은 완료했습니다. 목록에서 편집을 다시 여십시오. ${error.message}`;
          await this.render({ force: true });
        }
      }
    }

    static async _page(
      event,
      target,
    ) {
      event.preventDefault();
      if (this.busy) return;
      this.page = Math.max(
        0,
        this.page + Number(target.dataset.direction),
      );
      await this.render({ force: true });
    }
  };
  return WorkbenchClass;
}

export function openCompendiumWorkbench() {
  if (!AUTHORS.has(globalThis.game?.user?.id) && !isWorkbenchUser()) return null;
  const Class = getCompendiumWorkbenchClass();
  if (!workbench || workbench.state === Class.RENDER_STATES?.CLOSED)
    workbench = new Class();
  Promise.resolve(workbench.render({ force: true })).then(() => {
    if (workbench.rendered) workbench.bringToFront?.();
  });
  return workbench;
}

export function refreshCompendiumWorkbench() {
  if (workbench?.rendered) workbench.render({ force: true });
  refreshPackActorWorkbenches();
  refreshPackItemWorkbenches();
}
