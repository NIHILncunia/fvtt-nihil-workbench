import { MODULE_ID } from "./constants.mjs";
import { getActorResourceViewerClass } from "./actor-resource-viewer.mjs";
import { canUserViewActorResources } from "./resource-permissions.mjs";

const VIEW_RESOURCES_ACTION = `${MODULE_ID}-view-actor-resources`;

export function registerActorResourceSheetControl() {
  Hooks.on(
    "getHeaderControlsApplicationV2",
    addActorResourceControl
  );
}

function addActorResourceControl(
  app,
  controls
) {
  const actor = app.actor;
  if ( app.document !== actor ) return;
  if ( !canUserViewActorResources(
    game.user,
    actor
  ) ) return;

  if ( controls.some(control => control.action === VIEW_RESOURCES_ACTION) ) return;

  controls.push({
    action: VIEW_RESOURCES_ACTION,
    icon: "fa-solid fa-bars-progress",
    label: "이 액터의 자원 확인",
    ownership: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    onClick: () => {
      const ActorResourceViewer = getActorResourceViewerClass();
      new ActorResourceViewer(actor).render({ force: true });
    }
  });
}
