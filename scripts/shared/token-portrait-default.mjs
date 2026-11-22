// 토큰 보기 기본값(2026-11-22 마스터 지시): PC·NPC 시트의 기본 보기를 토큰 이미지로 한다.
//
// dnd5e 6.1은 액터 플래그 `flags.dnd5e.showTokenPortrait`(true면 시트·채팅 카드에 토큰 이미지,
// `Actor#getPreferredArtwork`)로 보기를 정한다.
// - 새 액터: `preCreateActor`에서 이 플래그가 정해져 있지 않으면 true로 넣는다.
//   직접 생성, DDB Importer, SBI, 워크벤치 생성, 컴펜디움에서 가져오기 모두 이 훅을 지난다.
//   만드는 쪽이 일부러 false로 넣은 값은 덮어쓰지 않는다.
// - 기존 액터: 월드 `ready`에서 가장 앞선 활성 GM 한 명만, 플래그가 없는 월드 액터를 한 번에 true로 바꾼다.
//   끝나면 월드 설정에 이전 판 번호를 남겨 다시 돌지 않는다. false로 둔 액터는 건드리지 않는다.

export const MODULE_ID = 'nihil-compendium-module';
export const TOKEN_PORTRAIT_MIGRATION_SETTING = 'tokenPortraitMigration';
export const TOKEN_PORTRAIT_MIGRATION_VERSION = 1;
export const TOKEN_PORTRAIT_FLAG_PATH = 'flags.dnd5e.showTokenPortrait';
export const TOKEN_PORTRAIT_ACTOR_TYPES = new Set(['character', 'npc']);

let registered = false;

function readFlag(source) {
  const value = source?.flags?.dnd5e?.showTokenPortrait;
  return value === undefined ? undefined : value;
}

/** 플래그가 아직 정해지지 않은 PC·NPC 원본인지. */
export function needsTokenPortraitDefault(source) {
  if (!source || !TOKEN_PORTRAIT_ACTOR_TYPES.has(source.type)) return false;
  const value = readFlag(source);
  return value === undefined || value === null;
}

/** preCreateActor 처리: 정해지지 않았으면 원본에 true를 넣는다. 넣었으면 true. */
export function applyTokenPortraitDefault(actor, data = {}) {
  if (!needsTokenPortraitDefault(actor?._source ?? data)) return false;
  actor.updateSource({ [TOKEN_PORTRAIT_FLAG_PATH]: true });
  return true;
}

/** 활성 GM 가운데 id 순으로 가장 앞선 사람인지. */
export function isLeadActiveGm(game = globalThis.game) {
  const user = game?.user;
  if (!user?.isGM) return false;
  const users = Array.from(game?.users ?? []);
  const lead = users
    .filter((entry) => entry?.active && entry?.isGM)
    .map((entry) => entry.id)
    .sort()[0];
  return (lead ?? user.id) === user.id;
}

/** 일괄 변경 대상: 플래그가 없는 월드 PC·NPC. */
export function tokenPortraitMigrationTargets(actors) {
  return Array.from(actors ?? [])
    .filter((actor) => needsTokenPortraitDefault(actor?._source ?? actor))
    .map((actor) => ({ id: actor.id, name: actor.name, type: actor.type, showTokenPortrait: readFlag(actor?._source ?? actor) ?? null }));
}

export async function migrateTokenPortraits(game = globalThis.game) {
  if (!isLeadActiveGm(game)) return { skipped: 'not-lead-gm' };
  let done = 0;
  try {
    done = Number(game.settings.get(MODULE_ID, TOKEN_PORTRAIT_MIGRATION_SETTING)) || 0;
  } catch {
    return { skipped: 'no-setting' };
  }
  if (done >= TOKEN_PORTRAIT_MIGRATION_VERSION) return { skipped: 'done' };

  const targets = tokenPortraitMigrationTargets(game.actors);
  if (targets.length) {
    console.info(`${MODULE_ID} | 토큰 보기 기본값: 액터 ${targets.length}개를 바꿉니다.`, targets);
    const ActorClass = globalThis.CONFIG?.Actor?.documentClass ?? game.actors?.documentClass;
    const updates = targets.map(({ id }) => ({ _id: id, [TOKEN_PORTRAIT_FLAG_PATH]: true }));
    if (ActorClass?.updateDocuments) await ActorClass.updateDocuments(updates);
    else for (const update of updates) await game.actors.get(update._id)?.update({ [TOKEN_PORTRAIT_FLAG_PATH]: true });
  }
  await game.settings.set(MODULE_ID, TOKEN_PORTRAIT_MIGRATION_SETTING, TOKEN_PORTRAIT_MIGRATION_VERSION);
  return { updated: targets };
}

export function registerTokenPortraitDefault() {
  if (registered || !globalThis.Hooks?.on) return false;
  globalThis.game?.settings?.register?.(MODULE_ID, TOKEN_PORTRAIT_MIGRATION_SETTING, {
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });
  globalThis.Hooks.on('preCreateActor', (actor, data) => {
    applyTokenPortraitDefault(actor, data);
  });
  globalThis.Hooks.once('ready', () => {
    migrateTokenPortraits().catch((error) => console.error(`${MODULE_ID} | 토큰 보기 기본값 일괄 변경 실패`, error));
  });
  registered = true;
  return true;
}
