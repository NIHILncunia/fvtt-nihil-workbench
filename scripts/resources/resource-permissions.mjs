import {
  FLAGS,
  MODULE_ID
} from "./constants.mjs";

const RESOURCE_KEYS = [FLAGS.ACTOR_RESOURCES, `-=${FLAGS.ACTOR_RESOURCES}`];

function hasResourceKey(value) {
  if ( !value || typeof value !== "object" ) return false;
  return RESOURCE_KEYS.some(key => Object.hasOwn(value, key))
    || Object.keys(value).some(key => key.startsWith(`${FLAGS.ACTOR_RESOURCES}.`));
}

/**
 * 이 갱신이 Actor 자원 flag를 바꾸는지 본다.
 * 워크벤치는 같은 flag 범위에 다른 값(contentKey 등)도 두므로, 범위 전체가 아니라 resources 키만 본다.
 */
export function containsActorResourceChanges(changes) {
  if ( !changes || typeof changes !== "object" ) return false;
  if ( hasResourceKey(changes.flags?.[MODULE_ID]) ) return true;
  if ( Object.hasOwn(changes, `-=${MODULE_ID}`) ) return true;
  if ( changes.flags && Object.hasOwn(changes.flags, `-=${MODULE_ID}`) ) return true;

  const resourcePath = `flags.${MODULE_ID}.${FLAGS.ACTOR_RESOURCES}`;
  return Object.keys(changes).some(key => {
    if ( key === resourcePath || key.startsWith(`${resourcePath}.`) ) return true;
    if ( key === `flags.${MODULE_ID}.-=${FLAGS.ACTOR_RESOURCES}` ) return true;
    if ( key === `flags.-=${MODULE_ID}` ) return true;
    if ( key === `flags.${MODULE_ID}` ) return hasResourceKey(changes[key]);
    return false;
  });
}

export function canUserChangeActorResources(
  user,
  changes
) {
  return user?.isGM === true || !containsActorResourceChanges(changes);
}

/** 플레이어(비 GM)가 소유한 PC면 읽기 전용 자원 현황을 연다. */
export function canUserViewActorResources(
  user,
  actor
) {
  return !user?.isGM
    && actor?.type === "character"
    && actor.isOwner === true;
}
