// 채팅 로그 내보내기 흐름(2026-11-28): 메시지 그리기 → 하트 로그 항목 → 장면 컷·전투 요약·날짜 구분 끼우기
// → 그림 모아 넣기 → 단일 HTML 다운로드. 원본 메시지는 읽기만 한다.
import {
  CHAT_LOG_MODULE_ID,
  CREATED_GALLERY_ID,
  dateRangeText,
  defaultChatLogFileName,
  escapeHtml,
  formatClock,
  formatDateKey,
  formatDayLabel,
  formatShortClock,
  sanitizeChatLogFileName,
  scriptJson,
  selectChatRows,
} from './shared.mjs';
import { dayDividerHtml, entryToHeartHtml, messageToEntry, visibleToPlayers } from './heart-format.mjs';
import { planSceneShots, shotCropRect } from './scene-shots.mjs';
import { combatCardHtml, combatStartHtml, replayOrders, replayStepsFromRecord, summarizeCombat } from './combat-replay.mjs';
import { combatRecordFolder } from './combat-recorder.mjs';
import { buildChatLogDocument } from './document.mjs';

const VIDEO = /\.(webm|mp4|m4v|ogv)(?:[?#]|$)/i;

function absoluteUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw || null;
  try {
    return new URL(raw, globalThis.location?.href).href;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function canvasToDataUrl(
  canvas,
  quality = 0.86,
) {
  return new Promise((resolve) => canvas.toBlob(
    (blob) => {
      if (!blob) return resolve(null);
      blobToDataUrl(blob).then(resolve, () => resolve(null));
    },
    'image/webp',
    quality,
  ));
}

const bitmapCache = new Map();

async function loadBitmap(src) {
  const url = absoluteUrl(src);
  if (!url || VIDEO.test(url)) return null;
  if (!bitmapCache.has(url)) {
    bitmapCache.set(url, (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return createImageBitmap(await response.blob());
    })().catch((error) => {
      console.warn(`${CHAT_LOG_MODULE_ID} | 그림을 읽지 못했습니다: ${url}`, error);
      return null;
    }));
  }
  return bitmapCache.get(url);
}

/** 크기를 줄인 WebP data URL. square면 가운데를 정사각으로 자른다. 실패하면 null. */
async function shrunkDataUrl(
  src,
  maxSize,
  { square = false } = {},
) {
  const url = absoluteUrl(src);
  if (!url || VIDEO.test(url)) return null;
  if (url.startsWith('data:')) return url;
  let blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch (error) {
    console.warn(`${CHAT_LOG_MODULE_ID} | 그림을 넣지 못했습니다: ${url}`, error);
    return null;
  }
  const type = String(blob.type ?? '').toLowerCase();
  if (type.includes('svg') || type.includes('gif') || VIDEO.test(url)) return blobToDataUrl(blob);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blobToDataUrl(blob);
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const sourceWidth = square ? side : bitmap.width;
  const sourceHeight = square ? side : bitmap.height;
  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = maxSize && longest > maxSize ? maxSize / longest : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    square ? (bitmap.width - side) / 2 : 0,
    square ? (bitmap.height - side) / 2 : 0,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close?.();
  return (await canvasToDataUrl(canvas)) ?? blobToDataUrl(blob);
}

async function runPool(
  items,
  limit,
  worker,
) {
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    },
  ));
}

/** v14는 배경이 레벨에 있다. 그 레벨(없으면 첫 레벨)의 배경 주소. */
export function sceneBackgroundSource(
  scene,
  levelId = null,
) {
  if (!scene) return null;
  const level = (levelId && scene.levels?.get?.(levelId)) || scene.initialLevel || scene.firstLevel || null;
  const src = level?.background?.src ?? level?.textures?.background?.src ?? scene._source?.background?.src ?? scene._source?.img ?? null;
  return src ? String(src).trim() : null;
}

function sceneName(scene) {
  return scene?.navName || scene?.name || '';
}

async function renderSceneShot(
  shot,
  maxWidth,
) {
  const scene = globalThis.game.scenes?.get(shot.sceneId);
  const bitmap = scene ? await loadBitmap(sceneBackgroundSource(scene, shot.levelId)) : null;
  if (!bitmap) return null;
  const rect = shotCropRect(shot, scene.dimensions, bitmap);
  const scale = Math.min(1, maxWidth / rect.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  canvas.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const dataUrl = await canvasToDataUrl(canvas);
  return dataUrl ? { dataUrl, name: sceneName(scene) } : null;
}

/** 전투 기록 리플레이 HTML. 지도가 없으면 null. */
async function buildReplayHtml(
  record,
  maxWidth = 1200,
) {
  const scene = globalThis.game.scenes?.get(record.sceneId);
  const bitmap = scene ? await loadBitmap(sceneBackgroundSource(scene, record.levelId)) : null;
  if (!bitmap) return null;
  const grid = Number(scene.grid?.size || 100);
  const visible = (record.participants ?? []).filter((participant) => !participant.hidden && participant.tokenId);
  if (!visible.length) return null;
  const visibleIds = visible.map((participant) => participant.tokenId);
  const steps = replayStepsFromRecord(record, visibleIds);
  if (!steps.length) return null;
  const boxes = [];
  for (const participant of visible) {
    const width = participant.w || grid;
    const height = participant.h || grid;
    for (const point of [participant.start, { x: participant.x, y: participant.y }]) {
      if (point && Number.isFinite(point.x)) boxes.push([point.x, point.y, width, height]);
    }
  }
  for (const step of steps) {
    if (!Number.isFinite(step.x)) continue;
    const participant = visible.find((item) => item.tokenId === step.id);
    boxes.push([step.x, step.y, participant?.w || grid, participant?.h || grid]);
  }
  const pad = grid * 1.5;
  let left = Math.min(...boxes.map((box) => box[0])) - pad;
  let top = Math.min(...boxes.map((box) => box[1])) - pad;
  let right = Math.max(...boxes.map((box) => box[0] + box[2])) + pad;
  let bottom = Math.max(...boxes.map((box) => box[1] + box[3])) + pad;
  if (right - left < grid * 10) {
    const center = (left + right) / 2;
    left = center - grid * 5;
    right = center + grid * 5;
  }
  if (bottom - top < (right - left) * 0.5) {
    const center = (top + bottom) / 2;
    const height = (right - left) * 0.5;
    top = center - height / 2;
    bottom = center + height / 2;
  }
  const dims = scene.dimensions;
  const sx = bitmap.width / dims.sceneWidth;
  const sy = bitmap.height / dims.sceneHeight;
  const source = { x: Math.max(0, (left - dims.sceneX) * sx), y: Math.max(0, (top - dims.sceneY) * sy) };
  source.width = Math.min(bitmap.width - source.x, (right - left) * sx);
  source.height = Math.min(bitmap.height - source.y, (bottom - top) * sy);
  if (source.width <= 0 || source.height <= 0) return null;
  const k = Math.min(1, maxWidth / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * k));
  canvas.height = Math.max(1, Math.round(source.height * k));
  canvas.getContext('2d').drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  const image = await canvasToDataUrl(canvas);
  if (!image) return null;
  const tokens = [];
  for (const participant of visible) {
    tokens.push({
      id: participant.tokenId,
      name: participant.name,
      img: await shrunkDataUrl(participant.img, 96, { square: true }) ?? await shrunkDataUrl(participant.portrait, 96, { square: true }),
      disposition: participant.disposition,
      w: participant.w || grid,
      h: participant.h || grid,
      x: participant.start?.x ?? participant.x,
      y: participant.start?.y ?? participant.y,
      hp: participant.startHp,
      max: participant.hp?.max ?? null,
      joinsLater: Number(participant.joined) > Number(record.rounds?.[0]?.round ?? 1),
    });
  }
  const payload = {
    v: 2,
    width: canvas.width,
    height: canvas.height,
    image,
    frame: { x0: dims.sceneX + source.x / sx, y0: dims.sceneY + source.y / sy, k: k * sx },
    tokens,
    orders: replayOrders(record, visibleIds),
    steps,
  };
  return `<div class="log-replay"><script type="application/json" class="log-replay-data">${scriptJson(payload)}</script></div>`;
}

async function fetchJson(path) {
  try {
    const response = await fetch(`/${String(path).replace(/^\/+/, '')}`, { cache: 'no-cache' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** 범위와 겹치는 전투 기록: 워크벤치 기록 폴더 + created-gallery 「전투 종료」 메시지가 가리키는 기록. */
async function collectCombatRecords(
  allMessages,
  from,
  to,
) {
  const found = new Map();
  const overlaps = (record) => Number(record?.startedAt) <= to && Number(record?.endedAt ?? record?.startedAt) >= from;
  try {
    const picker = globalThis.foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const { folder } = combatRecordFolder();
    const listing = await picker.browse('data', folder).catch(() => null);
    const files = (listing?.files ?? []).filter((file) => /\.json$/i.test(file) && !/_active\.json$/i.test(file));
    for (const file of files) {
      const match = decodeURIComponent(file.split('/').pop()).match(/^(\d{8})(\d{6})_/);
      if (match) {
        const stamp = Date.parse(`${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}Z`);
        if (Number.isFinite(stamp) && (stamp > to || stamp < from - 12 * 3600_000)) continue;
      }
      const record = await fetchJson(file);
      if (record?.combatId && overlaps(record)) found.set(record.combatId, record);
    }
  } catch (error) {
    console.warn(`${CHAT_LOG_MODULE_ID} | 전투 기록 폴더를 읽지 못했습니다.`, error);
  }
  for (const message of allMessages) {
    const summary = message.flags?.[CREATED_GALLERY_ID]?.combatSummary;
    if (!summary?.filepath) continue;
    const timestamp = Number(message.timestamp);
    if (timestamp < from || timestamp > to + 3600_000) continue;
    const record = await fetchJson(summary.filepath);
    if (record?.combatId && !found.has(record.combatId)) found.set(record.combatId, record);
  }
  return [...found.values()].sort((left, right) => left.startedAt - right.startedAt);
}

function isCombatSummaryMessage(message) {
  return Boolean(message.flags?.[CREATED_GALLERY_ID]?.combatSummary);
}

function progressNotice(text) {
  try {
    const notice = globalThis.ui?.notifications?.info?.(text, { progress: true, permanent: true });
    if (notice && typeof notice.update === 'function') return notice;
  } catch {
    // 진행 표시가 없는 판이면 넘어간다.
  }
  return { update() {}, remove() {} };
}

/** Foundry 문서에 붙이지 않은 링크로 받는다. 붙이면 Foundry 클릭 처리기가 새 탭으로 돌린다. */
export function downloadHtml(
  filename,
  html,
) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return blob.size;
}

/** 메시지 목록 → 고른 행. 공개판은 플레이어에게 보인 것만, 귓속말 빼기 선택도 따른다. */
export function chatLogRows(
  messages,
  { start = null, end = null, includeWhispers = true, publicCopy = false } = {},
) {
  const rows = messages.map((message, index) => ({
    message,
    index,
    timestamp: Number(message.timestamp),
    whisper: Boolean(message.whisper?.length),
  }));
  return selectChatRows(rows, { start, end, includeWhispers: includeWhispers && !publicCopy })
    .filter((row) => !publicCopy || visibleToPlayers(row.message));
}

/**
 * 채팅 로그 HTML을 만들어 받는다.
 * options: { start, end, title, publicCopy, includeWhispers, withScenes, withCombats, maxImageSize, filename }
 */
export async function exportChatLog({
  start = null,
  end = null,
  title = '',
  publicCopy = false,
  includeWhispers = true,
  withScenes = true,
  withCombats = true,
  maxImageSize = 1600,
  filename = '',
} = {}) {
  const game = globalThis.game;
  const allMessages = game.messages.contents;
  const rows = chatLogRows(allMessages, { start, end, includeWhispers, publicCopy });
  if (!rows.length) throw new Error('고른 범위에 메시지가 없습니다.');
  const notice = progressNotice(`채팅 ${rows.length.toLocaleString()}건을 그리는 중입니다.`);
  const step = (pct, text) => notice.update({ pct, message: text });
  try {
    // 1. 메시지 → 항목
    const entries = [];
    const skipped = {};
    for (const [index, row] of rows.entries()) {
      if (isCombatSummaryMessage(row.message)) {
        skipped['combat-summary'] = (skipped['combat-summary'] ?? 0) + 1;
        continue;
      }
      let element = null;
      try {
        element = await row.message.renderHTML();
      } catch (error) {
        console.warn(`${CHAT_LOG_MODULE_ID} | 메시지 ${row.message.id}를 그리지 못해 문서 자료만 씁니다.`, error);
      }
      const entry = messageToEntry(row.message, element, { publicCopy });
      if (entry.skipped) skipped[entry.skipped] = (skipped[entry.skipped] ?? 0) + 1;
      else entries.push({ ...entry, message: row.message });
      if (index % 25 === 0) step((index / rows.length) * 0.5, `채팅 그리는 중 ${index.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
    if (!entries.length) throw new Error('내보낼 메시지가 없습니다(모두 건너뛰었습니다).');
    const first = entries[0].timestamp;
    const last = entries.at(-1).timestamp;

    // 2. 끼울 것: 날짜 구분, 장면 컷, 전투 시작·요약
    const before = new Map();
    const after = [];
    const toc = [];
    const addBefore = (index, html) => before.set(index, `${before.get(index) ?? ''}${html}`);
    const images = new Map();
    let imageCount = 0;
    const imageRef = (src, maxSize = maxImageSize) => {
      const key = `${src}|${maxSize}`;
      if (!images.has(key)) images.set(key, { placeholder: `__HXIMG_${images.size}__`, src, maxSize });
      return images.get(key).placeholder;
    };
    const portraits = new Map();
    const portraitRef = (src) => {
      if (!portraits.has(src)) portraits.set(src, `--hp${portraits.size}`);
      return portraits.get(src);
    };

    let previousDay = null;
    entries.forEach((entry, index) => {
      const day = formatDateKey(entry.timestamp);
      if (day !== previousDay) {
        addBefore(index, dayDividerHtml(day, `${formatDayLabel(day)} ${formatShortClock(entry.timestamp)}`));
        toc.push({ type: 'day', anchor: `d-${day}`, label: formatDayLabel(day), time: formatShortClock(entry.timestamp), order: index, sub: 0 });
        previousDay = day;
      }
    });

    let combatCount = 0;
    if (withCombats) {
      step(0.52, '전투 기록을 찾는 중');
      const records = await collectCombatRecords(allMessages, first, last);
      for (const record of records) {
        const summary = summarizeCombat(record);
        if (!summary.participants.length) continue;
        combatCount += 1;
        const anchor = `c-${combatCount}`;
        step(0.55, `전투 리플레이를 만드는 중 (${combatCount})`);
        const replayHtml = withScenes ? await buildReplayHtml(record).catch((error) => {
          console.warn(`${CHAT_LOG_MODULE_ID} | 리플레이를 만들지 못했습니다.`, error);
          return null;
        }) : null;
        const startIndex = entries.findIndex((entry) => entry.timestamp >= record.startedAt);
        if (startIndex > 0) addBefore(startIndex, combatStartHtml(summary, `${anchor}-start`));
        const endIndex = entries.findIndex((entry) => entry.timestamp > (record.endedAt ?? record.startedAt));
        const card = combatCardHtml(summary, { replayHtml: replayHtml ?? '', anchorId: anchor });
        if (endIndex === -1) after.push(card);
        else addBefore(endIndex, card);
        const tocIndex = endIndex === -1 ? entries.length : endIndex;
        toc.push({ type: 'combat', anchor, label: `${summary.sceneName ?? '전투'} · ${summary.rounds}라운드`, time: formatShortClock(record.endedAt ?? record.startedAt), order: tocIndex, sub: 2 });
      }
    }

    let sceneCount = 0;
    if (withScenes) {
      const shots = planSceneShots(entries.map((entry) => entry.message), { minLines: 1 });
      for (const [shotIndex, shot] of shots.entries()) {
        step(0.6 + (shotIndex / Math.max(1, shots.length)) * 0.1, `장면 그림 ${shotIndex + 1} / ${shots.length}`);
        const image = await renderSceneShot(shot, maxImageSize || 1600).catch(() => null);
        if (!image) continue;
        sceneCount += 1;
        const anchor = `s-${sceneCount}`;
        const placeholder = `__HXSCENE_${sceneCount}__`;
        images.set(placeholder, { placeholder, dataUrl: image.dataUrl });
        addBefore(shot.start, `<div class="log-scene" id="${anchor}"><img class="log-scene-img" src="${placeholder}" alt="${escapeHtml(image.name)}">${image.name ? `<div class="log-scene-caption">📍 ${escapeHtml(image.name)}</div>` : ''}</div>`);
        toc.push({ type: 'scene', anchor, label: image.name || '장면', time: formatShortClock(entries[shot.start].timestamp), order: shot.start, sub: 1 });
      }
    }

    // 3. 본문
    const out = [];
    let previous = null;
    entries.forEach((entry, index) => {
      if (before.has(index)) {
        out.push(before.get(index));
        previous = null;
      }
      out.push(entryToHeartHtml(entry, previous, { imageRef, portraitRef }));
      previous = entry;
    });
    out.push(...after);

    // 4. 그림 넣기
    const imageData = {};
    const imageJobs = [...images.values()];
    let done = 0;
    await runPool(
      imageJobs,
      6,
      async (job) => {
        const dataUrl = job.dataUrl ?? await shrunkDataUrl(job.src, job.maxSize);
        imageData[job.placeholder] = dataUrl ?? absoluteUrl(job.src) ?? '';
        if (dataUrl) imageCount += 1;
        done += 1;
        step(0.72 + (done / Math.max(1, imageJobs.length + portraits.size)) * 0.26, `그림 넣는 중 ${done} / ${imageJobs.length + portraits.size}`);
      },
    );
    const portraitData = {};
    await runPool(
      [...portraits.entries()],
      6,
      async ([src, name]) => {
        const dataUrl = await shrunkDataUrl(src, 160, { square: true });
        // 읽지 못한 초상(404 등)은 깨진 주소를 남기지 않고 비운다.
        portraitData[name] = dataUrl ?? '';
        if (dataUrl) imageCount += 1;
        done += 1;
      },
    );

    // 5. 문서
    const docTitle = String(title ?? '').trim() || game.world?.title || '채팅 로그';
    const whisperCount = entries.filter((entry) => entry.kind === 'whisper').length;
    const subtitleParts = [
      `${dateRangeText(first, last)} ${formatShortClock(first)} ~ ${formatShortClock(last)}`,
      `메시지 ${entries.length.toLocaleString()}건`,
      sceneCount ? `장면 ${sceneCount}` : '',
      combatCount ? `전투 ${combatCount}` : '',
      publicCopy ? '공개판' : '',
    ].filter(Boolean);
    const now = Date.now();
    toc.sort((left, right) => left.order - right.order || left.sub - right.sub);
    const html = buildChatLogDocument({
      title: docTitle,
      subtitle: subtitleParts.join(' · '),
      body: out.join(''),
      toc,
      images: imageData,
      portraits: portraitData,
      hasWhispers: whisperCount > 0,
      hasScenes: sceneCount > 0,
      hasReplay: out.some((part) => part.includes('log-replay-data')),
      footer: `Nihil Workbench 채팅 로그 · ${game.world?.title ?? ''} · 내보낸 시각 ${formatDateKey(now)} ${formatClock(now)} (한국 표준시)`,
    });
    const name = sanitizeChatLogFileName(filename) || defaultChatLogFileName(docTitle, first, last, { publicCopy });
    const size = downloadHtml(name, html);
    step(1, `${name}(${(size / 1024 / 1024).toFixed(1)}MB)을 받았습니다.`);
    return { filename: name, size, messages: entries.length, skipped, scenes: sceneCount, combats: combatCount, images: imageCount, whispers: whisperCount };
  } finally {
    setTimeout(() => notice.remove?.(), 4000);
  }
}
