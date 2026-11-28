// 장면 컷(2026-11-28): 같은 장면·같은 자리에서 이어진 메시지를 한 컷으로 묶고,
// 충분히 긴 컷 앞에 그때 보던 지도 부분을 넣는다.
//
// 메시지마다 말한 자리를 플래그로 남긴다(메시지를 만드는 클라이언트가 저장 전에 적어 추가 쓰기가 없다).
//   flags['nihil-compendium-module'].scene = { id, level?, x, y, scale, w, h, token?: { x, y } }
// x·y는 화면 가운데의 캔버스 좌표, w·h는 화면 크기, scale은 확대 배율이다.
// created-gallery가 남긴 같은 모양의 플래그와 speaker.scene도 읽는다.
import { CHAT_LOG_MODULE_ID, CREATED_GALLERY_ID } from './shared.mjs';

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 메시지(문서 또는 원본 자료)가 말해진 장면·초점·화면 크기. 모르면 null. */
export function messageSceneContext(message) {
  const flags = message?.flags ?? {};
  const flagged = flags[CHAT_LOG_MODULE_ID]?.scene ?? flags[CREATED_GALLERY_ID]?.scene ?? null;
  const sceneId = flagged?.id || message?.speaker?.scene || null;
  if (!sceneId) return null;
  const scale = finiteOrNull(flagged?.scale) ?? 0;
  const width = finiteOrNull(flagged?.w) ?? 0;
  const height = finiteOrNull(flagged?.h) ?? 0;
  const view = flagged && scale > 0 && width > 0 && height > 0
    ? { x: Number(flagged.x), y: Number(flagged.y), width: width / scale, height: height / scale }
    : null;
  const tokenX = finiteOrNull(flagged?.token?.x);
  const tokenY = finiteOrNull(flagged?.token?.y);
  const token = tokenX !== null && tokenY !== null ? { x: tokenX, y: tokenY } : null;
  const focus = token ?? (view ? { x: view.x, y: view.y } : null);
  return { sceneId, levelId: flagged?.level ?? null, focus, view };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 메시지를 컷으로 묶고 그림을 넣을 만큼 긴 컷만 돌려준다.
 * skip(message, index)가 참인 메시지는 줄 수에 넣지 않는다(전투 요약 등).
 * @returns {{start, count, sceneId, levelId, focus, view}[]}
 */
export function planSceneShots(
  messages,
  { minLines = 20, moveRatio = 0.6, skip = null } = {},
) {
  const threshold = Math.max(1, Number(minLines) || 1);
  const shots = [];
  let current = null;
  (messages ?? []).forEach((message, index) => {
    if (skip?.(message, index)) return;
    const context = messageSceneContext(message);
    if (!context) {
      if (current) current.count += 1;
      return;
    }
    const lastView = current?.views.at(-1) ?? context.view;
    const reach = lastView ? Math.min(lastView.width, lastView.height) * moveRatio : Infinity;
    const moved = Boolean(current?.anchor && context.focus && distance(current.anchor, context.focus) > reach);
    if (!current || current.sceneId !== context.sceneId || moved) {
      current = {
        start: index,
        count: 0,
        sceneId: context.sceneId,
        levelId: context.levelId,
        anchor: context.focus,
        points: [],
        views: [],
      };
      shots.push(current);
    }
    if (!current.anchor && context.focus) current.anchor = context.focus;
    if (!current.levelId && context.levelId) current.levelId = context.levelId;
    if (context.focus) current.points.push(context.focus);
    if (context.view) current.views.push(context.view);
    current.count += 1;
  });
  return shots
    .filter((shot) => shot.count >= threshold)
    .map((shot) => ({
      start: shot.start,
      count: shot.count,
      sceneId: shot.sceneId,
      levelId: shot.levelId ?? null,
      focus: shot.points.length
        ? { x: median(shot.points.map((point) => point.x)), y: median(shot.points.map((point) => point.y)) }
        : null,
      view: shot.views.length
        ? { width: median(shot.views.map((view) => view.width)), height: median(shot.views.map((view) => view.height)) }
        : null,
    }));
}

/**
 * 배경 그림에서 잘라 낼 사각형(그림 픽셀). 초점이 없으면 지도 전체.
 * dims: scene.dimensions({ sceneX, sceneY, sceneWidth, sceneHeight }), image: { width, height }.
 */
export function shotCropRect(
  shot,
  dims,
  image,
) {
  const full = { x: 0, y: 0, width: image.width, height: image.height };
  if (!shot?.focus || !dims?.sceneWidth || !dims?.sceneHeight) return full;
  const sx = image.width / dims.sceneWidth;
  const sy = image.height / dims.sceneHeight;
  const viewWidth = Math.min(Math.max(shot.view?.width || dims.sceneWidth / 2, 600), dims.sceneWidth);
  const viewHeight = Math.min(Math.max(shot.view?.height || viewWidth * 9 / 16, 400), dims.sceneHeight);
  const width = Math.min(image.width, Math.round(viewWidth * sx));
  const height = Math.min(image.height, Math.round(viewHeight * sy));
  const centerX = (shot.focus.x - (dims.sceneX || 0)) * sx;
  const centerY = (shot.focus.y - (dims.sceneY || 0)) * sy;
  const x = Math.round(Math.min(Math.max(centerX - width / 2, 0), image.width - width));
  const y = Math.round(Math.min(Math.max(centerY - height / 2, 0), image.height - height));
  return { x, y, width, height };
}

/** 메시지를 만드는 클라이언트에서 말한 자리를 플래그로 적는다. */
function recordSceneContext(
  message,
  _data,
  _options,
  userId,
) {
  const game = globalThis.game;
  const canvas = globalThis.canvas;
  if (userId !== game?.user?.id) return;
  if (message.flags?.[CHAT_LOG_MODULE_ID]?.scene) return;
  try {
    const viewed = canvas?.ready ? canvas.scene : null;
    const sceneId = message.speaker?.scene || viewed?.id || null;
    if (!sceneId) return;
    const context = { id: sceneId };
    if (viewed && viewed.id === sceneId && canvas.stage) {
      const [width, height] = canvas.screenDimensions ?? [globalThis.innerWidth, globalThis.innerHeight];
      context.x = Math.round(canvas.stage.pivot.x);
      context.y = Math.round(canvas.stage.pivot.y);
      context.scale = Math.round(canvas.stage.scale.x * 1000) / 1000;
      context.w = Math.round(width);
      context.h = Math.round(height);
      const levelId = canvas.level?.id ?? null;
      if (levelId) context.level = levelId;
      const token = message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null;
      if (token?.center) context.token = { x: Math.round(token.center.x), y: Math.round(token.center.y) };
    }
    message.updateSource({ [`flags.${CHAT_LOG_MODULE_ID}.scene`]: context });
  } catch (error) {
    console.debug(`${CHAT_LOG_MODULE_ID} | 장면 자리를 적지 못했습니다.`, error);
  }
}

const sceneRecorderRegisteredOn = new WeakSet();

export function registerSceneRecorder() {
  const Hooks = globalThis.Hooks;
  if (!Hooks?.on || sceneRecorderRegisteredOn.has(Hooks)) return false;
  Hooks.on('preCreateChatMessage', recordSceneContext);
  sceneRecorderRegisteredOn.add(Hooks);
  return true;
}
