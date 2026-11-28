import { usesLegacyModule } from '../shared/compat.mjs';
import {
  LEGACY_MODULE_ID,
  MODULE_ID,
  SETTINGS
} from "./constants.mjs";

export function getResourceDefinitions({ includeArchived = false } = {}) {
  const definitions = foundry.utils.deepClone(
    game.settings.get(
      usesLegacyModule(LEGACY_MODULE_ID) ? LEGACY_MODULE_ID : MODULE_ID,
      SETTINGS.RESOURCE_DEFINITIONS
    ) ?? {}
  );

  if ( includeArchived ) return definitions;

  return Object.fromEntries(
    Object.entries(definitions).filter(([, definition]) => definition.archived !== true)
  );
}

export function getSortedResourceDefinitions({ includeArchived = false } = {}) {
  return Object.values(getResourceDefinitions({ includeArchived }))
    .map(normalizeResourceDefinition)
    .sort((
      a,
      b
    ) => {
      const sortDifference = a.sort - b.sort;
      if ( sortDifference !== 0 ) return sortDifference;
      return a.name.localeCompare(b.name);
    });
}

export function getResourceDefinition(
  resourceId,
  { includeArchived = false } = {}
) {
  const definition = getResourceDefinitions({ includeArchived })[resourceId];
  return definition ? normalizeResourceDefinition(definition) : null;
}

export async function saveResourceDefinitions(definitions) {
  assertGameMaster();
  await game.settings.set(
    MODULE_ID,
    SETTINGS.RESOURCE_DEFINITIONS,
    definitions
  );
}

export async function createResourceDefinition({ name, max, startFromZero }) {
  assertGameMaster();

  const definitions = getResourceDefinitions({ includeArchived: true });
  const normalizedName = normalizeResourceName(name);
  const normalizedMax = normalizeResourceMax(max);

  validateUniqueResourceName(
    definitions,
    normalizedName
  );

  const id = foundry.utils.randomID(12);
  const definition = {
    id,
    name: normalizedName,
    min: 0,
    max: normalizedMax,
    startFromZero: !!startFromZero,
    defaultValue: startFromZero ? 0 : normalizedMax,
    archived: false,
    sort: Object.values(definitions).length
  };

  definitions[id] = definition;
  await saveResourceDefinitions(definitions);
  return definition;
}

export async function archiveResourceDefinition(resourceId) {
  assertGameMaster();

  const definitions = getResourceDefinitions({ includeArchived: true });
  const definition = definitions[resourceId];
  if ( !definition ) return null;

  definition.archived = true;
  await saveResourceDefinitions(definitions);
  return normalizeResourceDefinition(definition);
}

export async function updateResourceDefinition(
  resourceId,
  changes
) {
  assertGameMaster();

  const definitions = getResourceDefinitions({ includeArchived: true });
  const definition = definitions[resourceId];
  if ( !definition || definition.archived === true ) return null;

  const name = normalizeResourceName(changes.name ?? definition.name);
  const max = normalizeResourceMax(changes.max ?? definition.max);
  validateUniqueResourceName(
    definitions,
    name,
    resourceId
  );

  const next = {
    ...definition,
    name,
    max,
    defaultValue: definition.startFromZero ? 0 : max
  };

  definitions[resourceId] = next;
  await saveResourceDefinitions(definitions);
  return normalizeResourceDefinition(next);
}

export function getInitialResourceValue(definition) {
  const max = normalizeStoredMax(definition?.max);
  return definition?.startFromZero ? 0 : max;
}

export function clampResourceValue(
  definition,
  value
) {
  const min = 0;
  const max = normalizeStoredMax(definition?.max);
  const number = Math.trunc(Number(value));

  if ( !Number.isFinite(number) ) return min;
  return Math.min(
    Math.max(
      number,
      min
    ),
    max
  );
}

export function normalizeResourceDefinition(definition) {
  const max = normalizeStoredMax(definition?.max);
  const startFromZero = !!definition?.startFromZero;

  return {
    id: definition.id,
    name: String(definition.name ?? "이름 없는 자원"),
    min: 0,
    max,
    startFromZero,
    defaultValue: startFromZero ? 0 : max,
    archived: definition.archived === true,
    sort: Number(definition.sort ?? 0)
  };
}

function normalizeResourceName(name) {
  const normalizedName = String(name ?? "").trim();
  if ( !normalizedName ) {
    throw new Error("자원명을 입력해야 합니다.");
  }
  return normalizedName;
}

function normalizeResourceMax(max) {
  const number = Number(max);
  if ( !Number.isInteger(number) || number < 1 ) {
    throw new Error("최대치는 1 이상의 정수여야 합니다.");
  }
  return number;
}

function normalizeStoredMax(max) {
  const number = Math.trunc(Number(max));
  return Number.isFinite(number) && number >= 1 ? number : 1;
}

function validateUniqueResourceName(
  definitions,
  name,
  excludedResourceId = null
) {
  const comparableName = name.toLocaleLowerCase("ko-KR");
  const duplicated = Object.values(definitions).some(definition => {
    if ( definition.id === excludedResourceId ) return false;
    return String(definition.name ?? "")
      .trim()
      .toLocaleLowerCase("ko-KR") === comparableName;
  });

  if ( duplicated ) {
    throw new Error(`이미 존재하는 자원명입니다: ${name}`);
  }
}

function assertGameMaster() {
  if ( !game.user?.isGM ) {
    throw new Error("자원 정의는 GM만 변경할 수 있습니다.");
  }
}
