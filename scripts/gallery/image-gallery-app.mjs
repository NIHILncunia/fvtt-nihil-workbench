import {
  ArchiveImageError,
  MODULE_ID,
  entryGroups,
  galleryKind,
  filterIconEntries,
  iconCategoryTree,
  iconTags,
  loadGalleryEntries,
  loadIconCategories,
  readImageToken,
  sameImagePath,
  saveImageToken,
} from './archive-images.mjs';

// 칸 종류마다 썸네일 비율을 다르게 둔다: 초상화는 세로, 토큰은 정사각, 맵은 가로.
const SHAPES = Object.freeze({ portrait: 'portrait', token: 'token', map: 'map', item: 'item' });

let GalleryClass;

function sizeText(entry) {
  return entry.width && entry.height ? `${entry.width}×${entry.height}` : '';
}

export function getImageGalleryClass() {
  if (GalleryClass) return GalleryClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;
  class NihilImageGallery extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: ['ncm-workbench', 'ncm-gallery-app'],
      window: { title: 'Nihil Workbench · 이미지 갤러리', resizable: true, icon: 'fa-solid fa-images' },
      position: { width: 980, height: 720 },
      actions: {
        choose: NihilImageGallery._choose,
        switchSource: NihilImageGallery._switchSource,
        refresh: NihilImageGallery._refresh,
        saveToken: NihilImageGallery._saveToken,
        pickLocal: NihilImageGallery._pickLocal,
        switchGallery: NihilImageGallery._switchGallery,
      },
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/gallery/image-gallery.hbs` },
    };

    constructor({ kind, current = '', targetLabel = '', onSelect, onPickLocal = null } = {}) {
      super();
      this.kind = kind;
      this.config = galleryKind(kind);
      this.current = String(current ?? '');
      this.targetLabel = targetLabel;
      this.onSelect = onSelect;
      this.onPickLocal = onPickLocal;
      this.source = this.config.sources[0].id;
      this.entries = null;
      this.error = null;
      this.loading = false;
      this.search = '';
      this.group = '';
    }

    get title() {
      return `Nihil Workbench · 이미지 갤러리 — ${this.config.title}`;
    }

    async load(force = false) {
      this.loading = true;
      this.error = null;
      try {
        this.entries = await loadGalleryEntries(this.kind, { force });
        // 지금 쓰는 그림이 다른 갈래에 있으면 그 갈래를 먼저 연다.
        const current = this.entries.find((entry) => entry.url === this.current);
        if (current && !this.sourceChosen) this.source = current.source;
      } catch (error) {
        this.entries = null;
        this.error = error instanceof ArchiveImageError ? error : new ArchiveImageError('UNKNOWN', error?.message ?? String(error));
      } finally {
        this.loading = false;
      }
    }

    async _prepareContext() {
      if (this.entries === null && !this.error && !this.loading) await this.load();
      const sourceEntries = (this.entries ?? []).filter((entry) => (entry.gallerySource ?? entry.source) === this.source);
      const groups = entryGroups(sourceEntries);
      if (this.group && !groups.some((group) => group.value === this.group)) this.group = '';
      return {
        title: this.config.title,
        canOpenIcons: this.kind === 'item',
        targetLabel: this.targetLabel,
        shape: SHAPES[this.kind] ?? 'portrait',
        hasTabs: this.config.sources.length > 1,
        sources: this.config.sources.map((source) => ({
          ...source,
          selected: source.id === this.source,
          count: (this.entries ?? []).filter((entry) => entry.source === source.id).length,
        })),
        needsToken: this.error?.code === 'TOKEN' || this.error?.code === 'AUTH',
        error: this.error && !['TOKEN'].includes(this.error.code) ? this.error.message : null,
        tokenSaved: Boolean(readImageToken()),
        loading: this.loading,
        search: this.search,
        groups: groups.map((group) => ({ ...group, selected: group.value === this.group })),
        total: sourceEntries.length,
        entries: sourceEntries.map((entry) => ({
          ...entry,
          size: sizeText(entry),
          current: entry.url === this.current,
        })),
        canPickLocal: Boolean(this.onPickLocal),
      };
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const root = this.element;
      const search = root.querySelector('[data-gallery-search]');
      const group = root.querySelector('[data-gallery-group]');
      search?.addEventListener('input', () => {
        this.search = search.value;
        this.applyFilter();
      });
      group?.addEventListener('change', () => {
        this.group = group.value;
        this.applyFilter();
      });
      root.querySelector('[data-gallery-token]')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          NihilImageGallery._saveToken.call(this, event);
        }
      });
      this.applyFilter();
      root.querySelector('.ncm-gallery__card.is-current')?.scrollIntoView?.({ block: 'center' });
    }

    // 검색·분류는 다시 그리지 않고 카드 표시만 바꾼다(입력 포커스 유지).
    applyFilter() {
      const words = this.search.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const card of this.element?.querySelectorAll?.('.ncm-gallery__card') ?? []) {
        const visible = (!this.group || card.dataset.group === this.group)
          && words.every((word) => card.dataset.search.includes(word));
        card.hidden = !visible;
        if (visible) shown += 1;
      }
      const count = this.element?.querySelector?.('[data-gallery-count]');
      if (count) count.textContent = String(shown);
      const empty = this.element?.querySelector?.('[data-gallery-empty]');
      if (empty) empty.hidden = shown > 0;
    }

    static async _choose(event, target) {
      event.preventDefault();
      const entry = this.entries?.find((item) => item.id === target.dataset.entryId);
      if (!entry) return;
      this.selected = true;
      await this.onSelect?.(entry.url, entry);
      await this.close();
    }

    static async _switchSource(event, target) {
      event.preventDefault();
      this.source = target.dataset.source;
      this.sourceChosen = true;
      this.group = '';
      await this.render({ force: true });
    }

    static async _refresh(event) {
      event.preventDefault();
      await this.load(true);
      await this.render({ force: true });
    }

    static async _saveToken(event) {
      event.preventDefault();
      const input = this.element.querySelector('[data-gallery-token]');
      const token = input?.value?.trim();
      if (!token) return globalThis.ui?.notifications?.warn?.('기록보관소 이미지 토큰을 입력하십시오.');
      await saveImageToken(token);
      await this.load(true);
      await this.render({ force: true });
    }

    static async _pickLocal(event) {
      event.preventDefault();
      if (!this.onPickLocal) return;
      await this.close();
      await this.onPickLocal();
    }

    static async _switchGallery(event) {
      event.preventDefault();
      const options = {
        current: this.current,
        targetLabel: this.targetLabel,
        onSelect: this.onSelect,
        onPickLocal: this.onPickLocal,
      };
      if (this.kind === 'icon') openImageGallery({ ...options, kind: 'item' });
      else openIconGallery(options);
      await this.close();
    }
  }
  GalleryClass = NihilImageGallery;
  return GalleryClass;
}

/**
 * 이미지 갤러리를 연다.
 * @param {object} options
 * @param {'portrait'|'token'|'map'|'item'|'icon'} options.kind  보여 줄 칸 종류
 * @param {string} [options.current]  지금 칸에 든 경로(같은 그림을 표시)
 * @param {string} [options.targetLabel]  어느 문서의 칸인지 보여 줄 문구
 * @param {(url: string, entry: object) => any} options.onSelect  고른 R2 주소를 받는다
 * @param {() => any} [options.onPickLocal]  「로컬 파일에서 선택」 단추(Foundry 파일 선택기)
 */
export function openImageGallery(options) {
  const Class = options?.kind === 'icon' ? getIconGalleryClass() : getImageGalleryClass();
  const app = new Class(options);
  app.render({ force: true });
  return app;
}

let IconGalleryClass;

export function getIconGalleryClass() {
  if (IconGalleryClass) return IconGalleryClass;
  const Base = getImageGalleryClass();
  class NihilIconGallery extends Base {
    static DEFAULT_OPTIONS = {
      ...Base.DEFAULT_OPTIONS,
      actions: {
        ...Base.DEFAULT_OPTIONS.actions,
        choose: NihilIconGallery._selectIcon,
        applyIcon: NihilIconGallery._applyIcon,
        category: NihilIconGallery._category,
        tag: NihilIconGallery._tag,
      },
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/gallery/icon-gallery.hbs` },
    };

    constructor(options = {}) {
      super({ ...options, kind: 'icon' });
      this.categories = [];
      this.category = '';
      this.tags = new Set();
      this.selectedId = null;
      this.applying = false;
    }

    async load(force = false) {
      await super.load(force);
      this.categoryWarning = '';
      if (this.error) return;
      try {
        this.categories = await loadIconCategories({ force });
      } catch {
        this.categories = [];
        this.categoryWarning = '분류표를 받지 못해 받은 아이콘으로 분류를 표시합니다.';
      }
      if (!this.entries.some((entry) => entry.id === this.selectedId)) {
        this.selectedId = this.entries.find((entry) => sameImagePath(
          entry.url,
          this.current,
        ))?.id ?? null;
      }
      const available = new Set(iconTags(this.entries).map((tag) => tag.name));
      this.tags = new Set([...this.tags].filter((tag) => available.has(tag)));
    }

    async _prepareContext() {
      const context = await super._prepareContext();
      const entries = this.entries ?? [];
      const tree = iconCategoryTree(
        this.categories,
        entries,
      );
      if (this.category && !tree.some((root) => root.key === this.category || root.children.some((child) => child.key === this.category))) {
        this.category = '';
      }
      return {
        ...context,
        categoryWarning: this.categoryWarning,
        categories: tree.map((root) => ({
          ...root,
          children: root.children.map((child) => ({ ...child, active: child.key === this.category })),
          active: root.key === this.category,
        })),
        allCategories: !this.category,
        categoryTotal: Math.max(
          entries.length,
          tree.reduce(
            (
              sum,
              root,
            ) => sum + root.count,
            0,
          ),
        ),
        tags: iconTags(entries).map((tag) => ({ ...tag, active: this.tags.has(tag.name) })),
        entries: entries.map((entry) => ({
          ...entry,
          current: sameImagePath(
            entry.url,
            this.current,
          ),
          selected: entry.id === this.selectedId,
        })),
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
      this.element.querySelector('[data-icon-grid]')?.addEventListener(
        'dblclick',
        async (event) => {
          const card = event.target.closest('[data-entry-id]');
          if (!card) return;
          this.selectedId = card.dataset.entryId;
          try {
            await NihilIconGallery._applyIcon.call(
              this,
              event,
            );
          } catch (error) {
            globalThis.ui?.notifications?.error?.(error?.message ?? '아이콘을 적용하지 못했습니다.');
          }
        },
      );
      this.element.querySelector('.ncm-gallery__icon.is-selected')?.scrollIntoView?.({ block: 'nearest' });
    }

    applyFilter() {
      const visible = new Set(filterIconEntries(
        this.entries ?? [],
        { category: this.category, tags: [...this.tags], search: this.search },
      ).map((entry) => entry.id));
      for (const card of this.element?.querySelectorAll?.('[data-entry-id]') ?? []) {
        card.hidden = !visible.has(card.dataset.entryId);
        const selected = card.dataset.entryId === this.selectedId;
        card.classList.toggle(
          'is-selected',
          selected,
        );
        card.setAttribute(
          'aria-pressed',
          String(selected),
        );
      }
      const count = this.element?.querySelector?.('[data-gallery-count]');
      if (count) count.textContent = String(visible.size);
      const empty = this.element?.querySelector?.('[data-gallery-empty]');
      if (empty) empty.hidden = visible.size > 0;
      for (const button of this.element?.querySelectorAll?.('[data-category], [data-tag]') ?? []) {
        const active = button.dataset.category !== undefined
          ? button.dataset.category === this.category
          : this.tags.has(button.dataset.tag);
        button.classList.toggle(
          'is-active',
          active,
        );
        button.setAttribute(
          'aria-pressed',
          String(active),
        );
      }
      const selected = this.entries?.find((entry) => entry.id === this.selectedId);
      const fields = {
        name: selected?.name ?? '아이콘을 선택하십시오.',
        category: selected ? (selected.categoryName || selected.category || '분류 없음') : '',
        tags: selected?.tags.join(' · ') ?? '',
      };
      for (const [field, value] of Object.entries(fields)) {
        const element = this.element?.querySelector?.(`[data-icon-${field}]`);
        if (element) element.textContent = value;
      }
      const apply = this.element?.querySelector?.('[data-action="applyIcon"]');
      if (apply) apply.disabled = !selected || this.applying;
    }

    static _selectIcon(
      event,
      target,
    ) {
      event.preventDefault();
      this.selectedId = target.dataset.entryId;
      this.applyFilter();
    }

    static async _applyIcon(event) {
      event.preventDefault();
      const entry = this.entries?.find((item) => item.id === this.selectedId);
      if (!entry || this.applying) return;
      this.applying = true;
      this.applyFilter();
      try {
        await this.onSelect?.(
          entry.url,
          entry,
        );
        await this.close();
      } finally {
        this.applying = false;
        this.applyFilter();
      }
    }

    static _category(
      event,
      target,
    ) {
      event.preventDefault();
      this.category = target.dataset.category;
      this.applyFilter();
    }

    static _tag(
      event,
      target,
    ) {
      event.preventDefault();
      const tag = target.dataset.tag;
      if (this.tags.has(tag)) this.tags.delete(tag);
      else this.tags.add(tag);
      this.applyFilter();
    }
  }
  IconGalleryClass = NihilIconGallery;
  return IconGalleryClass;
}

export function openIconGallery(options = {}) {
  return openImageGallery({ ...options, kind: 'icon' });
}
