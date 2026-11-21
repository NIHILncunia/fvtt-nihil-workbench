import {
  ArchiveImageError,
  MODULE_ID,
  entryGroups,
  galleryKind,
  loadGalleryEntries,
  readImageToken,
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
      const sourceEntries = (this.entries ?? []).filter((entry) => entry.source === this.source);
      const groups = entryGroups(sourceEntries);
      if (this.group && !groups.some((group) => group.value === this.group)) this.group = '';
      return {
        title: this.config.title,
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
  }
  GalleryClass = NihilImageGallery;
  return GalleryClass;
}

/**
 * 이미지 갤러리를 연다.
 * @param {object} options
 * @param {'portrait'|'token'|'map'|'item'} options.kind  보여 줄 칸 종류
 * @param {string} [options.current]  지금 칸에 든 경로(같은 그림을 표시)
 * @param {string} [options.targetLabel]  어느 문서의 칸인지 보여 줄 문구
 * @param {(url: string, entry: object) => any} options.onSelect  고른 R2 주소를 받는다
 * @param {() => any} [options.onPickLocal]  「로컬 파일에서 선택」 단추(Foundry 파일 선택기)
 */
export function openImageGallery(options) {
  const Class = getImageGalleryClass();
  const app = new Class(options);
  app.render({ force: true });
  return app;
}
