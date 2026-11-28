// 전투 기록(2026-11-28): 전투가 진행되는 동안 활성 GM 한 사람이 참가자·차례·이동·HP 변화·
// 상태·자연 20/1·라운드별 배치를 모아 두었다가, 전투가 끝나면 월드 폴더에 JSON 파일로 남긴다.
// 채팅 로그 내보내기가 이 파일로 전투 요약과 리플레이를 만든다. 채팅에는 따로 글을 올리지 않는다.
//
// 파일: worlds/<월드>/nihil-chat-log/combat/<시작 시각>_<기록 id>.json
// 진행 중 기록은 같은 폴더의 _active.json에 10초마다 저장해 새로 고침·GM 교대 뒤에도 이어 간다.
import { CHAT_LOG_MODULE_ID } from './shared.mjs';

export const COMBAT_RECORD_SCHEMA = 'nihil-chat-log.combat.v1';
export const COMBAT_RECORD_SETTING = 'chatLogCombatRecord';
const MAX_EVENTS = 5000;
const CHECKPOINT_DELAY_MS = 10_000;
const HP_PATHS = ['system.attributes.hp', 'system.hp', 'system.health', 'system.attributes.health'];

const records = new Map();
const finalizing = new Set();
const hpBefore = new Map();
const countedRolls = new Map();
let checkpointTimer = null;
let checkpointChain = Promise.resolve();
let resuming = null;
// 훅은 Hooks 객체마다 한 번만 건다(시험에서 Hooks를 바꿔 끼워도 맞게).
const registeredOn = new WeakSet();

export function combatRecordFolder(worldId = globalThis.game?.world?.id ?? 'world') {
  const base = `worlds/${worldId}/nihil-chat-log`;
  return { base, folder: `${base}/combat` };
}

function enabled() {
  try {
    return globalThis.game.settings.get(CHAT_LOG_MODULE_ID, COMBAT_RECORD_SETTING) !== false;
  } catch {
    return true;
  }
}

/** 기록은 Foundry가 정한 활성 GM 한 클라이언트만 한다. */
function isRecorder() {
  const game = globalThis.game;
  if (!game?.user?.isGM) return false;
  const activeGM = game.users?.activeGM;
  return activeGM ? activeGM.id === game.user.id : true;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readHp(actor) {
  if (!actor) return null;
  for (const path of HP_PATHS) {
    const hp = globalThis.foundry.utils.getProperty(actor, path);
    if (hp && typeof hp === 'object' && finite(hp.value) !== null) {
      return { value: finite(hp.value), max: finite(hp.max), temp: finite(hp.temp) };
    }
  }
  return null;
}

/** 임시 HP까지 더한 값. 임시 HP로 막은 피해도 피해로 센다. */
export function effectiveHp(hp) {
  if (!hp || hp.value === null || hp.value === undefined) return null;
  return hp.value + Math.max(0, hp.temp || 0);
}

function combatScene(combat) {
  const game = globalThis.game;
  return combat?.scene ?? game.scenes?.get(combat?._source?.scene) ?? globalThis.canvas?.scene ?? null;
}

function tokenSnapshot(
  token,
  combatant,
) {
  const document = token?.document ?? token;
  const actor = document?.actor ?? combatant?.actor ?? null;
  const gridSize = Number(document?.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100);
  return {
    tokenId: document?.id ?? combatant?.tokenId ?? null,
    combatantId: combatant?.id ?? null,
    actorId: document?.actorId ?? combatant?.actorId ?? actor?.id ?? null,
    linked: Boolean(document?.actorLink),
    name: combatant?.name ?? document?.name ?? actor?.name ?? '???',
    img: document?.texture?.src ?? actor?.img ?? null,
    portrait: actor?.img ?? null,
    disposition: Number(document?.disposition ?? 0),
    hidden: Boolean(document?.hidden || combatant?.hidden),
    x: Number(document?.x ?? 0),
    y: Number(document?.y ?? 0),
    w: Number(document?.width ?? 1) * gridSize,
    h: Number(document?.height ?? 1) * gridSize,
    hp: readHp(actor),
    defeated: Boolean(combatant?.isDefeated ?? combatant?.defeated),
    statuses: [...(actor?.statuses ?? [])],
  };
}

function snapshotCombat(combat) {
  const scene = combatScene(combat);
  return (combat?.combatants?.contents ?? []).map((combatant) => tokenSnapshot(
    combatant.token ?? scene?.tokens?.get(combatant.tokenId),
    combatant,
  ));
}

function turnOrder(combat) {
  return (combat?.turns ?? []).map((combatant) => combatant.tokenId).filter(Boolean);
}

function positions(combat) {
  return snapshotCombat(combat).map(({ tokenId, x, y, hp, defeated }) => ({ tokenId, x, y, hp: hp?.value ?? null, defeated }));
}

function newParticipant(
  snapshot,
  joined = null,
) {
  return {
    ...snapshot,
    start: { x: snapshot.x, y: snapshot.y },
    startHp: snapshot.hp?.value ?? null,
    dealt: 0,
    taken: 0,
    healed: 0,
    downs: 0,
    crits: 0,
    fumbles: 0,
    ...(joined === null ? {} : { joined }),
  };
}

/** 액터 문서가 가리키는 참가자. 연결 안 된 토큰 액터는 그 토큰만, 월드 액터는 연결된 토큰들. */
function participantsForActor(
  record,
  actor,
) {
  if (!actor) return [];
  if (actor.isToken) {
    const tokenId = actor.token?.id;
    return record.participants.filter((participant) => participant.tokenId === tokenId);
  }
  return record.participants.filter((participant) => participant.actorId === actor.id && participant.linked !== false);
}

function participantBySpeaker(
  record,
  speaker = {},
) {
  if (speaker.token) {
    const byToken = record.participants.find((participant) => participant.tokenId === speaker.token);
    if (byToken) return byToken;
  }
  if (!speaker.actor) return null;
  return record.participants.find((participant) => participant.actorId === speaker.actor && participant.linked !== false) ?? null;
}

function hpKey(
  record,
  participant,
) {
  return `${record.combatId}:${participant.tokenId ?? participant.actorId}`;
}

function push(
  record,
  type,
  data = {},
) {
  if (record.events.length >= MAX_EVENTS) {
    record.truncated = true;
    return;
  }
  record.events.push({ at: Date.now() - record.startedAt, round: record.round, type, ...data });
  scheduleCheckpoint();
}

function filePicker() {
  const foundry = globalThis.foundry;
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

async function ensureFolders() {
  const { base, folder } = combatRecordFolder();
  const picker = filePicker();
  await picker.createDirectory('data', base, {}).catch(() => {});
  await picker.createDirectory('data', folder, {}).catch(() => {});
  return folder;
}

async function uploadJson(
  filename,
  data,
) {
  const folder = await ensureFolders();
  const file = new File([JSON.stringify(data)], filename, { type: 'application/json' });
  const result = await filePicker().upload('data', folder, file, {}, { notify: false });
  return result?.path ?? `${folder}/${filename}`;
}

function scheduleCheckpoint() {
  if (checkpointTimer) return;
  checkpointTimer = setTimeout(() => {
    checkpointTimer = null;
    void checkpoint();
  }, CHECKPOINT_DELAY_MS);
}

function checkpoint() {
  if (!isRecorder()) return checkpointChain;
  if (checkpointTimer) {
    clearTimeout(checkpointTimer);
    checkpointTimer = null;
  }
  const body = { schemaVersion: COMBAT_RECORD_SCHEMA, savedAt: Date.now(), records: Object.fromEntries(records) };
  checkpointChain = checkpointChain.then(async () => {
    try {
      await uploadJson('_active.json', body);
    } catch (error) {
      console.warn(`${CHAT_LOG_MODULE_ID} | 전투 기록 중간 저장 실패`, error);
    }
  });
  return checkpointChain;
}

function currentTurn(combat) {
  const combatant = combat?.combatant;
  if (!combatant) return null;
  return { combatantId: combatant.id, tokenId: combatant.tokenId, actorId: combatant.actorId, name: combatant.name };
}

function start(combat) {
  if (!enabled() || !isRecorder() || !combat || records.has(combat.id)) return;
  const scene = combatScene(combat);
  const tokens = snapshotCombat(combat);
  const game = globalThis.game;
  const record = {
    schemaVersion: COMBAT_RECORD_SCHEMA,
    id: globalThis.foundry.utils.randomID(),
    combatId: combat.id,
    sceneId: scene?.id ?? null,
    levelId: globalThis.canvas?.scene?.id === scene?.id ? (globalThis.canvas?.level?.id ?? null) : null,
    sceneName: scene?.navName || scene?.name || null,
    startedAt: Date.now(),
    endedAt: null,
    round: Number(combat.round || 1),
    foundryVersion: game.version,
    system: { id: game.system?.id, version: game.system?.version },
    participants: tokens.map((token) => newParticipant(token)),
    rounds: [{ round: Number(combat.round || 1), order: turnOrder(combat), positions: positions(combat) }],
    events: [],
    current: currentTurn(combat),
  };
  records.set(combat.id, record);
  for (const participant of record.participants) hpBefore.set(hpKey(record, participant), effectiveHp(participant.hp));
  push(record, 'combat-start', { combatants: tokens.length });
  void checkpoint();
}

function onTurnChange(
  combat,
  _prior,
  current,
) {
  const record = records.get(combat.id);
  if (!record || !isRecorder()) return;
  const round = Number(current?.round ?? combat.round ?? record.round);
  if (round !== record.round) {
    record.round = round;
    record.rounds.push({ round, order: turnOrder(combat), positions: positions(combat) });
    void checkpoint();
  }
  record.current = currentTurn(combat);
  push(record, 'turn', { name: record.current?.name ?? null, tokenId: record.current?.tokenId ?? null });
}

function onPreUpdateActor(actor) {
  if (!isRecorder()) return;
  for (const record of records.values()) {
    for (const participant of participantsForActor(record, actor)) {
      hpBefore.set(hpKey(record, participant), effectiveHp(readHp(actor)));
    }
  }
}

function onUpdateActor(actor) {
  if (!isRecorder()) return;
  for (const record of records.values()) {
    for (const target of participantsForActor(record, actor)) {
      const key = hpKey(record, target);
      const before = hpBefore.get(key);
      const hp = readHp(actor);
      const after = effectiveHp(hp);
      hpBefore.set(key, after);
      target.hp = hp;
      if (before === null || before === undefined || after === null || before === after) continue;
      const delta = after - before;
      // 누가 입혔는지는 그때 차례인 참가자로 어림한다.
      const source = record.current
        ? participantBySpeaker(record, { token: record.current.tokenId, actor: record.current.actorId })
        : null;
      const shown = hp?.value ?? after;
      if (delta < 0) {
        target.taken += -delta;
        if (source && source !== target) source.dealt += -delta;
        push(record, 'damage', {
          target: target.name,
          tokenId: target.tokenId,
          source: source?.name ?? null,
          sourceTokenId: source?.tokenId ?? null,
          amount: -delta,
          before,
          after: shown,
        });
        if (before > 0 && after <= 0) {
          target.downs += 1;
          push(record, 'down', { target: target.name, tokenId: target.tokenId, source: source?.name ?? null });
        }
      } else {
        target.healed += delta;
        push(record, 'heal', {
          target: target.name,
          tokenId: target.tokenId,
          source: source?.name ?? null,
          sourceTokenId: source?.tokenId ?? null,
          amount: delta,
          before,
          after: shown,
        });
      }
    }
  }
}

function statusLabel(statusId) {
  const CONFIG = globalThis.CONFIG;
  const effect = CONFIG?.statusEffects?.find?.((entry) => entry.id === statusId);
  const label = effect?.name
    ?? effect?.label
    ?? CONFIG?.DND5E?.conditionTypes?.[statusId]?.name
    ?? (statusId === 'bloodied' ? CONFIG?.DND5E?.bloodied?.name : null)
    ?? statusId;
  try {
    return globalThis.game.i18n.localize(label);
  } catch {
    return label;
  }
}

function onStatusChange(actor) {
  if (!isRecorder() || !actor) return;
  const now = [...(actor.statuses ?? [])];
  for (const record of records.values()) {
    for (const target of participantsForActor(record, actor)) {
      const added = now.filter((status) => !target.statuses.includes(status));
      const removed = target.statuses.filter((status) => !now.includes(status));
      target.statuses = now;
      for (const status of added) push(record, 'status-on', { target: target.name, tokenId: target.tokenId, status, label: statusLabel(status) });
      for (const status of removed) push(record, 'status-off', { target: target.name, tokenId: target.tokenId, status, label: statusLabel(status) });
    }
  }
}

function onUpdateCombatant(
  combatant,
  changed,
) {
  const record = records.get(combatant.parent?.id);
  if (!record || !isRecorder()) return;
  const target = record.participants.find((participant) => participant.combatantId === combatant.id || participant.tokenId === combatant.tokenId);
  if (!target) return;
  if ('hidden' in (changed ?? {})) target.hidden = Boolean(changed.hidden);
  if (!('defeated' in (changed ?? {}))) return;
  target.defeated = Boolean(changed.defeated);
  if (target.defeated) push(record, 'defeated', { target: target.name, tokenId: target.tokenId });
}

function onCreateCombatant(combatant) {
  const record = records.get(combatant.parent?.id);
  if (!record || !isRecorder()) return;
  if (record.participants.some((participant) => participant.tokenId === combatant.tokenId)) return;
  const scene = combatScene(combatant.parent);
  const snapshot = tokenSnapshot(combatant.token ?? scene?.tokens?.get(combatant.tokenId), combatant);
  const participant = newParticipant(snapshot, record.round);
  record.participants.push(participant);
  hpBefore.set(hpKey(record, participant), effectiveHp(participant.hp));
  push(record, 'join', { name: snapshot.name, tokenId: snapshot.tokenId, x: snapshot.x, y: snapshot.y });
}

function onUpdateToken(
  token,
  changed,
) {
  if (!isRecorder()) return;
  const hasMove = 'x' in changed || 'y' in changed;
  for (const record of records.values()) {
    if (token.parent?.id !== record.sceneId) continue;
    const target = record.participants.find((participant) => participant.tokenId === token.id);
    if (!target) continue;
    if ('hidden' in changed) target.hidden = Boolean(changed.hidden);
    if (!hasMove) continue;
    const x = Number(changed.x ?? token.x);
    const y = Number(changed.y ?? token.y);
    if (x === target.x && y === target.y) continue;
    push(record, 'move', { target: target.name, tokenId: target.tokenId, from: { x: target.x, y: target.y }, x, y });
    target.x = x;
    target.y = y;
  }
}

function rollSignature(
  roll,
  index,
) {
  const faces = (roll.dice ?? []).map((die) => `${die.faces}:${(die.results ?? []).map((result) => result.result).join('.')}`).join('|');
  return `${index}|${roll.formula}|${roll.total}|${faces}`;
}

/** 굴림의 d20 자연 20·1을 말한 참가자에게 붙인다. 같은 굴림은 한 번만 센다. */
function countMessageRolls(message) {
  if (!isRecorder() || !records.size) return;
  const seen = countedRolls.get(message.id) ?? new Set();
  const fresh = [];
  (message.rolls ?? []).forEach((roll, index) => {
    const signature = rollSignature(roll, index);
    if (seen.has(signature)) return;
    seen.add(signature);
    fresh.push(roll);
  });
  countedRolls.set(message.id, seen);
  if (countedRolls.size > 500) countedRolls.delete(countedRolls.keys().next().value);
  if (!fresh.length) return;
  for (const record of records.values()) {
    const who = participantBySpeaker(record, message.speaker ?? {});
    if (!who) continue;
    for (const roll of fresh) {
      for (const die of roll.dice ?? []) {
        if (Number(die.faces) !== 20) continue;
        for (const result of die.results ?? []) {
          if (result.active === false || result.discarded) continue;
          if (result.result === 20) {
            who.crits += 1;
            push(record, 'crit', { name: who.name, tokenId: who.tokenId });
          } else if (result.result === 1) {
            who.fumbles += 1;
            push(record, 'fumble', { name: who.name, tokenId: who.tokenId });
          }
        }
      }
    }
  }
}

async function finalize(
  combatId,
  reason = 'ended',
) {
  const record = records.get(combatId);
  if (!record || finalizing.has(combatId) || !isRecorder()) return;
  finalizing.add(combatId);
  try {
    record.endedAt = Date.now();
    record.endReason = reason;
    push(record, 'combat-end', { reason });
    records.delete(combatId);
    for (const key of [...hpBefore.keys()]) if (key.startsWith(`${combatId}:`)) hpBefore.delete(key);
    await checkpoint();
    const substantive = record.events.some((event) => !['combat-start', 'combat-end', 'turn'].includes(event.type)) || record.round > 1;
    if (!substantive) return;
    const stamp = new Date(record.startedAt).toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const path = await uploadJson(`${stamp}_${record.id}.json`, record);
    globalThis.Hooks.callAll(`${CHAT_LOG_MODULE_ID}.combatRecordSaved`, { record, path });
  } catch (error) {
    console.error(`${CHAT_LOG_MODULE_ID} | 전투 기록 저장 실패`, error);
  } finally {
    finalizing.delete(combatId);
  }
}

async function storedRecords() {
  try {
    const { folder } = combatRecordFolder();
    const response = await fetch(`/${folder}/_active.json`, { cache: 'no-cache' });
    if (!response.ok) return [];
    const data = await response.json();
    return Object.values(data?.records ?? {});
  } catch {
    return [];
  }
}

async function resumeStored() {
  for (const record of await storedRecords()) {
    if (!record?.combatId || records.has(record.combatId)) continue;
    records.set(record.combatId, record);
    for (const participant of record.participants ?? []) hpBefore.set(hpKey(record, participant), effectiveHp(participant.hp));
    const combat = globalThis.game.combats?.get(record.combatId);
    if (!combat || combat.started === false) await finalize(record.combatId, 'interrupted');
  }
}

function resume() {
  if (!enabled() || !isRecorder()) return null;
  if (resuming) return resuming;
  resuming = resumeStored().finally(() => {
    resuming = null;
  });
  return resuming;
}

export function getCombatRecordStatus() {
  return [...records.values()].map((record) => ({ combatId: record.combatId, round: record.round, events: record.events.length }));
}

export function registerCombatRecorderSettings() {
  const settings = globalThis.game?.settings;
  if (!settings?.register || settings.settings?.has?.(`${CHAT_LOG_MODULE_ID}.${COMBAT_RECORD_SETTING}`)) return false;
  settings.register(
    CHAT_LOG_MODULE_ID,
    COMBAT_RECORD_SETTING,
    {
      name: '전투 기록',
      hint: '전투가 끝나면 참가자·차례·이동·피해를 월드 폴더(nihil-chat-log/combat)에 남깁니다. 채팅 로그 내보내기의 전투 요약과 리플레이가 이 기록을 씁니다.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    },
  );
  return true;
}

export function registerCombatRecorder() {
  const Hooks = globalThis.Hooks;
  if (!Hooks?.on || registeredOn.has(Hooks)) return false;
  Hooks.on('combatStart', (combat) => start(combat));
  Hooks.on('combatTurnChange', onTurnChange);
  Hooks.on('updateCombat', (combat, changed) => {
    if (!records.has(combat.id)) {
      if (combat.started && changed?.round && isRecorder()) {
        void Promise.resolve(resume()).then(() => {
          if (!records.has(combat.id)) start(combat);
        });
      }
      return;
    }
    const record = records.get(combat.id);
    if (changed && 'turns' in changed && record) {
      const last = record.rounds.at(-1);
      if (last && last.round === record.round) last.order = turnOrder(combat);
    }
    if (changed?.started === false || (changed?.round === 0 && combat.started === false)) void finalize(combat.id, 'ended');
  });
  Hooks.on('deleteCombat', (combat) => {
    if (records.has(combat.id)) void finalize(combat.id, 'ended');
  });
  Hooks.on('preUpdateActor', onPreUpdateActor);
  Hooks.on('updateActor', (actor) => {
    onUpdateActor(actor);
    onStatusChange(actor);
  });
  for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const parent = effect?.parent;
      onStatusChange(parent?.documentName === 'Actor' ? parent : parent?.actor ?? null);
    });
  }
  Hooks.on('updateCombatant', onUpdateCombatant);
  Hooks.on('createCombatant', onCreateCombatant);
  Hooks.on('updateToken', onUpdateToken);
  Hooks.on('createChatMessage', countMessageRolls);
  Hooks.on('updateChatMessage', (message, changed) => {
    if (changed && 'rolls' in changed) countMessageRolls(message);
  });
  Hooks.once('ready', resume);
  Hooks.on('userConnected', () => {
    if (isRecorder()) void resume();
  });
  registeredOn.add(Hooks);
  return true;
}
