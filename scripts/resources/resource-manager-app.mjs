import {
  MODULE_ID,
  RESOURCE_ADJUSTMENTS,
  RESOURCE_MANAGER_TABS,
  TEMPLATES
} from "./constants.mjs";
import {
  archiveResourceDefinition,
  createResourceDefinition,
  getResourceDefinition,
  getSortedResourceDefinitions,
  updateResourceDefinition
} from "./resource-definitions.mjs";
import {
  adjustActorResourceValue,
  adjustResourceForActors,
  getManagedActorRows,
  getManagedActors,
  getManagedActorUuids,
  getResourceStatusRows,
  saveManagedActorUuids,
  setActorResourceValue,
  synchronizeAllActorResources
} from "./actor-resources.mjs";

// Foundry 전역은 시험(node)에서 없으므로 클래스는 처음 쓸 때 만든다.
let ResourceManagerAppClass = null;

export function getResourceManagerAppClass() {
  if ( ResourceManagerAppClass ) return ResourceManagerAppClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;

  ResourceManagerAppClass = class ResourceManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.activeTab = RESOURCE_MANAGER_TABS.CREATE;
    this.selectedResourceId = null;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-resource-manager`,
    window: {
      title: "자원 관리",
      resizable: true
    },
    position: {
      width: 1120,
      height: 760
    },
    tag: "section",
    classes: ["ncm-resource-manager"]
  };

  static PARTS = {
    body: {
      template: TEMPLATES.RESOURCE_MANAGER
    }
  };

  _canRender(options) {
    if ( !game.user?.isGM ) {
      ui.notifications.warn("자원 관리는 GM만 사용할 수 있습니다.");
      return false;
    }
    return super._canRender(options);
  }

  async _prepareContext(options) {
    const resources = getSortedResourceDefinitions();
    this.selectedResourceId = this.#getSelectedResourceId(resources);

    const resourceOptions = resources.map(resource => ({
      ...resource,
      selected: resource.id === this.selectedResourceId
    }));
    const selectedResource = this.selectedResourceId
      ? getResourceDefinition(this.selectedResourceId)
      : null;
    const statusRows = selectedResource
      ? getResourceStatusRows(selectedResource.id)
      : [];
    const managedActorRows = getManagedActorRows();

    return {
      isCreateTab: this.activeTab === RESOURCE_MANAGER_TABS.CREATE,
      isStatusTab: this.activeTab === RESOURCE_MANAGER_TABS.STATUS,
      isActorsTab: this.activeTab === RESOURCE_MANAGER_TABS.ACTORS,
      resources: resourceOptions,
      hasResources: resourceOptions.length > 0,
      selectedResource,
      selectedResourceId: this.selectedResourceId,
      statusRows,
      hasStatusRows: statusRows.length > 0,
      adjustments: RESOURCE_ADJUSTMENTS,
      managedActorRows,
      managedActorCount: getManagedActorUuids().length
    };
  }

  async _onRender(
    context,
    options
  ) {
    await super._onRender(
      context,
      options
    );

    this.#bindTabButtons();
    this.#bindCreateTab();
    this.#bindStatusTab();
    this.#bindActorsTab();
  }

  #render() {
    return this.render({ force: true });
  }

  #bindTabButtons() {
    this.element.querySelectorAll("[data-action='switch-tab']").forEach(button => {
      button.addEventListener("click", event => {
        const tab = event.currentTarget.dataset.tab;
        if ( !Object.values(RESOURCE_MANAGER_TABS).includes(tab) ) return;
        this.activeTab = tab;
        this.#render();
      });
    });
  }

  #bindCreateTab() {
    this.element.querySelector("[data-action='create-resource']")
      ?.addEventListener("click", () => this.#createResource());
  }

  #bindStatusTab() {
    const panel = this.element.querySelector("[data-resource-status]");
    if ( !panel ) return;

    panel.querySelector("[name='selectedResourceId']")
      ?.addEventListener("change", event => {
        this.selectedResourceId = event.currentTarget.value || null;
        this.#render();
      });

    panel.querySelector("[data-action='update-resource-definition']")
      ?.addEventListener("click", () => this.#updateResourceDefinition());

    panel.querySelector("[data-action='archive-resource']")
      ?.addEventListener("click", () => this.#archiveResource());

    panel.querySelectorAll("[data-action='bulk-adjust-resource']").forEach(button => {
      button.addEventListener("click", event => {
        this.#bulkAdjustResource(Number(event.currentTarget.dataset.amount ?? 0));
      });
    });

    panel.querySelectorAll("[data-action='adjust-resource']").forEach(button => {
      button.addEventListener("click", event => this.#adjustRowResource(event.currentTarget));
    });

    panel.querySelectorAll("[data-action='set-resource']").forEach(button => {
      button.addEventListener("click", event => this.#setRowResource(event.currentTarget));
    });
  }

  #bindActorsTab() {
    this.element.querySelector("[data-action='save-managed-actors']")
      ?.addEventListener("click", () => this.#saveManagedActors());

    this.element.querySelector("[data-action='check-all-managed-actors']")
      ?.addEventListener("click", () => this.#setAllManagedActorCheckboxes(true));

    this.element.querySelector("[data-action='uncheck-all-managed-actors']")
      ?.addEventListener("click", () => this.#setAllManagedActorCheckboxes(false));
  }

  #setAllManagedActorCheckboxes(checked) {
    this.element.querySelectorAll("[name='managedActorUuid']").forEach(input => {
      input.checked = checked;
    });
  }

  async #createResource() {
    if ( !this.#assertGameMaster() ) return;

    try {
      const definition = await createResourceDefinition({
        name: this.element.querySelector("[name='resourceName']")?.value,
        max: this.element.querySelector("[name='resourceMax']")?.value,
        startFromZero: this.element.querySelector("[name='startFromZero']")?.checked ?? true
      });

      await synchronizeAllActorResources();
      this.selectedResourceId = definition.id;
      ui.notifications.info(`자원 '${definition.name}'을 생성했습니다.`);
      await this.#render();
    } catch (error) {
      ui.notifications.error(error.message);
    }
  }

  async #updateResourceDefinition() {
    if ( !this.#assertGameMaster() || !this.selectedResourceId ) return;

    try {
      const definition = await updateResourceDefinition(
        this.selectedResourceId,
        {
          name: this.element.querySelector("[name='definitionName']")?.value,
          max: this.element.querySelector("[name='definitionMax']")?.value
        }
      );

      if ( !definition ) return;
      ui.notifications.info(`자원 '${definition.name}'의 설정을 저장했습니다.`);
      await this.#render();
    } catch (error) {
      ui.notifications.error(error.message);
    }
  }

  async #archiveResource() {
    if ( !this.#assertGameMaster() || !this.selectedResourceId ) return;

    const definition = getResourceDefinition(this.selectedResourceId);
    if ( !definition ) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "자원 비활성화" },
      content: `<p>'${escapeHtml(definition.name)}' 자원을 비활성화합니다. 기존 PC 값은 보존됩니다.</p>`,
      modal: true,
      yes: { label: "비활성화" },
      no: { label: "취소" }
    });

    if ( !confirmed ) return;

    await archiveResourceDefinition(this.selectedResourceId);
    this.selectedResourceId = null;
    ui.notifications.info(`자원 '${definition.name}'을 비활성화했습니다.`);
    await this.#render();
  }

  async #bulkAdjustResource(amount) {
    if ( !this.#assertGameMaster() || !this.selectedResourceId ) return;

    const actors = getManagedActors();
    if ( !actors.length ) {
      ui.notifications.warn("관리 대상 PC가 없습니다.");
      return;
    }

    await adjustResourceForActors(
      this.selectedResourceId,
      amount,
      actors
    );
    await this.#render();
  }

  async #adjustRowResource(button) {
    if ( !this.#assertGameMaster() || !this.selectedResourceId ) return;

    const actor = await fromUuid(button.closest("[data-actor-uuid]")?.dataset.actorUuid);
    if ( !actor ) return;

    await adjustActorResourceValue(
      actor,
      this.selectedResourceId,
      Number(button.dataset.amount ?? 0)
    );
    await this.#render();
  }

  async #setRowResource(button) {
    if ( !this.#assertGameMaster() || !this.selectedResourceId ) return;

    const row = button.closest("[data-actor-uuid]");
    const actor = await fromUuid(row?.dataset.actorUuid);
    const value = row?.querySelector("[name='resourceValue']")?.value;
    if ( !actor ) return;

    await setActorResourceValue(
      actor,
      this.selectedResourceId,
      value
    );
    await this.#render();
  }

  async #saveManagedActors() {
    if ( !this.#assertGameMaster() ) return;

    const uuids = Array.from(
      this.element.querySelectorAll("[name='managedActorUuid']:checked")
    ).map(input => input.value);

    await saveManagedActorUuids(uuids);
    ui.notifications.info("관리 대상 PC를 저장했습니다.");
    await this.#render();
  }

  #getSelectedResourceId(resources) {
    if ( this.selectedResourceId && resources.some(resource => resource.id === this.selectedResourceId) ) {
      return this.selectedResourceId;
    }
    return resources[0]?.id ?? null;
  }

  #assertGameMaster() {
    if ( game.user?.isGM ) return true;
    ui.notifications.warn("자원 관리는 GM만 사용할 수 있습니다.");
    return false;
  }
};
  return ResourceManagerAppClass;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}
