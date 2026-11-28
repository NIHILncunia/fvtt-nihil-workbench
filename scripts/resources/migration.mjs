import { isModuleActive } from '../shared/compat.mjs';
import {
  FLAGS,
  LEGACY_MODULE_ID,
  LEGACY_SETTINGS,
  MIGRATION_VERSION,
  MODULE_ID,
  SETTINGS
} from "./constants.mjs";

function plainObject(value) {
  if ( typeof value === "string" ) {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * 옛 luxterra-resource-manager 자료를 이 모듈 범위로 옮길 계획을 세운다(순수 함수).
 * 이미 이 모듈에 있는 정의·값은 덮어쓰지 않고, 없는 항목만 채운다. 옛 자료는 지우지 않는다.
 * @returns {{definitions: object|null, managed: object|null, actors: Array<{actor: any, resources: object}>}}
 */
export function planLegacyResourceMigration({
  currentDefinitions,
  legacyDefinitions,
  currentManaged,
  legacyManaged,
  actors = []
}) {
  const current = plainObject(currentDefinitions);
  const legacy = plainObject(legacyDefinitions);
  const definitions = { ...current };
  let definitionsChanged = false;
  for ( const [id, definition] of Object.entries(legacy) ) {
    if ( Object.hasOwn(definitions, id) || !definition || typeof definition !== "object" ) continue;
    definitions[id] = { ...definition, id: definition.id ?? id };
    definitionsChanged = true;
  }

  const managedCurrent = plainObject(currentManaged);
  const managed = { ...managedCurrent };
  let managedChanged = false;
  for ( const [uuid, flag] of Object.entries(plainObject(legacyManaged)) ) {
    if ( flag !== true || managed[uuid] === true ) continue;
    managed[uuid] = true;
    managedChanged = true;
  }

  const actorPlans = [];
  for ( const entry of actors ) {
    const legacyResources = plainObject(entry?.legacyResources);
    if ( !Object.keys(legacyResources).length ) continue;
    const resources = { ...plainObject(entry.currentResources) };
    let changed = false;
    for ( const [id, value] of Object.entries(legacyResources) ) {
      if ( Object.hasOwn(resources, id) ) continue;
      resources[id] = value;
      changed = true;
    }
    if ( changed ) actorPlans.push({ actor: entry.actor, resources });
  }

  return {
    definitions: definitionsChanged ? definitions : null,
    managed: managedChanged ? managed : null,
    actors: actorPlans
  };
}

/** 등록되지 않은(꺼졌거나 지운) 모듈의 월드 설정값을 저장소에서 직접 읽는다. */
export function readLegacyWorldSetting(key, storage = globalThis.game?.settings?.storage?.get?.("world")) {
  const fullKey = `${LEGACY_MODULE_ID}.${key}`;
  const setting = storage?.getSetting?.(fullKey)
    ?? storage?.find?.(document => document?.key === fullKey);
  return plainObject(setting?.value ?? setting?._source?.value);
}

/** 꺼진 모듈 범위의 flag는 getFlag가 막으므로 원본 자료에서 읽는다. */
export function readLegacyActorResources(actor) {
  return plainObject(actor?._source?.flags?.[LEGACY_MODULE_ID]?.[FLAGS.ACTOR_RESOURCES]
    ?? actor?.flags?.[LEGACY_MODULE_ID]?.[FLAGS.ACTOR_RESOURCES]);
}

export async function migrateLegacyResources() {
  if ( !game.user?.isGM || isModuleActive(LEGACY_MODULE_ID) ) return null;

  const version = Number(game.settings.get(MODULE_ID, SETTINGS.MIGRATION_VERSION) ?? 0);
  if ( version >= MIGRATION_VERSION ) return null;

  const plan = planLegacyResourceMigration({
    currentDefinitions: game.settings.get(MODULE_ID, SETTINGS.RESOURCE_DEFINITIONS),
    legacyDefinitions: readLegacyWorldSetting(LEGACY_SETTINGS.RESOURCE_DEFINITIONS),
    currentManaged: game.settings.get(MODULE_ID, SETTINGS.MANAGED_ACTORS),
    legacyManaged: readLegacyWorldSetting(LEGACY_SETTINGS.MANAGED_ACTORS),
    actors: game.actors
      .filter(actor => actor.type === "character")
      .map(actor => ({
        actor,
        currentResources: actor._source?.flags?.[MODULE_ID]?.[FLAGS.ACTOR_RESOURCES],
        legacyResources: readLegacyActorResources(actor)
      }))
  });

  if ( plan.definitions ) await game.settings.set(MODULE_ID, SETTINGS.RESOURCE_DEFINITIONS, plan.definitions);
  if ( plan.managed ) await game.settings.set(MODULE_ID, SETTINGS.MANAGED_ACTORS, plan.managed);
  for ( const { actor, resources } of plan.actors ) {
    await actor.setFlag(MODULE_ID, FLAGS.ACTOR_RESOURCES, resources);
  }
  await game.settings.set(MODULE_ID, SETTINGS.MIGRATION_VERSION, MIGRATION_VERSION);

  const summary = {
    definitions: plan.definitions ? Object.keys(plan.definitions).length : 0,
    managed: plan.managed ? Object.keys(plan.managed).length : 0,
    actors: plan.actors.length
  };
  if ( summary.definitions || summary.managed || summary.actors ) {
    console.log(`${MODULE_ID} | 옛 자원 자료 이관`, summary);
  }
  return summary;
}
