import {
  FLAGS,
  MODULE_ID,
  SETTINGS
} from "./constants.mjs";
import {
  clampResourceValue,
  getInitialResourceValue,
  getResourceDefinition,
  getSortedResourceDefinitions
} from "./resource-definitions.mjs";

export function getPcActors() {
  return game.actors
    .filter(actor => actor.type === "character")
    .sort((
      a,
      b
    ) => a.name.localeCompare(b.name));
}

export function getManagedActorMap() {
  return foundry.utils.deepClone(
    game.settings.get(
      MODULE_ID,
      SETTINGS.MANAGED_ACTORS
    ) ?? {}
  );
}

export function getManagedActorUuids() {
  return Object.entries(getManagedActorMap())
    .filter(([, managed]) => managed === true)
    .map(([uuid]) => uuid);
}

export function getManagedActors() {
  const managed = getManagedActorMap();
  return getPcActors().filter(actor => managed[actor.uuid] === true);
}

export async function saveManagedActorUuids(uuids) {
  assertGameMaster();

  const managedActors = Object.fromEntries(uuids.map(uuid => [uuid, true]));
  await game.settings.set(
    MODULE_ID,
    SETTINGS.MANAGED_ACTORS,
    managedActors
  );
}

export function getActorResourceStore(actor) {
  return foundry.utils.deepClone(
    actor.getFlag(
      MODULE_ID,
      FLAGS.ACTOR_RESOURCES
    ) ?? {}
  );
}

export async function saveActorResourceStore(
  actor,
  resources
) {
  assertGameMaster();
  await actor.setFlag(
    MODULE_ID,
    FLAGS.ACTOR_RESOURCES,
    resources
  );
}

export function buildActorResourceEntry(
  definition,
  existing = null
) {
  const storedValue = Math.trunc(Number(existing?.value));
  return {
    value: Number.isFinite(storedValue)
      ? storedValue
      : getInitialResourceValue(definition)
  };
}

export async function setActorResourceValue(
  actor,
  resourceId,
  value
) {
  assertGameMaster();

  const definition = getResourceDefinition(resourceId);
  if ( !definition || actor?.type !== "character" ) return;

  const resources = getActorResourceStore(actor);
  resources[resourceId] = {
    value: clampResourceValue(
      definition,
      value
    )
  };
  await saveActorResourceStore(
    actor,
    resources
  );
}

export async function adjustActorResourceValue(
  actor,
  resourceId,
  amount
) {
  assertGameMaster();

  const definition = getResourceDefinition(resourceId);
  if ( !definition || actor?.type !== "character" ) return;

  const resources = getActorResourceStore(actor);
  const current = buildActorResourceEntry(
    definition,
    resources[resourceId]
  );
  resources[resourceId] = {
    value: clampResourceValue(
      definition,
      current.value + Number(amount || 0)
    )
  };
  await saveActorResourceStore(
    actor,
    resources
  );
}

export async function adjustResourceForActors(
  resourceId,
  amount,
  actors
) {
  assertGameMaster();
  await Promise.all(
    actors
      .filter(actor => actor?.type === "character")
      .map(actor => adjustActorResourceValue(
        actor,
        resourceId,
        amount
      ))
  );
}

export async function syncActorResources(actor) {
  assertGameMaster();
  if ( actor?.type !== "character" ) return;

  const definitions = getSortedResourceDefinitions();
  const resources = getActorResourceStore(actor);
  let changed = false;

  for ( const definition of definitions ) {
    const current = resources[definition.id];
    const next = buildActorResourceEntry(
      definition,
      current
    );

    if ( !current || current.enabled !== undefined || current.value !== next.value ) {
      resources[definition.id] = next;
      changed = true;
    }
  }

  if ( changed ) {
    await saveActorResourceStore(
      actor,
      resources
    );
  }
}

export async function synchronizeAllActorResources() {
  assertGameMaster();
  await Promise.all(getPcActors().map(actor => syncActorResources(actor)));
}

export function getActorResourceRows(actor) {
  if ( actor?.type !== "character" ) return [];

  const definitions = getSortedResourceDefinitions();
  const resources = getActorResourceStore(actor);

  return definitions.map(definition => {
    const entry = buildActorResourceEntry(
      definition,
      resources[definition.id]
    );
    return {
      id: definition.id,
      name: definition.name,
      value: entry.value,
      max: definition.max,
      percent: getResourcePercent(
        entry.value,
        definition.max
      )
    };
  });
}

export function getResourceStatusRows(resourceId) {
  const definition = getResourceDefinition(resourceId);
  if ( !definition ) return [];

  return getManagedActors().map(actor => {
    const resources = getActorResourceStore(actor);
    const entry = buildActorResourceEntry(
      definition,
      resources[resourceId]
    );

    return {
      actorId: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      value: entry.value,
      max: definition.max,
      percent: getResourcePercent(
        entry.value,
        definition.max
      )
    };
  });
}

export function getManagedActorRows() {
  const managed = getManagedActorMap();
  return getPcActors().map(actor => ({
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    managed: managed[actor.uuid] === true
  }));
}

function getResourcePercent(
  value,
  max
) {
  if ( max <= 0 ) return 0;
  return Math.min(
    100,
    Math.max(
      0,
      Math.round((value / max) * 100)
    )
  );
}

function assertGameMaster() {
  if ( !game.user?.isGM ) {
    throw new Error("자원값은 GM만 변경할 수 있습니다.");
  }
}
