import {
  MODULE_ID,
  TEMPLATES
} from "./constants.mjs";
import { getActorResourceRows } from "./actor-resources.mjs";
import { canUserViewActorResources } from "./resource-permissions.mjs";

// Foundry 전역은 시험(node)에서 없으므로 클래스는 처음 쓸 때 만든다.
let ActorResourceViewerClass = null;

export function getActorResourceViewerClass() {
  if ( ActorResourceViewerClass ) return ActorResourceViewerClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;

  ActorResourceViewerClass = class ActorResourceViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(
    actor,
    options = {}
  ) {
    super({
      id: `${MODULE_ID}-actor-resources-${actor.id}`,
      ...options
    });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    window: {
      title: "자원 현황",
      resizable: true
    },
    position: {
      width: 420,
      height: "auto"
    },
    tag: "section",
    classes: ["ncm-actor-resource-viewer"]
  };

  static PARTS = {
    body: {
      template: TEMPLATES.ACTOR_RESOURCE_VIEWER
    }
  };

  get title() {
    return `${this.actor.name} - 자원 현황`;
  }

  _canRender(options) {
    if ( !canUserViewActorResources(
      game.user,
      this.actor
    ) ) {
      ui.notifications.warn("이 캐릭터의 자원을 확인할 권한이 없습니다.");
      return false;
    }
    return super._canRender(options);
  }

  async _prepareContext(options) {
    return {
      actorName: this.actor.name,
      resources: getActorResourceRows(this.actor)
    };
  }
};
  return ActorResourceViewerClass;
}
