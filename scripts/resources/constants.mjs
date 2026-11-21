// 캐릭터별 추가 자원 관리(2026-11-21 이관): v13 luxterra-resource-manager 1.1.1의 자원 관리 기능을 워크벤치로 옮겼다.
// 앙그라·위그드라실 피해 타입과 Dice So Nice 색상은 옮기지 않는다(룩스테라 컴펜디움 모듈 담당).
export const MODULE_ID = "nihil-compendium-module";
export const LEGACY_MODULE_ID = "luxterra-resource-manager";

export const SETTINGS = {
  RESOURCE_DEFINITIONS: "resourceDefinitions",
  MANAGED_ACTORS: "managedActorUuids",
  MIGRATION_VERSION: "resourceMigrationVersion"
};

/** 옛 모듈이 월드 설정에 남긴 키. 이관 입력으로만 읽는다. */
export const LEGACY_SETTINGS = {
  RESOURCE_DEFINITIONS: "resourceDefinitions",
  MANAGED_ACTORS: "managedActorUuids"
};

export const FLAGS = {
  ACTOR_RESOURCES: "resources"
};

export const TEMPLATES = {
  RESOURCE_MANAGER: `modules/${MODULE_ID}/templates/resources/resource-manager.hbs`,
  ACTOR_RESOURCE_VIEWER: `modules/${MODULE_ID}/templates/resources/actor-resource-viewer.hbs`
};

export const RESOURCE_ADJUSTMENTS = [1, 5, 10, 25, 50];

export const RESOURCE_MANAGER_TABS = {
  CREATE: "create",
  STATUS: "status",
  ACTORS: "actors"
};

/** 1: 옛 luxterra-resource-manager 설정·Actor flag를 이 모듈 범위로 복사. */
export const MIGRATION_VERSION = 1;
