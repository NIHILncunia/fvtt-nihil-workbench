import { openDocumentWorkbench } from './document-workbench-app.mjs';
import { prepareActorItemCopy } from './item-copy-adapter.mjs';
import { createPackDocument, packEditAllowed, requireModulePack } from './compendium-adapter.mjs';

export function createFolderInWorkbench({ type, parent = null, pack = null, afterCreate }) {
  const source = { name: '새 폴더', color: '#665d49', sorting: 'a' };
  return openDocumentWorkbench({
    title: `${type === 'Actor' ? '액터' : '아이템'} 폴더 생성`,
    alwaysSave: true,
    submitLabel: '폴더 생성',
    help: '현재 탐색 중인 폴더 아래에 생성합니다.',
    read: () => source,
    roots: ['name', 'color', 'sorting'],
    schema: { sorting: { choices: { a: '이름순', m: '수동 정렬' } } },
    canEdit: () => globalThis.game?.user?.isGM !== false && (!pack || packEditAllowed(
      pack,
      type,
    )),
    save: async (patch) => {
      if (pack) requireModulePack(
        pack,
        type,
        { write: true },
      );
      const created = await globalThis.Folder.create(
        {
          ...source,
          ...patch,
          type,
          folder: parent,
        },
        { pack },
      );
      if (!created) throw new Error('폴더 생성이 취소되었습니다.');
      await afterCreate?.(created);
    },
  });
}

export function itemTypeChoices() {
  const declared = globalThis.game?.system?.documentTypes?.Item ?? {};
  const types = [
    ...new Set([
      ...(Array.isArray(declared) ? declared : Object.keys(declared)),
      ...Object.keys(globalThis.CONFIG?.Item?.dataModels ?? {}),
      ...Object.keys(globalThis.CONFIG?.DND5E?.itemTypes ?? {}),
    ]),
  ];
  const labels = {
    base: '기본',
    weapon: '무기',
    equipment: '장비',
    consumable: '소모품',
    tool: '도구',
    loot: '전리품',
    race: '종족',
    background: '배경',
    class: '클래스',
    subclass: '서브클래스',
    spell: '주문',
    feat: '피트',
    container: '보관용품',
    backpack: '배낭',
    facility: '시설',
  };
  return Object.fromEntries(
    types.map((type) => [
      type,
      labels[type] ??
        globalThis.game?.i18n?.localize?.(
          globalThis.CONFIG?.Item?.typeLabels?.[type] ?? type,
        ) ??
        type,
    ]),
  );
}

export async function copyItemToActor(
  actor,
  item
) {
  if (actor.isOwner === false) throw new Error('액터 수정 권한이 없습니다.');
  if (item?.documentName !== 'Item') throw new Error('아이템을 선택하십시오.');
  const source = await prepareActorItemCopy(
    actor,
    item
  );
  if (actor.isOwner === false) throw new Error('액터 수정 권한이 없습니다.');
  const [created] = await actor.createEmbeddedDocuments(
    'Item',
    [source],
    { keepId: true, keepEmbeddedIds: true }
  );
  if (!created) throw new Error('아이템이 추가되지 않았습니다. 액터의 유형·중복 제한과 시스템 알림을 확인하십시오.');
  return created;
}

export function createItemInWorkbench({ actor = null, folder = null, pack = null, afterCreate }) {
  const choices = itemTypeChoices();
  const source = {
    name: '새 아이템',
    itemType: 'feat' in choices ? 'feat' : Object.keys(choices)[0],
  };
  return openDocumentWorkbench({
    title: actor ? `${actor.name} · 소유 아이템 생성` : pack ? '컴펜디움 아이템 등록' : '월드 아이템 생성',
    alwaysSave: true,
    submitLabel: '아이템 생성',
    help: '유형을 선택해 생성하면 아이템 워크벤치에서 바로 편집합니다.',
    read: () => source,
    schema: { itemType: { choices } },
    roots: ['name', 'itemType'],
    canEdit: () => actor?.isOwner !== false && (!(pack ?? actor?.pack) || packEditAllowed(
      pack ?? actor.pack,
      actor ? 'Actor' : 'Item',
    )),
    save: async (patch) => {
      const values = { ...source, ...patch };
      if (!(values.itemType in choices))
        throw new Error('설치된 시스템의 아이템 유형을 선택하십시오.');
      const data = { name: values.name, type: values.itemType };
      const created = actor
        ? (await actor.createEmbeddedDocuments(
          'Item',
          [data]
        ))[0]
        : pack ? await createPackDocument(
          pack,
          'Item',
          { ...data, folder },
        ) : await globalThis.Item.create({ ...data, folder });
      if (!created) throw new Error('아이템이 생성되지 않았습니다.');
      await afterCreate(created);
    },
  });
}

let LibraryClass;
export function openItemLibrary({ actor, type = '', beforeCopy, afterCopy }) {
  if (!LibraryClass) {
    const { ApplicationV2, HandlebarsApplicationMixin } =
      globalThis.foundry.applications.api;
    LibraryClass = class ItemLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
      static DEFAULT_OPTIONS = {
        classes: ['ncm-workbench', 'ncm-item-library'],
        tag: 'form',
        window: { title: 'Nihil Workbench · 아이템 라이브러리', resizable: true },
        position: { width: 760, height: 730 },
        actions: { search: this._search, copy: this._copy, page: this._page },
        form: { handler: this._search, closeOnSubmit: false, submitOnChange: false },
      };
      static PARTS = {
        main: {
          template:
            'modules/nihil-compendium-module/templates/workbench/item-library.hbs',
        },
      };
      sourceId = '';
      query = '';
      type = '';
      busy = false;
      page = 0;

      async _prepareContext() {
        const packs = Array.from(
          globalThis.game.packs?.contents ?? globalThis.game.packs?.values?.() ?? [],
        ).filter((pack) => pack.documentName === 'Item' && pack.visible !== false);
        const pack = packs.find((entry) => entry.collection === this.sourceId);
        const documents = pack
          ? await pack.getIndex({ fields: ['type', 'img'] })
          : globalThis.game.items;
        const matches = Array.from(
          documents?.contents ?? documents?.values?.() ?? documents ?? [],
        )
          .filter(
            (item) =>
              (!this.type || item.type === this.type) &&
              String(item.name)
                .toLocaleLowerCase()
                .includes(this.query.toLocaleLowerCase()),
          )
          .map((item) => ({
            id: item.id ?? item._id,
            name: item.name,
            img: item.img,
            type: item.type,
          }))
          .sort((
            left,
            right
          ) =>
            String(left.name).localeCompare(
              String(right.name),
              'ko'
            ),
          );
        const pages = Math.max(
          1,
          Math.ceil(matches.length / 100)
        );
        this.page = Math.min(
          this.page,
          pages - 1
        );
        return {
          actorName: this.actor.name,
          rows: matches.slice(
            this.page * 100,
            (this.page + 1) * 100
          ),
          count: matches.length,
          page: this.page + 1,
          pages,
          canPrevious: this.page > 0,
          canNext: this.page + 1 < pages,
          query: this.query,
          busy: this.busy,
          sources: [
            { value: '', label: '월드 아이템', selected: !this.sourceId },
            ...packs.map((entry) => ({
              value: entry.collection,
              label: entry.title,
              selected: entry.collection === this.sourceId,
            })),
          ],
          types: Object.entries(itemTypeChoices()).map(([value, label]) => ({
            value,
            label,
            selected: value === this.type,
          })),
        };
      }

      static async _search(event) {
        event.preventDefault();
        this.sourceId = this.element.querySelector('[name=librarySource]').value;
        this.query = this.element.querySelector('[name=libraryQuery]').value;
        this.type = this.element.querySelector('[name=libraryType]').value;
        this.page = 0;
        await this.render({ force: true });
      }

      static async _page(
        event,
        target
      ) {
        event.preventDefault();
        this.page = Math.max(
          0,
          this.page + Number(target.dataset.direction)
        );
        await this.render({ force: true });
      }

      static async _copy(
        event,
        target
      ) {
        event.preventDefault();
        if (this.busy || this.actor.isOwner === false) return;
        this.busy = true;
        target.disabled = true;
        try {
          if (this.beforeCopy && !(await this.beforeCopy())) return;
          const item = this.sourceId
            ? await globalThis.game.packs
                .get(this.sourceId)
                ?.getDocument(target.dataset.itemId)
            : globalThis.game.items.get(target.dataset.itemId);
          const created = await copyItemToActor(
            this.actor,
            item
          );
          await this.afterCopy(created);
          globalThis.ui?.notifications?.info?.(
            `${this.actor.name}에 ${created.name}을 추가했습니다.`,
          );
        } catch (error) {
          globalThis.ui?.notifications?.error?.(error.message);
        } finally {
          this.busy = false;
          target.disabled = false;
        }
      }
    };
  }
  const app = new LibraryClass();
  app.actor = actor;
  app.type = type in itemTypeChoices() ? type : '';
  app.beforeCopy = beforeCopy;
  app.afterCopy = afterCopy;
  app.render({ force: true });
  return app;
}
