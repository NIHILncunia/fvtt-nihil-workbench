import {
  MODULE_ID,
  SETTINGS,
  TEMPLATES
} from "./constants.mjs";
import { getResourceManagerAppClass } from "./resource-manager-app.mjs";
import { containsActorResourceChanges } from "./resource-permissions.mjs";
import { migrateLegacyResources } from "./migration.mjs";
import {
  syncActorResources,
  synchronizeAllActorResources
} from "./actor-resources.mjs";
import { canUserChangeActorResources } from "./resource-permissions.mjs";
import { registerActorResourceSheetControl } from "./actor-resource-controls.mjs";

const RESOURCE_BUTTON_ACTION = "open-ncm-resource-manager";
let registered = false;
let managerApp = null;

/** 같은 월드에 GM이 여럿 접속해도 이관·동기화는 활성 GM 한 명만 한다. */
function isResponsibleGM() {
  const user = globalThis.game?.user;
  if ( !user?.isGM ) return false;
  if ( typeof user.isActiveGM === "boolean" ) return user.isActiveGM;
  return true;
}

export function openResourceManager() {
  if ( !globalThis.game?.user?.isGM ) {
    globalThis.ui?.notifications?.warn("자원 관리는 GM만 사용할 수 있습니다.");
    return null;
  }
  const ResourceManagerApp = getResourceManagerAppClass();
  if ( !managerApp || managerApp.state === ResourceManagerApp.RENDER_STATES?.CLOSED ) {
    managerApp = new ResourceManagerApp();
  }
  managerApp.render({ force: true });
  return managerApp;
}

export function registerResourceSettings() {
  const settings = globalThis.game?.settings;
  if ( !settings?.register ) return false;
  settings.register(MODULE_ID, SETTINGS.RESOURCE_DEFINITIONS, {
    name: "자원 정의 목록",
    hint: "월드 단위로 생성된 자원 정의를 저장합니다.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  settings.register(MODULE_ID, SETTINGS.MANAGED_ACTORS, {
    name: "관리 대상 PC",
    hint: "자원 현황에 표시하고 일괄 조정할 PC UUID 목록입니다.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  settings.register(MODULE_ID, SETTINGS.MIGRATION_VERSION, {
    name: "자원 이관 버전",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  return true;
}

export function injectSettingsResourceButton(html) {
  if ( !globalThis.game?.user?.isGM ) return false;
  const root = html?.querySelector ? html : html?.[0];
  if ( !root?.ownerDocument ) return false;
  if ( root.querySelector(`[data-action="${RESOURCE_BUTTON_ACTION}"]`) ) return false;

  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.dataset.action = RESOURCE_BUTTON_ACTION;
  button.innerHTML = "<i class=\"fa-solid fa-bars-progress\"></i> 자원 관리";
  button.addEventListener("click", () => openResourceManager());

  const workbench = root.querySelector("[data-action=\"open-ncm-workbench\"]");
  if ( workbench ) {
    workbench.after(button);
    return true;
  }
  const heading = Array.from(root.querySelectorAll("h2, h3"))
    .find(element => /게임 설정|Game Settings|Settings/i.test(element.textContent ?? ""));
  if ( heading ) heading.after(button);
  else {
    const first = root.querySelector("button");
    if ( first ) first.before(button);
    else root.prepend(button);
  }
  return true;
}

/** init 단계에서 한 번 부른다. */
export function registerResourceManager() {
  if ( registered || !globalThis.Hooks?.on ) return false;
  registerResourceSettings();
  registerActorResourceSheetControl();
  globalThis.foundry?.applications?.handlebars?.loadTemplates?.([
    TEMPLATES.RESOURCE_MANAGER,
    TEMPLATES.ACTOR_RESOURCE_VIEWER
  ]);

  globalThis.Hooks.once("ready", async () => {
    if ( !isResponsibleGM() ) return;
    try {
      await migrateLegacyResources();
      await synchronizeAllActorResources();
    } catch ( error ) {
      console.error(`${MODULE_ID} | 자원 이관·동기화 실패`, error);
    }
  });

  globalThis.Hooks.on("createActor", async (actor, _options, userId) => {
    if ( !isResponsibleGM() ) return;
    await syncActorResources(actor);
  });

  globalThis.Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    const user = globalThis.game?.users?.get(userId);
    if ( canUserChangeActorResources(user, changes) ) return;
    if ( userId === globalThis.game?.user?.id ) {
      globalThis.ui?.notifications?.warn("자원값은 GM만 변경할 수 있습니다.");
    }
    return false;
  });

  // GM이 값을 바꾸면 열려 있는 관리 창과 플레이어 현황 창을 다시 그린다.
  globalThis.Hooks.on("updateActor", (actor, changes) => {
    if ( !containsActorResourceChanges(changes) ) return;
    if ( managerApp?.rendered ) managerApp.render();
    globalThis.foundry?.applications?.instances?.get?.(`${MODULE_ID}-actor-resources-${actor.id}`)?.render();
  });

  globalThis.Hooks.on("updateSetting", setting => {
    const key = setting?.key ?? "";
    if ( key === `${MODULE_ID}.${SETTINGS.RESOURCE_DEFINITIONS}` || key === `${MODULE_ID}.${SETTINGS.MANAGED_ACTORS}` ) {
      if ( managerApp?.rendered ) managerApp.render();
    }
  });

  registered = true;
  return true;
}
