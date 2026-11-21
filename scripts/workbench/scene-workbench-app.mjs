import { openImageGallery } from '../gallery/image-gallery-app.mjs';
import { isWorkbenchUser } from '../shared/workbench-access.mjs';
import {
  MODULE_ID,
  SCENE_BACKGROUND_COLOR,
  emptySceneState,
  gridFromColumns,
  readSceneState,
  sceneCreateData,
  sceneLevelUpdate,
  sceneNameFromEntry,
  sceneUpdateData,
} from './scene-fields.mjs';

const LEGACY_IDS = new Set(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);
const COMMON_GRID_SIZE = 50;

export function canUseSceneWorkbench() {
  return LEGACY_IDS.has(globalThis.game?.user?.id) || isWorkbenchUser();
}

// 그림 원본 크기를 잰다(목록에 크기가 없을 때). 캔버스에 그리지 않으므로 CORS가 필요 없다.
function measureImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function galleryOpener(options) {
  return (globalThis.__ncmImageGalleryOpener ?? openImageGallery)(options);
}

let SceneWorkbenchClass;
let sceneWorkbench;

export function getSceneWorkbenchClass() {
  if (SceneWorkbenchClass) return SceneWorkbenchClass;
  const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = globalThis.foundry.applications.api;
  class NihilSceneWorkbench extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: 'ncm-scene-workbench',
      classes: ['ncm-workbench', 'ncm-scene-workbench'],
      tag: 'form',
      window: { title: 'Nihil Workbench · 씬 편집기', resizable: true, icon: 'fa-solid fa-map' },
      position: { width: 1040, height: 760 },
      form: { closeOnSubmit: false, handler: NihilSceneWorkbench._save },
      actions: {
        selectScene: NihilSceneWorkbench._selectScene,
        newScene: NihilSceneWorkbench._newScene,
        pickBackground: NihilSceneWorkbench._pickBackground,
        viewScene: NihilSceneWorkbench._viewScene,
        deleteScene: NihilSceneWorkbench._deleteScene,
      },
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/workbench/scene-workbench.hbs` },
    };

    constructor({ sceneId = null } = {}) {
      super();
      this.selectSceneById(sceneId);
      this.search = '';
      this.saving = false;
    }

    selectSceneById(sceneId) {
      const scene = sceneId ? globalThis.game?.scenes?.get?.(sceneId) : null;
      this.sceneId = scene?.id ?? null;
      this.draft = scene ? readSceneState(scene) : emptySceneState();
    }

    get scene() {
      return this.sceneId ? globalThis.game.scenes.get(this.sceneId) ?? null : null;
    }

    // 화면의 입력값을 상태에 옮긴다(다시 그리기 전에).
    capture() {
      const form = this.element;
      if (!form?.querySelector) return;
      const value = (name) => form.querySelector(`[name="${name}"]`);
      if (value('sceneName')) this.draft.name = value('sceneName').value;
      if (value('sceneSrc')) this.draft.src = value('sceneSrc').value.trim();
      if (value('sceneColumns')) this.draft.columns = Number(value('sceneColumns').value);
      if (value('sceneLuminosity')) this.draft.luminosity = Number(value('sceneLuminosity').value);
      if (value('sceneDarkness')) this.draft.darkness = Number(value('sceneDarkness').value);
      if (value('sceneGlobalLight')) this.draft.globalLight = value('sceneGlobalLight').checked;
      if (value('sceneSearch')) this.search = value('sceneSearch').value;
    }

    gridPreview() {
      try {
        const grid = gridFromColumns(this.draft.width, this.draft.height, this.draft.columns);
        return { ok: true, text: `한 칸 ${grid.size}px · 세로 약 ${grid.rows}칸${grid.exact ? '' : ' (끝 칸이 조금 잘림)'}` };
      } catch (error) {
        return { ok: false, text: error.message };
      }
    }

    async _prepareContext() {
      const scenes = Array.from(globalThis.game?.scenes ?? [])
        .map((scene) => ({ id: scene.id, name: scene.name, active: scene.active, selected: scene.id === this.sceneId, thumb: scene.thumb ?? readSceneState(scene).src }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      const level = this.scene ? readSceneState(this.scene) : null;
      return {
        canEdit: canUseSceneWorkbench(),
        isNew: !this.sceneId,
        state: this.draft,
        scenes,
        search: this.search,
        grid: this.gridPreview(),
        sizeText: this.draft.width && this.draft.height ? `${this.draft.width}×${this.draft.height}px` : '크기 미확인',
        luminosityText: Number(this.draft.luminosity ?? 0).toFixed(2),
        darknessText: Number(this.draft.darkness ?? 0).toFixed(2),
        backgroundColor: SCENE_BACKGROUND_COLOR,
        colorFixedNote: level && level.backgroundColor && level.backgroundColor !== SCENE_BACKGROUND_COLOR
          ? `지금 배경색 ${level.backgroundColor} → 저장하면 검은색으로 바뀝니다.` : null,
      };
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const root = this.element;
      const refreshGrid = () => {
        this.capture();
        const preview = this.gridPreview();
        const out = root.querySelector('[data-grid-preview]');
        if (out) {
          out.textContent = preview.text;
          out.classList.toggle('is-error', !preview.ok);
        }
      };
      root.querySelector('[name="sceneColumns"]')?.addEventListener('input', refreshGrid);
      for (const [name, target] of [['sceneLuminosity', '[data-luminosity-value]'], ['sceneDarkness', '[data-darkness-value]']]) {
        const input = root.querySelector(`[name="${name}"]`);
        input?.addEventListener('input', () => {
          const out = root.querySelector(target);
          if (out) out.textContent = Number(input.value).toFixed(2);
        });
      }
      const search = root.querySelector('[name="sceneSearch"]');
      search?.addEventListener('input', () => {
        this.search = search.value;
        const words = this.search.toLowerCase().split(/\s+/).filter(Boolean);
        for (const row of root.querySelectorAll('[data-scene-row]')) row.hidden = !words.every((word) => row.dataset.name.toLowerCase().includes(word));
      });
      search?.dispatchEvent(new Event('input'));
      root.querySelector('[name="sceneSrc"]')?.addEventListener('change', async (event) => {
        await this.applyBackground(event.target.value.trim(), null);
      });
    }

    async applyBackground(src, entry) {
      this.capture();
      this.draft.src = src;
      let size = entry?.width && entry?.height ? { width: entry.width, height: entry.height } : null;
      if (!size && src) size = await measureImage(src);
      this.draft.width = size?.width ?? null;
      this.draft.height = size?.height ?? null;
      if (!this.draft.name && entry) this.draft.name = sceneNameFromEntry(entry);
      // 새로 고른 그림이면 기존 씬에서 가장 흔한 50px 격자를 기준으로 칸 수를 먼저 채운다.
      if (size && (!this.draft.columns || !this.sceneId)) this.draft.columns = Math.max(1, Math.round(size.width / COMMON_GRID_SIZE));
      await this.render({ force: true });
    }

    static async _selectScene(event, target) {
      event.preventDefault();
      this.selectSceneById(target.dataset.sceneId);
      await this.render({ force: true });
    }

    static async _newScene(event) {
      event.preventDefault();
      this.selectSceneById(null);
      await this.render({ force: true });
    }

    static async _pickBackground(event) {
      event.preventDefault();
      if (!canUseSceneWorkbench()) return;
      this.capture();
      galleryOpener({
        kind: 'map',
        current: this.draft.src,
        targetLabel: `${this.draft.name || '새 씬'} · 배경 이미지`,
        onSelect: (url, entry) => this.applyBackground(url, entry),
        onPickLocal: async () => {
          const FilePicker = globalThis.CONFIG?.ux?.FilePicker ?? globalThis.foundry?.applications?.apps?.FilePicker;
          if (!FilePicker) return;
          await new FilePicker({ type: 'image', current: this.draft.src, callback: (path) => this.applyBackground(path, null) }).browse();
        },
      });
    }

    static async _viewScene(event) {
      event.preventDefault();
      await this.scene?.view?.();
    }

    static async _deleteScene(event) {
      event.preventDefault();
      const scene = this.scene;
      if (!scene || !canUseSceneWorkbench()) return;
      const ok = await DialogV2.confirm({
        window: { title: '씬 삭제' },
        content: `<p>「${foundry.utils.escapeHTML?.(scene.name) ?? scene.name}」 씬을 삭제하시겠습니까? 씬 안의 토큰·벽·조명도 함께 지워집니다.</p>`,
      });
      if (!ok) return;
      await scene.delete();
      this.selectSceneById(null);
      globalThis.ui?.notifications?.info?.('씬을 삭제했습니다.');
      await this.render({ force: true });
    }

    static async _save(event) {
      event.preventDefault();
      if (this.saving || !canUseSceneWorkbench()) return;
      this.capture();
      this.saving = true;
      try {
        let scene = this.scene;
        if (!scene) {
          scene = await globalThis.CONFIG.Scene.documentClass.create(sceneCreateData(this.draft));
          if (!scene) throw new Error('씬을 만들지 못했습니다.');
        } else {
          await scene.update(sceneUpdateData(this.draft));
        }
        const level = scene.levels?.get?.(scene.initialLevel) ?? scene.levels?.contents?.[0];
        if (!level) throw new Error('씬의 레벨을 찾지 못해 배경을 넣지 못했습니다.');
        await level.update(sceneLevelUpdate(this.draft.src));
        this.selectSceneById(scene.id);
        globalThis.ui?.notifications?.info?.(`「${scene.name}」 씬을 저장했습니다.`);
        await this.render({ force: true });
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      } finally {
        this.saving = false;
      }
    }

    async close(options = {}) {
      if (sceneWorkbench === this) sceneWorkbench = null;
      return super.close(options);
    }
  }
  SceneWorkbenchClass = NihilSceneWorkbench;
  return SceneWorkbenchClass;
}

export function openSceneWorkbench({ sceneId = null } = {}) {
  if (!canUseSceneWorkbench()) return null;
  const Class = getSceneWorkbenchClass();
  if (sceneWorkbench?.rendered) {
    if (sceneId) sceneWorkbench.selectSceneById(sceneId);
    sceneWorkbench.render({ force: true });
    sceneWorkbench.bringToFront?.();
    return sceneWorkbench;
  }
  sceneWorkbench = new Class({ sceneId });
  sceneWorkbench.render({ force: true });
  return sceneWorkbench;
}

export function isSceneWorkbenchOpen() {
  return Boolean(sceneWorkbench?.rendered);
}

export async function toggleSceneWorkbench() {
  if (isSceneWorkbenchOpen()) return sceneWorkbench.close();
  return openSceneWorkbench();
}
