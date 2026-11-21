import { isWorkbenchUser } from '../shared/workbench-access.mjs';
import { loadPackDocuments, createPackDocument, packEditAllowed, requireModulePack, requirePackDocument } from './compendium-adapter.mjs';
import {
  buildActorCreateSource,
  buildActorWorkbenchUpdate,
  isSupportedActor,
  readActorWorkbenchModel,
} from './actor-adapter.mjs';
import {
  importLocalizedStatblock,
  validateStatblockImport,
} from '../statblock-importer/service.mjs';
import { createEmbeddedItemContext } from './item-document-context.mjs';
import { openEmbeddedItemWorkbench, prepareItemWorkbenchTransition } from './workbench-app.mjs';
import { actorFieldSections, previewActorCombatCards } from './actor-fields.mjs';
import { actorItemGroups } from './actor-item-groups.mjs';
import { habitatRows, readHabitatInputs } from './actor-list-fields.mjs';
import { applyTokenVisionDefaults, detectionModeList, tokenDetectionRows, readTokenDetectionInputs } from './token-fields.mjs';
import { ActorDraftStore, readActorControls } from './actor-drafts.mjs';
import { editEffect } from './effect-workbench-app.mjs';
import { editOwnership } from './ownership-workbench-app.mjs';
import { requireWriteResult } from './write-result.mjs';
import { lockWorkbenchControls } from './save-state.mjs';
import { editDocument, editToken } from './document-workbench-app.mjs';
import { copyItemToActor, createFolderInWorkbench, itemTypeChoices, openItemLibrary } from './item-library.mjs';

const MODULE_ID = 'nihil-compendium-module';
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/workbench/actor-workbench.hbs`;
const PRIVILEGED_USER_IDS = new Set(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);
const ACTOR_TYPES = Object.freeze(['character', 'npc']);
const BROWSER_TYPES = Object.freeze(['all', ...ACTOR_TYPES]);

let ActorWorkbenchClass = null;
let actorWorkbenchInstance = null;

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
}

function browserState(state = {}) {
  return {
    folderId: state.folderId ?? null,
    selectedActorId: state.selectedActorId ?? null,
    search: state.search ?? '',
  };
}

function typeLabel(type) {
  if (type === 'all') return '전체';
  return type === 'character' ? 'PC' : 'NPC';
}

export function actorBrowserSummary(actor) {
  const details = actor.system?.details ?? {};
  if (actor.type === 'npc') {
    const cr = details.cr;
    const crLabel = cr === null || cr === undefined || cr === ''
      ? '—'
      : ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[cr] ?? String(cr));
    const creature = details.type;
    const value = typeof creature === 'string' ? creature : creature?.value;
    const configured = globalThis.CONFIG?.DND5E?.creatureTypes?.[value];
    const label = typeof configured === 'string' ? configured : configured?.label;
    const creatureLabel = value === 'custom'
      ? creature?.custom?.trim() || '—'
      : (label ? globalThis.game?.i18n?.localize?.(label) ?? label : value) || '—';
    return `CR ${crLabel} | ${creatureLabel}`;
  }
  const items = collectionValues(actor.items);
  const classes = items.filter(item => item.type === 'class');
  const level = details.level ?? classes.reduce(
    (
      total,
      item,
    ) => total + Number(item.system?.levels ?? 0),
    0,
  );
  const classNames = classes.map(item => item.name).filter(Boolean).join(' / ') || '—';
  const race = details.race;
  const species = typeof race === 'string'
    ? items.find(item => item.id === race)?.name ?? race
    : race?.name;
  const speciesName = species || items.find(item => item.type === 'race')?.name || '—';
  return `${level}레벨 | ${classNames} | ${speciesName}`;
}

function stateForType(states, type) {
  return browserState(states[type]);
}

function actorCreationState(type, folderId = null) {
  return {
    type,
    method: 'direct',
    name: '',
    img: '',
    folderId,
    sbiPayload: '',
  };
}

function creationFormValue(form, name) {
  const control = form?.elements?.namedItem?.(name) ?? form?.elements?.[name];
  return control?.value ?? '';
}

function editorFormControl(form, name) {
  return form?.elements?.namedItem?.(name) ?? form?.elements?.[name] ?? null;
}

function editorFormValue(form, name) {
  const control = editorFormControl(form, name);
  if (!control) return undefined;
  if (control.type === 'checkbox') return Boolean(control.checked);
  return control.value;
}

export function readActorEditForm(form) {
  const values = {};
  const fields = {
    actorName: 'name',
    actorImg: 'img',
    tokenImg: 'tokenImg',
    hpValue: 'hpValue',
    hpMax: 'hpMax',
    hpTemp: 'hpTemp',
    acFlat: 'acFlat',
    biography: 'biography',
    xpValue: 'xpValue',
    inspiration: 'inspiration',
    deathSuccess: 'deathSuccess',
    deathFailure: 'deathFailure',
    cr: 'cr',
    creatureSize: 'creatureSize',
    creatureType: 'creatureType',
    creatureSubtype: 'creatureSubtype',
    creatureCustom: 'creatureCustom',
    spellLevel: 'spellLevel',
    hpFormula: 'hpFormula',
    legendaryActionsSpent: 'legendaryActionsSpent',
    legendaryActionsMax: 'legendaryActionsMax',
    legendaryResistanceSpent: 'legendaryResistanceSpent',
    legendaryResistanceMax: 'legendaryResistanceMax',
    lairValue: 'lairValue',
    lairInitiative: 'lairInitiative',
  };
  for (const [controlName, formKey] of Object.entries(fields)) {
    const value = editorFormValue(form, controlName);
    if (value !== undefined) values[formKey] = value;
  }

  const source = {};
  for (const [controlName, sourceKey] of Object.entries({
    sourceBook: 'book',
    sourcePage: 'page',
    sourceCustom: 'custom',
  })) {
    const value = editorFormValue(form, controlName);
    if (value !== undefined) source[sourceKey] = value;
  }
  if (Object.keys(source).length) values.source = source;
  return values;
}

export function canUseActorWorkbench() {
  return PRIVILEGED_USER_IDS.has(globalThis.game?.user?.id) || isWorkbenchUser();
}

export function actorEditorTabs(type) {
  if (!ACTOR_TYPES.includes(type)) return [];
  const common = [
    { key: 'basic', label: '기본 정보' },
    { key: 'combat', label: '전투 수치' },
    { key: 'items', label: '소유 항목' },
    { key: 'background', label: '배경·출처' },
    { key: 'spells', label: '주문' },
    { key: 'token', label: '토큰' },
    { key: 'effects', label: '효과' },
    { key: 'advanced', label: '추가 설정' },
  ];
  if (type === 'character') {
    return [...common, { key: 'traits', label: '특성·행동' }, { key: 'growth', label: '성장·자원' }];
  }
  return [
    ...common,
    { key: 'npc', label: 'NPC 설정' },
    { key: 'traits', label: '특성·행동' },
    { key: 'legendary', label: '전설·소굴 자원' },
  ];
}

export function buildActorBrowserModel({
  actors = [],
  folders = [],
  activeType = 'character',
  folderId = null,
  search = '',
} = {}) {
  const normalizedSearch = String(search ?? '').trim().toLocaleLowerCase('ko');
  const rows = collectionValues(actors)
    .filter(actor => isSupportedActor(actor) && (activeType === 'all' || actor.type === activeType))
    .filter(actor => (actor.folder?.id ?? null) === (folderId ?? null))
    .filter(actor => !normalizedSearch || String(actor.name ?? '').toLocaleLowerCase('ko').includes(normalizedSearch))
    .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ko'))
    .map(actor => ({
      id: actor.id,
      name: actor.name ?? '',
      img: actor.img ?? 'icons/svg/mystery-man.svg',
      type: actor.type,
      typeLabel: typeLabel(actor.type),
      summary: actorBrowserSummary(actor),
      folderId: actor.folder?.id ?? null,
    }));
  const folderRows = collectionValues(folders)
    .filter(folder => folder?.type === 'Actor')
    .filter(folder => (folder.folder?.id ?? null) === (folderId ?? null))
    .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ko'))
    .map(folder => ({
      id: folder.id,
      name: folder.name ?? '',
      parentId: folder.folder?.id ?? null,
    }));
  return {
    activeType,
    activeTypeLabel: typeLabel(activeType),
    isAll: activeType === 'all',
    typeTabs: BROWSER_TYPES.map(type => ({
      value: type,
      label: typeLabel(type),
      selected: type === activeType,
    })),
    folders: folderRows,
    rows,
  };
}

export function buildEmbeddedItemBrowserModel(actor) {
  return collectionValues(actor?.items)
    .slice()
    .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ko'))
    .map(item => ({
      id: item.id,
      name: item.name ?? '',
      type: item.type ?? '',
      img: item.img ?? 'icons/svg/item-bag.svg',
    }));
}

function embeddedItemTypeOptions() {
  return Object.entries(itemTypeChoices())
    .map(([value, label]) => ({
      value,
      label: globalThis.game?.i18n?.localize?.(label) ?? label,
    }))
    .sort((left, right) => String(left.label).localeCompare(String(right.label), 'ko'));
}

export function embeddedItemCreateName(type) {
  const typeLabel = globalThis.CONFIG?.DND5E?.itemTypes?.[type] ?? type;
  const localizedTypeLabel = globalThis.game?.i18n?.localize?.(typeLabel) ?? typeLabel;
  return `새 ${localizedTypeLabel} 항목`;
}

export class ActorWorkbenchState {
  constructor({ activeType = 'character' } = {}) {
    this.activeType = BROWSER_TYPES.includes(activeType) ? activeType : 'character';
    this.browserStates = Object.fromEntries(BROWSER_TYPES.map(type => [type, browserState()]));
    this.editorTabs = Object.fromEntries(ACTOR_TYPES.map(type => [type, 'basic']));
    this.creationState = null;
    this.sbiResult = null;
    this.sbiError = null;
  }

  browserStateFor(type) {
    if (!BROWSER_TYPES.includes(type)) return browserState();
    return browserState(this.browserStates[type]);
  }

  setBrowserState(type, changes = {}) {
    if (!BROWSER_TYPES.includes(type)) return this.browserStateFor(type);
    this.browserStates[type] = {
      ...this.browserStateFor(type),
      ...changes,
    };
    if (this.creationState?.type === type) {
      this.creationState.folderId = this.browserStates[type].folderId;
    }
    return this.browserStateFor(type);
  }

  selectActorType(type) {
    if (!BROWSER_TYPES.includes(type)) return this.activeType;
    this.activeType = type;
    return this.activeType;
  }

  activeEditorTabFor(type) {
    const activeTab = this.editorTabs[type];
    return actorEditorTabs(type).some(tab => tab.key === activeTab) ? activeTab : 'basic';
  }

  selectEditorTab(tab, type = this.activeType) {
    if (!actorEditorTabs(type).some(candidate => candidate.key === tab)) {
      return this.activeEditorTabFor(type);
    }
    this.editorTabs[type] = tab;
    return tab;
  }

  syncDeletedFolder(folderId, parentFolderId = null) {
    for (const type of BROWSER_TYPES) {
      if (this.browserStateFor(type).folderId !== folderId) continue;
      this.setBrowserState(type, {
        folderId: parentFolderId,
        selectedActorId: null,
      });
    }
  }

  beginActorCreation(type = this.activeType) {
    if (!ACTOR_TYPES.includes(type)) return null;
    this.selectActorType(type);
    this.creationState = actorCreationState(type, this.browserStateFor(type).folderId);
    this.sbiResult = null;
    this.sbiError = null;
    return { ...this.creationState };
  }

  selectNpcCreationMethod(method) {
    if (this.creationState?.type !== 'npc' || !['direct', 'sbi'].includes(method)) {
      return this.creationState?.method ?? null;
    }
    this.creationState = { ...this.creationState, method };
    return this.creationState.method;
  }

  setActorCreationDraft(changes = {}) {
    if (!this.creationState) return null;
    this.creationState = { ...this.creationState, ...changes };
    return { ...this.creationState };
  }

  cancelActorCreation() {
    this.creationState = null;
    this.sbiResult = null;
    this.sbiError = null;
  }
}

function getActorWorkbenchClass() {
  if (ActorWorkbenchClass) return ActorWorkbenchClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry?.applications?.api ?? {};
  if (!ApplicationV2 || !HandlebarsApplicationMixin) {
    throw new Error('Foundry ApplicationV2 API is not available.');
  }

  class NihilActorWorkbench extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: 'ncm-actor-workbench',
      classes: ['ncm-workbench', 'ncm-actor-workbench'],
      tag: 'form',
      window: {
        title: 'Nihil Workbench · 액터 편집기',
        icon: 'fa-solid fa-hammer',
        resizable: true,
      },
      position: {
        width: 1200,
        height: 820,
      },
      actions: {
        selectActorType: NihilActorWorkbench._selectActorTypeAction,
        openActorFolder: NihilActorWorkbench._openActorFolderAction,
        goActorParentFolder: NihilActorWorkbench._goActorParentFolderAction,
        goActorRootFolder: NihilActorWorkbench._goActorRootFolderAction,
        selectActor: NihilActorWorkbench._selectActorAction,
        selectActorEditorTab: NihilActorWorkbench._selectActorEditorTabAction,
        saveActor: NihilActorWorkbench._saveActorAction,
        editOwnership: NihilActorWorkbench._editOwnershipAction,
        pickActorImage: NihilActorWorkbench._pickActorImageAction,
        openEmbeddedItem: NihilActorWorkbench._openEmbeddedItemAction,
        createEmbeddedItem: NihilActorWorkbench._createEmbeddedItemAction,
        duplicateEmbeddedItem: NihilActorWorkbench._duplicateEmbeddedItemAction,
        deleteEmbeddedItem: NihilActorWorkbench._deleteEmbeddedItemAction,
        newActor: NihilActorWorkbench._newActorAction,
        selectNpcCreationMethod: NihilActorWorkbench._selectNpcCreationMethodAction,
        cancelActorCreation: NihilActorWorkbench._cancelActorCreationAction,
        saveNewActor: NihilActorWorkbench._saveNewActorAction,
        validateSbiImport: NihilActorWorkbench._validateSbiImportAction,
        importSbi: NihilActorWorkbench._importSbiAction,
        discardActorDraft: NihilActorWorkbench._discardActorDraftAction,
          discardDeletedActorDraft: NihilActorWorkbench._discardDeletedActorDraftAction,
        duplicateActor: NihilActorWorkbench._duplicateActorAction,
        deleteActor: NihilActorWorkbench._deleteActorAction,
        createActorFolder: NihilActorWorkbench._createActorFolderAction,
        editActorFolder: NihilActorWorkbench._editActorFolderAction,
        deleteActorFolder: NihilActorWorkbench._deleteActorFolderAction,
        importOwnedItem: NihilActorWorkbench._importOwnedItemAction,
        openItemLibrary: NihilActorWorkbench._openItemLibraryAction,
        createActorEffect: NihilActorWorkbench._createActorEffectAction,
        editActorEffect: NihilActorWorkbench._editActorEffectAction,
        duplicateActorEffect: NihilActorWorkbench._duplicateActorEffectAction,
        toggleActorEffect: NihilActorWorkbench._toggleActorEffectAction,
        deleteActorEffect: NihilActorWorkbench._deleteActorEffectAction,
        openNativeActor: NihilActorWorkbench._openNativeActorAction,
        openTokenConfig: NihilActorWorkbench._openTokenConfigAction,
        addTokenDetection: NihilActorWorkbench._addTokenDetectionAction,
        removeTokenDetection: NihilActorWorkbench._removeTokenDetectionAction,
        addActorHabitat: NihilActorWorkbench._addActorHabitatAction,
        removeActorHabitat: NihilActorWorkbench._removeActorHabitatAction,
        applyTokenVisionDefaults: NihilActorWorkbench._applyTokenVisionDefaultsAction,
        dismissSbiResult: NihilActorWorkbench._dismissSbiResultAction,
        retrySbiLocalization: NihilActorWorkbench._retrySbiLocalizationAction,
      },
    };

    static PARTS = {
      main: { template: TEMPLATE_PATH },
    };

    packId = null;

    get actorCollection() {
      return this.packId ? globalThis.game?.packs?.get?.(this.packId) : globalThis.game?.actors;
    }

    get actorFolders() {
      return this.packId ? this.actorCollection?.folders : globalThis.game?.folders;
    }

    canManageActor() {
      return canUseActorWorkbench() && (!this.packId || packEditAllowed(
        this.packId,
        'Actor',
      ));
    }

    activeType = 'character';
    browserStates = Object.fromEntries(BROWSER_TYPES.map(type => [type, browserState()]));
    editorTabs = Object.fromEntries(ACTOR_TYPES.map(type => [type, 'basic']));
    creationState = null;
    sbiResult = null;
    sbiError = null;
    movingActorIds = new Set();
    drafts = new ActorDraftStore();
    renderedActorId = null;
    initialControls = {};
    savingActor = false;
    importBusy = false;
    changingDetectionRows = false;

    captureEditorDraft() {
      if (this.savingActor || this.changingDetectionRows || this.creationState || !this.renderedActorId) return;
      const actor = this.actorCollection?.get?.(this.renderedActorId)
        ?? (this.renderedActorDocument?.id === this.renderedActorId ? this.renderedActorDocument : null);
      this.drafts.capture(
        actor,
        readActorControls(this.form),
        this.initialControls
      );
    }

    refreshCombatPreview() {
      const cards = this.element?.querySelectorAll?.('[data-ability], [data-skill]');
      if (!cards?.length || !this.selectedActor) return;
      let values;
      try {
        values = previewActorCombatCards(
          this.selectedActor,
          {
            ...this.drafts.records.get(this.renderedActorId)?.values,
            ...readActorControls(this.form),
          },
        );
      } catch {
        values = {
          abilities: Array.from(cards)
            .filter(card => card.dataset.ability)
            .map(card => ({
              key: card.dataset.ability,
              modifier: '—',
              saveModifier: '—',
              isProficient: Number(card.querySelector('select')?.value ?? 0) > 0,
            })),
          skills: Array.from(cards)
            .filter(card => card.dataset.skill)
            .map(card => ({
              key: card.dataset.skill,
              modifier: '—',
              passive: '—',
              isProficient: Number(card.querySelector('select')?.value ?? 0) > 0,
            })),
        };
      }
      for (const value of values.abilities) {
        const card = this.element.querySelector(`[data-ability="${value.key}"]`);
        if (!card) continue;
        card.classList.toggle(
          'is-proficient',
          value.isProficient,
        );
        card.querySelector('[data-ability-modifier]').textContent = value.modifier;
        card.querySelector('[data-ability-save]').textContent = value.saveModifier;
      }
      for (const value of values.skills) {
        const card = this.element.querySelector(`[data-skill="${value.key}"]`);
        if (!card) continue;
        card.classList.toggle(
          'is-proficient',
          value.isProficient,
        );
        card.querySelector('[data-skill-modifier]').textContent = value.modifier;
        card.querySelector('[data-skill-passive]').textContent = value.passive;
      }
    }

    async render(options = {}) {
      if (this.savingActor) return this;
      this.captureEditorDraft();
      this.captureActorCreationDraft();
      return super.render(options);
    }

    async confirmChange(
      title,
      content
    ) {
      const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
      return Dialog ? Dialog.confirm({ window: { title }, content, rejectClose: false }) : false;
    }

    async abandonCreation() {
      this.captureActorCreationDraft();
      const draft = this.creationState;
      if (draft && (draft.name || draft.img || draft.sbiPayload)
        && !await this.confirmChange(
          '새 액터 입력 취소',
          '<p>작성 중인 새 액터 입력을 버리시겠습니까?</p>'
        )) return false;
      this.cancelActorCreation();
      return true;
    }

    async saveActorDraft(actor) {
      if (this.savingActor) return false;
      if (!this.canManageActor() || this.actorCollection?.get?.(actor.id) !== actor) {
        throw new Error('액터가 삭제되었거나 워크벤치 수정 권한이 없습니다. 입력을 보존했습니다.');
      }
      if (actor.isOwner === false || actor.canUserModify?.(
        globalThis.game.user,
        'update'
      ) === false) throw new Error('이 액터를 수정할 권한이 없습니다.');
      if (actor.pack) requirePackDocument(actor);
      this.savingActor = true;
      const unlock = lockWorkbenchControls(this);
      try {
        const { update, conflicts } = this.drafts.prepare(actor);
        if (conflicts.length && !await this.confirmChange(
          '외부 변경 충돌',
          '<p>같은 필드가 다른 창에서 변경되었습니다. 보관한 입력값으로 덮어쓰시겠습니까?</p>',
        )) return false;
        if (!Object.keys(update).length) return true;
        if (actor.pack) requirePackDocument(actor);
        requireWriteResult(await actor.update(update), '액터 저장');
        this.drafts.records.delete(actor.id);
        this.initialControls = {};
        return true;
      } finally {
        unlock();
        this.savingActor = false;
      }
    }

    async close(options = {}) {
      if (this.savingActor) return this;
      this.captureEditorDraft();
      this.captureActorCreationDraft();
      const hasCreation = this.creationState && (this.creationState.name || this.creationState.img || this.creationState.sbiPayload);
      if (this.drafts.records.size || hasCreation) {
        const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
        if (!Dialog) return this;
        const choice = await Dialog.wait({
          window: { title: '저장하지 않은 액터 입력' },
          content: '<p>보관한 액터 입력이 있습니다. 저장하거나 버린 뒤 닫을 수 있습니다. 새 액터 입력은 입력 버리고 닫기를 선택하면 사라집니다.</p>',
          buttons: [
            { action: 'save', label: '액터 변경 저장 후 닫기', disabled: Boolean(hasCreation), callback: () => 'save' },
            { action: 'discard', label: '입력 버리고 닫기', callback: () => 'discard' },
            { action: 'cancel', label: '계속 편집', default: true, callback: () => 'cancel' },
          ],
          rejectClose: false,
        });
        if (!choice || choice === 'cancel') return this;
        if (choice === 'save') {
          try {
            for (const id of this.drafts.records.keys()) {
              const actor = this.actorCollection?.get?.(id);
                if (!actor) throw new Error('삭제된 액터의 입력이 있습니다. 필요한 값을 복사한 뒤 보관 입력을 버리십시오.');
                if (!await this.saveActorDraft(actor)) return this;
            }
          } catch (error) {
            globalThis.ui?.notifications?.error?.(error.message);
            return this;
          }
        }
        this.drafts.records.clear();
        this.creationState = null;
      }
      const closed = await super.close(options);
      globalThis.Hooks?.callAll('ncmWorkbenchStateChanged');
      return closed;
    }

    browserStateFor(type) {
      return stateForType(this.browserStates, type);
    }

    setBrowserState(type, changes = {}) {
      if (!BROWSER_TYPES.includes(type)) return this.browserStateFor(type);
      this.browserStates[type] = {
        ...this.browserStateFor(type),
        ...changes,
      };
      if (this.creationState?.type === type) {
        this.creationState.folderId = this.browserStates[type].folderId;
      }
      return this.browserStateFor(type);
    }

    selectActorType(type) {
      if (BROWSER_TYPES.includes(type)) this.activeType = type;
      return this.activeType;
    }

    activeEditorTabFor(type) {
      const activeTab = this.editorTabs[type];
      return actorEditorTabs(type).some(tab => tab.key === activeTab) ? activeTab : 'basic';
    }

    selectEditorTab(tab, type = this.activeType) {
      if (this.savingActor) return this.activeEditorTabFor(type);
      if (!actorEditorTabs(type).some(candidate => candidate.key === tab)) {
        return this.activeEditorTabFor(type);
      }
      this.editorTabs[type] = tab;
      return tab;
    }

    selectActor(actor) {
      if (this.savingActor) return this.selectedActor;
      if (!isSupportedActor(actor)) return null;
      const browserType = this.activeType === 'all' ? 'all' : actor.type;
      this.selectActorType(browserType);
      this.setBrowserState(
        browserType,
        {
          folderId: actor.folder?.id ?? null,
          selectedActorId: actor.id,
        },
      );
      return actor;
    }

    openActorFolder(folderId) {
      const folder = this.actorFolders?.get?.(folderId);
      if (folder?.type !== 'Actor') return this.browserStateFor(this.activeType);
      this.setBrowserState(this.activeType, {
        folderId: folder.id,
        selectedActorId: null,
      });
      return this.browserStateFor(this.activeType);
    }

    goActorParentFolder() {
      const state = this.browserStateFor(this.activeType);
      const folder = state.folderId ? this.actorFolders?.get?.(state.folderId) : null;
      this.setBrowserState(this.activeType, {
        folderId: folder?.folder?.id ?? null,
        selectedActorId: null,
      });
      return this.browserStateFor(this.activeType);
    }

    syncDeletedFolder(folderId, parentFolderId = null) {
      for (const type of BROWSER_TYPES) {
        if (this.browserStateFor(type).folderId !== folderId) continue;
        this.setBrowserState(type, {
          folderId: parentFolderId,
          selectedActorId: null,
        });
      }
    }

    beginActorCreation(type = this.activeType) {
      if (!ACTOR_TYPES.includes(type)) return null;
      this.selectActorType(type);
      this.creationState = actorCreationState(type, this.browserStateFor(type).folderId);
      this.sbiResult = null;
      this.sbiError = null;
      return this.creationState;
    }

    selectNpcCreationMethod(method) {
      if (this.creationState?.type !== 'npc' || !['direct', 'sbi'].includes(method)) {
        return this.creationState?.method ?? null;
      }
      this.creationState = { ...this.creationState, method };
      return this.creationState.method;
    }

    cancelActorCreation() {
      this.creationState = null;
      this.sbiResult = null;
      this.sbiError = null;
    }

    setActorCreationDraft(changes = {}) {
      if (!this.creationState) return null;
      this.creationState = { ...this.creationState, ...changes };
      return this.creationState;
    }

    get selectedActor() {
      const actorId = this.browserStateFor(this.activeType).selectedActorId;
      return actorId ? this.actorCollection?.get?.(actorId) ?? null : null;
    }

    captureActorCreationDraft() {
      if (!this.creationState || !this.form || this.renderedActorId) return;
      const fields = this.creationState.method === 'sbi'
        ? { sbiPayload: 'sbiPayload' }
        : { name: 'actorName', img: 'actorImg' };
      for (const [key, name] of Object.entries(fields)) {
        const value = editorFormValue(
          this.form,
          name,
        );
        if (value !== undefined) this.creationState[key] = value;
      }
    }

    actorCreationFolderId() {
      const folderId = this.browserStateFor(this.creationState.type).folderId;
      if (folderId && this.actorFolders?.get?.(folderId)?.type !== 'Actor') {
        throw new Error('생성할 액터 폴더를 찾을 수 없습니다. 폴더를 다시 선택하십시오.');
      }
      return folderId;
    }

    async open(options = {}) {
      if (this.savingActor) return this;
      this.captureEditorDraft();
      this.captureActorCreationDraft();
      if (this.creationState && (options.creationMode || options.actorId || options.activeType)
        && !await this.abandonCreation()) return this;
      if (options.activeType) this.selectActorType(options.activeType);
      if (options.creationMode === 'sbi') {
        this.beginActorCreation('npc');
        this.selectNpcCreationMethod('sbi');
      }
      const actor = options.actorId ? this.actorCollection?.get?.(options.actorId) : null;
      if (actor) this.selectActor(actor);
      this.render({ force: true });
      return this;
    }

    async _prepareContext(options) {
      const base = await super._prepareContext(options);
      if (this.packId) await loadPackDocuments(requireModulePack(
        this.packId,
        'Actor',
      ));
      const state = this.browserStateFor(this.activeType);
      const browser = buildActorBrowserModel({
        actors: this.actorCollection,
        folders: this.actorFolders,
        activeType: this.activeType,
        folderId: state.folderId,
        search: state.search,
      });
      const actor = this.selectedActor;
      const selected = actor ? readActorWorkbenchModel(actor) : null;
      const fieldSections = selected ? actorFieldSections(actor)
        .filter(section => section.tab === this.activeEditorTabFor(actor.type) && section.fields.length) : [];
      for (const section of fieldSections) {
        if (!section.isDetectionModes && !section.isHabitats) continue;
        const field = section.fields[0];
        const draft = this.drafts.records.get(actor.id)?.values[field.name];
        field.value = draft ?? field.value;
        section.rows = section.isHabitats ? habitatRows(JSON.parse(field.value)) : tokenDetectionRows(JSON.parse(field.value));
      }
      if (selected?.type === 'npc' && actor.getCRExp) selected.typeSpecific.xp = { value: actor.getCRExp(selected.typeSpecific.cr) };
      const activeFolder = state.folderId ? this.actorFolders?.get?.(state.folderId) : null;
      return {
        ...base,
        packTarget: this.packId ? { id: this.packId, label: this.actorCollection?.title, locked: this.actorCollection?.locked } : null,
        browser: {
          ...browser,
          search: state.search,
          rows: browser.rows.map(row => ({
            ...row,
            selected: row.id === state.selectedActorId,
          })),
          selectedActorId: state.selectedActorId,
          currentFolderName: activeFolder?.name ?? null,
          currentFolderId: state.folderId,
          parentFolderId: activeFolder?.folder?.id ?? null,
          hasParentFolder: Boolean(state.folderId),
        },
        selected: selected ? {
          ...selected,
          typeLabel: typeLabel(selected.type),
          spellDc: actor.system?.attributes?.spell?.dc,
          spellAttack: actor.system?.attributes?.spell?.attack,
          embeddedItems: buildEmbeddedItemBrowserModel(actor),
          embeddedItemTypeOptions: embeddedItemTypeOptions(),
        } : null,
        editorTabs: selected ? actorEditorTabs(selected.type).map(tab => ({
          ...tab,
          selected: tab.key === this.activeEditorTabFor(selected.type),
        })) : [],
        creation: this.creationState ? {
          ...this.creationState,
          isNpc: this.creationState.type === 'npc',
          isDirect: this.creationState.method === 'direct',
          isSbi: this.creationState.method === 'sbi',
          folderName: this.creationState.folderId
            ? this.actorFolders?.get?.(this.creationState.folderId)?.name
            : '최상위',
          sbiResult: this.sbiResult,
          sbiError: this.sbiError,
        } : null,
        fieldSections,
        itemGroups: selected ? this.itemGroups(actor) : [],
        effects: collectionValues(actor?.effects).map(effect => ({ id: effect.id, name: effect.name, img: effect.img, disabled: effect.disabled, inherited: Boolean(effect.parent?.documentName === 'Item') })),
        sbiSummary: this.sbiResult?.imported ? { ...this.sbiResult, issuesText: this.sbiResult.importIssues ? JSON.stringify(
          this.sbiResult.importIssues,
          null,
          2
        ) : '' } : null,
        deletedDrafts: Array.from(this.drafts.records, ([id, record]) => ({
          id, name: record.source.name ?? id,
          fields: Object.entries(record.values).map(([name, value], index) => ({ name: ({ actorName: '이름', actorImg: '초상화 경로' })[name] ?? `보관 입력 ${index + 1}`, value: typeof value === 'string' ? value : JSON.stringify(value) })),
        })).filter(record => !this.actorCollection?.get?.(record.id)),
        pendingCount: this.drafts.records.size,
        selectedDirty: actor && this.drafts.records.has(actor.id),
        canManage: this.canManageActor() && (actor?.isOwner ?? true),
      };
    }

    static async _selectActorTypeAction(event, target) {
      event.preventDefault();
      this.captureEditorDraft();
      this.captureActorCreationDraft();
      if (this.creationState && this.creationState.type !== target.dataset.actorType && !await this.abandonCreation()) return;
      this.selectActorType(target.dataset.actorType);
      await this.render({ force: true });
    }

    static async _openActorFolderAction(event, target) {
      event.preventDefault();
      this.captureActorCreationDraft();
      this.openActorFolder(target.dataset.folderId);
      await this.render({ force: true });
    }

    static async _goActorParentFolderAction(event) {
      event.preventDefault();
      this.captureActorCreationDraft();
      this.goActorParentFolder();
      await this.render({ force: true });
    }

    static async _goActorRootFolderAction(event) {
      event.preventDefault();
      this.captureActorCreationDraft();
      this.setBrowserState(
        this.activeType,
        { folderId: null, selectedActorId: null },
      );
      await this.render({ force: true });
    }

    static async _selectActorAction(event, target) {
      event.preventDefault();
      this.captureEditorDraft();
      if (this.creationState && !await this.abandonCreation()) return;
      const actor = this.actorCollection?.get?.(target.dataset.actorId);
      if (actor) this.selectActor(actor);
      await this.render({ force: true });
    }

    static async _selectActorEditorTabAction(event, target) {
      event.preventDefault();
      const actor = this.selectedActor;
      if (actor) this.selectEditorTab(target.dataset.editorTab, actor.type);
      await this.render({ force: true });
    }

    static async _saveActorAction(event) {
      event.preventDefault();
      if (this.savingActor) return;
      const actor = this.selectedActor;
      this.captureEditorDraft();
      try {
        if (!actor || !this.canManageActor() || actor.isOwner === false
          || actor.canUserModify?.(globalThis.game?.user, 'update') === false) {
          throw new Error('액터가 삭제되었거나 수정할 권한이 없습니다. 입력을 보존했습니다.');
        }
        if (!this.form?.querySelectorAll) {
          const update = buildActorWorkbenchUpdate(
            actor,
            readActorEditForm(this.form)
          );
          if (Object.keys(update).length) requireWriteResult(await actor.update(update), '액터 저장');
        } else if (!await this.saveActorDraft(actor)) return;
        globalThis.ui?.notifications?.info?.(`${actor.name} 변경 사항을 저장했습니다.`);
        await this.render({ force: true });
      } catch (error) {
        globalThis.ui?.notifications?.error?.(`저장하지 못했습니다: ${error.message}`);
      }
    }

    _onRender(
      context,
      options,
    ) {
      super._onRender(
        context,
        options,
      );
      this.bindActorDragDrop();
      this.renderedActorId = this.creationState ? null : this.selectedActor?.id;
      this.renderedActorDocument = this.creationState ? null : this.selectedActor;
      globalThis.Hooks?.callAll('ncmWorkbenchStateChanged');
      this.initialControls = readActorControls(this.form);
      if (this.selectedActor && this.form?.querySelector('[data-token-detection]')) {
        this.initialControls['field:prototypeToken.detectionModes'] = JSON.stringify(
          detectionModeList(this.selectedActor.toObject().prototypeToken?.detectionModes),
        );
      }
      if (this.selectedActor && this.form?.querySelector('[data-actor-habitat]')) {
        this.initialControls['field:system.details.habitat.value'] = JSON.stringify(
          this.selectedActor.toObject().system?.details?.habitat?.value ?? [],
        );
      }
      const values = this.drafts.records.get(this.renderedActorId)?.values ?? {};
      for (const [name, value] of Object.entries(values)) {
        const control = editorFormControl(
          this.form,
          name
        );
        if (!control) continue;
        if (control.multiple) {
          for (const option of control.options) option.selected = value.includes(option.value);
        } else if (control.type === 'checkbox') control.checked = value;
        else control.value = value;
        const picker = control.closest?.('.ncm-actor-workbench__color-field')?.querySelector('[data-token-color-picker]');
        if (picker) picker.value = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#ffffff';
      }
      this.refreshCombatPreview();
      const captureAndPreview = event => {
        if (event?.target?.matches?.('[data-token-color-picker]')) {
          const input = event.target.closest('label')?.querySelector('[data-actor-edit]');
          if (input) input.value = event.target.value;
        } else if (event?.target?.matches?.('.ncm-actor-workbench__color-field [data-actor-edit]')) {
          const picker = event.target.closest('.ncm-actor-workbench__color-field')?.querySelector('[data-token-color-picker]');
          if (picker) picker.value = /^#[0-9a-f]{6}$/i.test(event.target.value) ? event.target.value : '#ffffff';
        }
        this.captureEditorDraft();
        if (/^field:system\.(abilities|skills)\./.test(event?.target?.name ?? '')) this.refreshCombatPreview();
      };
      this.form?.addEventListener?.(
        'input',
        captureAndPreview,
      );
      this.form?.addEventListener?.(
        'change',
        captureAndPreview,
      );
      const search = this.element?.querySelector?.('[name="actorSearch"]');
      search?.addEventListener(
        'input',
        () => {
        this.setBrowserState(
          this.activeType,
          { search: search.value }
        );
        for (const row of this.element.querySelectorAll('[data-actor-id]')) {
          row.hidden = !row.textContent.toLocaleLowerCase('ko').includes(search.value.trim().toLocaleLowerCase('ko'));
        }
      }
      );
      const dropZone = this.element?.querySelector?.('[data-owned-item-drop]');
      dropZone?.addEventListener(
        'dragover',
        event => event.preventDefault()
      );
      dropZone?.addEventListener(
        'drop',
        async event => {
        event.preventDefault();
        event.stopPropagation();
        try {
          const data = JSON.parse(event.dataTransfer.getData('text/plain'));
          if (data.type !== 'Item' || !data.uuid) return;
          await this.importOwnedItem(data.uuid);
        } catch (error) { globalThis.ui?.notifications?.error?.(error.message); }
      }
      );
      for (const name of ['actorImg', 'tokenImg']) {
        const control = editorFormControl(
          this.form,
          name,
        );
        const preview = this.element?.querySelector?.(`[data-image-preview="${name}"]`);
        if (!control || !preview) continue;
        preview.src = control.value || 'icons/svg/mystery-man.svg';
        control.addEventListener(
          'input',
          () => {
            preview.src = control.value || 'icons/svg/mystery-man.svg';
          },
        );
      }
    }

    clearActorDropHighlights() {
      for (const target of this.element?.querySelectorAll?.('[data-actor-drop-folder]') ?? []) {
        target.classList.remove('is-drop-target');
      }
    }

    bindActorDragDrop() {
      for (const row of this.element?.querySelectorAll?.('[data-actor-id][draggable="true"]') ?? []) {
        row.addEventListener(
          'dragstart',
          (event) => this.onActorDragStart(event),
        );
        row.addEventListener(
          'dragend',
          () => this.clearActorDropHighlights(),
        );
      }
      if (!this.canManageActor()) return;
      for (const target of this.element?.querySelectorAll?.('[data-actor-drop-folder]') ?? []) {
        target.addEventListener(
          'dragover',
          (event) => {
            if (!Array.from(event.dataTransfer?.types ?? []).includes('text/plain')) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            this.clearActorDropHighlights();
            target.classList.add('is-drop-target');
          },
        );
        target.addEventListener(
          'dragleave',
          (event) => {
            if (!target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
          },
        );
        target.addEventListener(
          'drop',
          (event) => this.onActorDrop(event),
        );
      }
    }

    onActorDragStart(event) {
      const actorId = event.currentTarget?.dataset?.actorId;
      const actor = this.actorCollection?.get?.(actorId);
      if (!this.canManageActor() || !isSupportedActor(actor) || !event.dataTransfer) {
        event.preventDefault();
        return false;
      }
      event.dataTransfer.setData(
        'text/plain',
        JSON.stringify(actor.toDragData()),
      );
      event.dataTransfer.effectAllowed = 'copyMove';
      return true;
    }

    async onActorDrop(event) {
      event.preventDefault();
      event.stopPropagation();
      this.clearActorDropHighlights();
      if (!this.canManageActor()) return false;
      let actor;
      try {
        const data = JSON.parse(event.dataTransfer?.getData('text/plain') ?? '');
        if (data?.type !== 'Actor') return false;
        const match = this.packId
          ? /^Compendium\.([^.]+\.[^.]+)\.Actor\.([^.]+)$/.exec(data.uuid ?? '')
          : /^Actor\.([^.]+)$/.exec(data.uuid ?? '');
        const actorId = data.uuid ? (this.packId ? match?.[1] === this.packId ? match[2] : null : match?.[1]) : data.id;
        actor = this.actorCollection?.get?.(actorId);
      } catch {
        return false;
      }
      if (!isSupportedActor(actor) || this.movingActorIds.has(actor.id)) return false;
      if (actor.canUserModify?.(
        globalThis.game.user,
        'update',
      ) === false) {
        globalThis.ui?.notifications?.warn?.('이 액터를 이동할 권한이 없습니다.');
        return false;
      }
      const destination = event.currentTarget?.dataset?.actorDropFolder;
      if (destination === undefined) return false;
      const folderId = destination || null;
      const folder = folderId ? this.actorFolders?.get?.(folderId) : null;
      if (folderId && folder?.type !== 'Actor') {
        globalThis.ui?.notifications?.warn?.('이동할 액터 폴더를 찾을 수 없습니다.');
        return false;
      }
      if ((actor.folder?.id ?? null) === folderId) return false;
      this.captureEditorDraft();
      this.captureActorCreationDraft();
      this.movingActorIds.add(actor.id);
      try {
        requireWriteResult(await actor.update({ folder: folderId }), '액터 폴더 이동');
        for (const type of BROWSER_TYPES) {
          if (this.browserStateFor(type).selectedActorId !== actor.id) continue;
          this.setBrowserState(
            type,
            { selectedActorId: null },
          );
        }
        globalThis.ui?.notifications?.info?.(`${actor.name} 액터를 ${folder?.name ?? '최상위'}로 이동했습니다.`);
        await this.render({ force: true });
        return true;
      } catch (error) {
        globalThis.ui?.notifications?.error?.(`액터 이동에 실패했습니다: ${error.message}`);
        return false;
      } finally {
        this.movingActorIds.delete(actor.id);
      }
    }

    static async _pickActorImageAction(
      event,
      target,
    ) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      const name = target.dataset.imageField;
      if (!['actorImg', 'tokenImg'].includes(name)) return;
      const control = editorFormControl(
        this.form,
        name,
      );
      const FilePicker = globalThis.CONFIG?.ux?.FilePicker
        ?? globalThis.foundry?.applications?.apps?.FilePicker;
      if (!control || !FilePicker) return;
      const picker = new FilePicker({
        type: 'image',
        current: control.value,
        callback: (path) => {
          if (editorFormControl(
            this.form,
            name,
          ) !== control) return;
          control.value = path;
          control.dispatchEvent(new Event(
            'input',
            { bubbles: true },
          ));
        },
      });
      await picker.browse();
    }

    static async _openEmbeddedItemAction(
      event,
      target,
    ) {
      event.preventDefault();
      const actor = this.selectedActor;
      const item = actor?.items?.get?.(target.dataset.embeddedItemId) ?? null;
      if (actor && item) {
        this.captureEditorDraft();
        openEmbeddedItemWorkbench(
          actor,
          item,
        );
      }
    }

    static async _createEmbeddedItemAction(
      event,
      target
    ) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      const actor = this.selectedActor;
      if (!actor?.createEmbeddedDocuments || !actor.isOwner) return;
      this.captureEditorDraft();
      if (!await prepareItemWorkbenchTransition()) return;
      const type = target?.dataset?.itemType || creationFormValue(
        this.form,
        'embeddedItemType'
      ) || 'feat';
      if (!(type in itemTypeChoices())) throw new Error('설치된 시스템의 아이템 유형을 선택하십시오.');
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        type,
        name: creationFormValue(
          this.form,
          'embeddedItemName'
        ).trim() || embeddedItemCreateName(type),
      }]);
      if (item) openEmbeddedItemWorkbench(actor, item);
      await this.render({ force: true });
    }

    static async _duplicateEmbeddedItemAction(event, target) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      const actor = this.selectedActor;
      const item = actor?.items?.get?.(target.dataset.embeddedItemId) ?? null;
      if (!actor || !item) return;
      await createEmbeddedItemContext(actor, item).duplicate();
      await this.render({ force: true });
    }

    static async _deleteEmbeddedItemAction(event, target) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      const actor = this.selectedActor;
      const item = actor?.items?.get?.(target.dataset.embeddedItemId) ?? null;
      if (!actor || !item) return;
      if (!await this.confirmChange(
        '소유 항목 삭제',
        '<p>선택한 액터의 이 항목을 삭제하시겠습니까?</p>'
      )) return;
      await createEmbeddedItemContext(actor, item).remove();
      await this.render({ force: true });
    }

    static async _newActorAction(
      event,
      target,
    ) {
      event.preventDefault();
      this.captureEditorDraft();
      if (this.creationState && !await this.abandonCreation()) return;
      const type = target?.dataset?.actorType ?? this.activeType;
      const folderId = this.browserStateFor(this.activeType).folderId;
      if (!ACTOR_TYPES.includes(type)) return;
      this.setBrowserState(
        type,
        { folderId, selectedActorId: null },
      );
      this.beginActorCreation(type);
      await this.render({ force: true });
    }

    static async _selectNpcCreationMethodAction(event, target) {
      event.preventDefault();
      this.captureActorCreationDraft();
      this.selectNpcCreationMethod(target.dataset.creationMethod);
      await this.render({ force: true });
    }

    static async _cancelActorCreationAction(event) {
      event.preventDefault();
      if (!await this.abandonCreation()) return;
      await this.render({ force: true });
    }

    static async _saveNewActorAction(event) {
      event.preventDefault();
      if (!this.canManageActor() || this.savingActor || !this.creationState) return;
      this.captureActorCreationDraft();
      this.savingActor = true;
      const unlock = lockWorkbenchControls(this);
      let actor;
      try {
        const source = buildActorCreateSource(
          this.creationState.type,
          {
            name: creationFormValue(
              this.form,
              'actorName',
            ),
            img: creationFormValue(
              this.form,
              'actorImg',
            ),
            folderId: this.actorCreationFolderId(),
          },
        );
        actor = this.packId
          ? await createPackDocument(
            this.packId,
            'Actor',
            source,
          )
          : requireWriteResult(
            await globalThis.Actor?.create?.(source),
            '액터 생성',
          );
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      } finally {
        unlock();
        this.savingActor = false;
      }
      if (actor) {
        this.selectActor(actor);
        this.creationState = null;
      }
      await this.render({ force: true });
    }

    static async _validateSbiImportAction(event) {
      event.preventDefault();
      if (this.creationState?.type !== 'npc' || this.creationState.method !== 'sbi') return;
      try {
        const rawPayload = creationFormValue(this.form, 'sbiPayload');
        this.setActorCreationDraft({ sbiPayload: rawPayload });
        const validation = validateStatblockImport(rawPayload);
        this.sbiResult = {
          previewName: validation.preview.name ?? '이름 없음',
          imported: false,
          unmatched: [],
        };
        this.sbiError = null;
      } catch (error) {
        this.sbiResult = null;
        this.sbiError = error.message;
      }
      await this.render({ force: true });
    }

    static async _importSbiAction(event) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      if (this.packId) {
        globalThis.ui?.notifications?.warn?.('컴펜디움에서는 직접 작성으로 액터를 등록하십시오. SBI 임포트는 월드에서 사용합니다.');
        return;
      }
      if (this.creationState?.type !== 'npc' || this.creationState.method !== 'sbi') return;
      if (this.importBusy) return;
      this.importBusy = true;
      try {
        const rawPayload = creationFormValue(this.form, 'sbiPayload');
        this.setActorCreationDraft({ sbiPayload: rawPayload });
        const result = await importLocalizedStatblock({
          rawPayload,
          folderId: this.actorCreationFolderId(),
        });
        this.sbiResult = {
          previewName: result.actor5e.name,
          imported: true,
          unmatched: result.unmatched,
          importIssues: result.importIssues,
        };
        this.sbiError = null;
        this.selectActor(result.actor5e);
        this.selectEditorTab(
          'basic',
          'npc',
        );
        this.creationState = null;
        globalThis.ui?.notifications?.info?.(`${result.actor5e.name} 생성 및 한글화를 완료했습니다.`);
      } catch (error) {
        this.sbiError = error.message;
        if (error.actor5e) {
          this.sbiResult = { previewName: error.actor5e.name, imported: true, actorId: error.actor5e.id, recovery: error.recovery, importIssues: error.message, unmatched: [] };
          this.selectActor(error.actor5e);
          this.creationState = null;
        } else this.sbiResult = null;
      } finally {
        this.importBusy = false;
      }
      await this.render({ force: true });
    }

    itemGroups(actor) {
      return actorItemGroups(
        actor,
        this.activeEditorTabFor(actor.type),
      );
    }

    async importOwnedItem(uuid) {
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner) return;
      if (!await prepareItemWorkbenchTransition()) return;
      const item = await globalThis.fromUuid?.(String(uuid).trim());
      if (item?.documentName !== 'Item') throw new Error('월드 또는 컴펜디움의 아이템 UUID를 입력하십시오.');
      const created = await copyItemToActor(
        actor,
        item,
      );
      await this.render({ force: true });
      if (created) openEmbeddedItemWorkbench(
        actor,
        created
      );
      return created;
    }

    static async _importOwnedItemAction(event) {
      event.preventDefault();
      try { await this.importOwnedItem(creationFormValue(
        this.form,
        'itemImportUuid'
      )); }
      catch (error) { globalThis.ui?.notifications?.error?.(error.message); }
    }

    static async _openItemLibraryAction(
      event,
      target,
    ) {
      event.preventDefault();
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner) return;
      this.captureEditorDraft();
      openItemLibrary({
        actor,
        type: target?.dataset?.itemType ?? '',
        beforeCopy: prepareItemWorkbenchTransition,
        afterCopy: async (item) => {
          await this.render({ force: true });
          openEmbeddedItemWorkbench(
            actor,
            item,
          );
        },
      });
    }

    static async _discardActorDraftAction(event) {
      event.preventDefault();
      if (!this.selectedActor || !await this.confirmChange(
        '입력 버리기',
        '<p>현재 액터에 보관한 입력을 버리시겠습니까?</p>'
      )) return;
      this.drafts.records.delete(this.selectedActor.id);
      this.initialControls = {};
      await this.render({ force: true });
    }

    static async _discardDeletedActorDraftAction(event, target) {
      event.preventDefault();
      const id = target.dataset.actorId;
      if (this.actorCollection?.get?.(id) || !this.drafts.records.has(id)
        || !await this.confirmChange('삭제된 액터 입력 버리기', '<p>삭제된 액터의 보관 입력을 버리시겠습니까?</p>')) return;
      this.drafts.records.delete(id);
      if (this.renderedActorId === id) this.renderedActorId = null;
      await this.render({ force: true });
    }

    static async _duplicateActorAction(event) {
      event.preventDefault();
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner) return;
      this.captureEditorDraft();
      const clone = await actor.clone(
        { name: `${actor.name} (복제)` },
        { save: true }
      );
      this.selectActor(clone);
      await this.render({ force: true });
    }

    static async _deleteActorAction(event) {
      event.preventDefault();
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner || !await this.confirmChange(
        '액터 삭제',
        '<p>선택한 액터와 소유 항목을 삭제하시겠습니까?</p>'
      )) return;
      requireWriteResult(await actor.delete(), '액터 삭제');
      this.drafts.records.delete(actor.id);
      this.renderedActorId = null;
      this.setBrowserState(
        this.activeType,
        { selectedActorId: null }
      );
      await this.render({ force: true });
    }

    static async _createActorFolderAction(event) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      createFolderInWorkbench({
        type: 'Actor', pack: this.packId, parent: this.browserStateFor(this.activeType).folderId,
        afterCreate: () => this.render({ force: true }),
      });
    }

    static async _editActorFolderAction(event) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      const folder = this.actorFolders?.get?.(this.browserStateFor(this.activeType).folderId);
      if (folder) editDocument(
        folder,
        { roots: ['name', 'color', 'folder', 'sorting', 'flags'], afterSave: () => this.render({ force: true }) },
      );
    }

    static async _deleteActorFolderAction(event) {
      event.preventDefault();
      if (!this.canManageActor()) return;
      const folder = this.actorFolders?.get?.(this.browserStateFor(this.activeType).folderId);
      if (!folder || !await this.confirmChange(
        '폴더 삭제',
        '<p>폴더를 삭제하고 내용은 상위 폴더로 옮기시겠습니까?</p>'
      )) return;
      await folder.delete({ deleteSubfolders: false, deleteContents: false });
    }

    static async _editOwnershipAction(event) {
      event.preventDefault();
      this.captureEditorDraft();
      const actor = this.selectedActor;
      if (actor) editOwnership(actor, { canEdit: () => this.canManageActor(), afterSave: () => this.render({ force: true }) });
    }

    static async _createActorEffectAction(event) {
      event.preventDefault();
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner) return;
      const [effect] = await actor.createEmbeddedDocuments(
        'ActiveEffect',
        [{ name: creationFormValue(
          this.form,
          'effectName'
        ).trim() || '새 액터 효과', img: 'icons/svg/aura.svg', transfer: false, system: { changes: [] } }]
      );
      if (effect) editEffect(
        effect,
        { canEdit: () => this.canManageActor(), afterSave: () => this.render({ force: true }) },
      );
    }

    static async _editActorEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const actor = this.selectedActor;
      const effect = actor?.effects?.get?.(target.dataset.effectId);
      if (this.canManageActor() && actor?.isOwner && effect) editEffect(
        effect,
        { canEdit: () => this.canManageActor(), afterSave: () => this.render({ force: true }) },
      );
    }

    static async _toggleActorEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const actor = this.selectedActor;
      const effect = actor?.effects?.get?.(target.dataset.effectId);
      if (!this.canManageActor() || !actor?.isOwner || !effect) return;
      await effect.update({ disabled: !effect.disabled });
    }

    static async _duplicateActorEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const actor = this.selectedActor;
      const effect = actor?.effects?.get?.(target.dataset.effectId);
      if (!this.canManageActor() || !actor?.isOwner || !effect) return;
      const source = effect.toObject();
      delete source._id;
      delete source._stats;
      await actor.createEmbeddedDocuments(
        'ActiveEffect',
        [{ ...source, name: `${effect.name} (복제)` }]
      );
      await this.render({ force: true });
    }

    static async _deleteActorEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const actor = this.selectedActor;
      const effect = actor?.effects?.get?.(target.dataset.effectId);
      if (!this.canManageActor() || !actor?.isOwner || !effect || !await this.confirmChange(
        '효과 삭제',
        '<p>이 액터 효과를 삭제하시겠습니까?</p>'
      )) return;
      await effect.delete();
    }

    static async _openNativeActorAction(event) {
      event.preventDefault();
      this.captureEditorDraft();
      const actor = this.selectedActor;
      if (this.canManageActor() && actor?.isOwner) editDocument(
        actor,
        { afterSave: () => this.render({ force: true }) },
      );
    }

    static async _openTokenConfigAction(event) {
      event.preventDefault();
      this.captureEditorDraft();
      const actor = this.selectedActor;
      if (this.canManageActor() && actor?.isOwner) editToken(
        actor,
        () => this.render({ force: true }),
      );
    }

    static async _applyTokenVisionDefaultsAction(event) {
      event.preventDefault();
      if (!this.canManageActor() || !this.selectedActor?.isOwner) return;
      applyTokenVisionDefaults(this.form);
      this.captureEditorDraft();
    }

    async changeTokenDetection(index = null) {
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner) return;
      const rows = readTokenDetectionInputs(this.form) ?? [];
      if (index === null) rows.push({ id: '', enabled: true, range: 0 });
      else {
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
        rows.splice(
          index,
          1,
        );
      }
      const source = this.form?.querySelector('[data-detection-source]');
      if (!source) return;
      this.captureEditorDraft();
      // Capture a structural edit before rendering the new rows. It is not a document write.
      this.drafts.capture(
        actor,
        { 'field:prototypeToken.detectionModes': JSON.stringify(rows) },
        this.initialControls,
      );
      const scroll = this.element?.querySelector('.ncm-workbench__scroll');
      const scrollTop = scroll?.scrollTop ?? 0;
      this.changingDetectionRows = true;
      try {
        await this.render({ force: true });
      } finally {
        this.changingDetectionRows = false;
      }
      const renderedScroll = this.element?.querySelector('.ncm-workbench__scroll');
      if (renderedScroll) renderedScroll.scrollTop = scrollTop;
    }

    static async _addTokenDetectionAction(event) {
      event.preventDefault();
      await this.changeTokenDetection();
    }

    async changeActorHabitat(index = null) {
      const actor = this.selectedActor;
      if (!this.canManageActor() || !actor?.isOwner) return;
      const rows = readHabitatInputs(this.form);
      if (!rows) return;
      if (index === null) rows.push({ type: '', subtype: '' });
      else {
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
        rows.splice(
          index,
          1,
        );
      }
      this.captureEditorDraft();
      this.drafts.capture(
        actor,
        { 'field:system.details.habitat.value': JSON.stringify(rows) },
        this.initialControls,
      );
      this.changingDetectionRows = true;
      try { await this.render({ force: true }); }
      finally { this.changingDetectionRows = false; }
    }

    static async _addActorHabitatAction(event) {
      event.preventDefault();
      await this.changeActorHabitat();
    }

    static async _removeActorHabitatAction(
      event,
      target,
    ) {
      event.preventDefault();
      await this.changeActorHabitat(Number(target.dataset.habitatIndex));
    }

    static async _removeTokenDetectionAction(
      event,
      target,
    ) {
      event.preventDefault();
      await this.changeTokenDetection(Number(target.dataset.detectionIndex));
    }

    static async _dismissSbiResultAction(event) {
      event.preventDefault();
      this.sbiResult = null;
      await this.render({ force: true });
    }

    static async _retrySbiLocalizationAction(event) {
      event.preventDefault();
      if (this.importBusy || !this.sbiResult?.recovery) return;
      this.importBusy = true;
      try {
        const { resumeStatblockLocalization } = await import('../statblock-importer/service.mjs');
        const result = await resumeStatblockLocalization(this.sbiResult.recovery);
        this.sbiResult = { previewName: result.actor5e.name, imported: true, unmatched: result.unmatched, importIssues: result.importIssues };
      } catch (error) {
        this.sbiResult.importIssues = error.message;
      } finally { this.importBusy = false; }
      await this.render({ force: true });
    }
  }

  ActorWorkbenchClass = NihilActorWorkbench;
  return ActorWorkbenchClass;
}

export function openActorWorkbench(options = {}) {
  if (!canUseActorWorkbench()) return null;
  const Class = getActorWorkbenchClass();
  if (!actorWorkbenchInstance || actorWorkbenchInstance.state === Class.RENDER_STATES?.CLOSED) {
    actorWorkbenchInstance = new Class();
  }
  actorWorkbenchInstance.open(options);
  return actorWorkbenchInstance;
}

export function refreshActorWorkbench() {
  if (!actorWorkbenchInstance) return false;
  const Class = getActorWorkbenchClass();
  if (actorWorkbenchInstance.state === Class.RENDER_STATES?.CLOSED) return false;
  actorWorkbenchInstance.render({ force: true });
  return true;
}

export function isActorWorkbenchOpen() {
  return Boolean(actorWorkbenchInstance?.rendered);
}

export async function toggleActorWorkbench() {
  if (isActorWorkbenchOpen()) await actorWorkbenchInstance.close();
  else {
    openActorWorkbench();
    await actorWorkbenchInstance.render({ force: true });
  }
  return isActorWorkbenchOpen();
}

export function syncUpdatedActor(actor) {
  if (!actorWorkbenchInstance || actor.pack || !isSupportedActor(actor)) return false;
  if (actorWorkbenchInstance.movingActorIds.has(actor.id)) return true;
  for (const type of [actor.type, 'all']) {
    const state = actorWorkbenchInstance.browserStateFor(type);
    if (state.selectedActorId !== actor.id) continue;
    actorWorkbenchInstance.setBrowserState(
      type,
      { folderId: actor.folder?.id ?? null },
    );
  }
  return refreshActorWorkbench();
}

export function syncDeletedActor(
  actorId,
  parentFolderId = null,
  packId = null,
) {
  if (packId) return false;
  if (!actorWorkbenchInstance) return false;
  actorWorkbenchInstance.captureEditorDraft();
  for (const type of BROWSER_TYPES) {
    const state = actorWorkbenchInstance.browserStateFor(type);
    if (state.selectedActorId === actorId) {
      actorWorkbenchInstance.setBrowserState(type, { selectedActorId: null, folderId: parentFolderId });
    }
  }
  return refreshActorWorkbench();
}

export function syncDeletedActorFolder(folderId, parentFolderId = null) {
  if (!actorWorkbenchInstance) return false;
  actorWorkbenchInstance.syncDeletedFolder(folderId, parentFolderId);
  return refreshActorWorkbench();
}

const packActorWorkbenches = new Map();

export async function openPackActorWorkbench(
  packId,
  actorId = null,
) {
  if (!canUseActorWorkbench()) return null;
  const pack = requireModulePack(
    packId,
    'Actor',
  );
  await loadPackDocuments(pack);
  const Class = getActorWorkbenchClass();
  let app = packActorWorkbenches.get(packId);
  if (!app || app.state === Class.RENDER_STATES?.CLOSED) {
    app = new Class({ id: `ncm-pack-actor-${packId.replaceAll('.', '-')}` });
    app.packId = packId;
    packActorWorkbenches.set(
      packId,
      app,
    );
  }
  await app.open({ actorId, activeType: 'all' });
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}

export function refreshPackActorWorkbenches() {
  for (const app of packActorWorkbenches.values()) {
    if (app.rendered) app.render({ force: true });
  }
}
