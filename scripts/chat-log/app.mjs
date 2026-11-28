// 채팅 내보내기(2026-11-28): 월드 채팅을 날짜별로 묶은 단일 HTML 파일로 받는다.
// created-gallery 채팅 아카이브의 HTML 내보내기를 대신하는 워크벤치 자체 기능이다.
// 원본 메시지는 읽기만 한다. 그림은 파일 안에 넣어 Foundry 없이도 열린다.
import {
  buildChatExportDocument,
  defaultChatExportFileName,
  escapeHtml,
  formatClock,
  formatDateKey,
  formatDayLabel,
  formatLocalInput,
  groupByDay,
  parseLocalInput,
  sanitizeChatExportFileName,
  selectChatRows,
} from './chat-export-core.mjs';

const DIALOG_ID = 'ncm-chat-export';
export const CHAT_EXPORT_BUTTON_ACTION = 'open-ncm-chat-export';
const SMALL_IMAGE_SELECTOR = '.avatar img, .message-sender img, .card-header img, .item-icon img, img.gold-icon';
const STRIP_SELECTOR = [
  'script',
  'style',
  'button',
  'input',
  'select',
  'textarea',
  '.message-metadata',
  '.message-delete',
  '.chat-control',
  '.card-buttons',
  '.chevron',
  'i[class*="fa-"]',
].join(', ');

function rowsFromMessages(messages) {
  return messages.map((message, index) => ({
    message,
    index,
    timestamp: Number(message.timestamp),
    whisper: Boolean(message.whisper?.length),
  }));
}

function absoluteUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('#')) return null;
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

/** 래스터 그림은 WebP로 줄인다. SVG·GIF·읽지 못하는 그림은 그대로 둔다. */
async function shrinkImage(blob, maxSize) {
  const type = String(blob.type ?? '').toLowerCase();
  if (!maxSize || type.includes('svg') || type.includes('gif') || typeof createImageBitmap !== 'function') return blob;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxSize ? maxSize / longest : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!webp || webp.type !== 'image/webp') return blob;
  return webp.size < blob.size || scale < 1 ? webp : blob;
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

function whisperBadge(message) {
  if (!message.whisper?.length) return '';
  const names = message.whisper
    .map((id) => globalThis.game?.users?.get(id)?.name)
    .filter(Boolean);
  const label = message.blind ? '블라인드' : '귓속말';
  return `<span class="nx-badge">${escapeHtml(names.length ? `${label} → ${names.join(', ')}` : label)}</span>`;
}

function fallbackElement(message) {
  const item = document.createElement('li');
  item.className = 'chat-message message';
  const alias = message.alias ?? message.speaker?.alias ?? message.author?.name ?? '';
  const text = new DOMParser().parseFromString(String(message.content ?? ''), 'text/html').body.textContent ?? '';
  item.innerHTML = `<header class="message-header"><h4 class="message-sender"><span class="name-stacked"><span class="title">${escapeHtml(alias)}</span></span></h4></header><div class="message-content">${escapeHtml(text)}</div>`;
  return item;
}

async function renderMessage(message) {
  try {
    const element = await message.renderHTML();
    if (element instanceof HTMLElement) return element;
  } catch (error) {
    console.warn(`nihil-compendium-module | 채팅 내보내기: 메시지 ${message.id}를 그리지 못해 글자만 남깁니다.`, error);
  }
  return fallbackElement(message);
}

/** 그려진 메시지에서 조작 단추를 걷어 내고 시각·귓속말 표시를 붙인다. 그림 주소는 images에 모은다. */
function prepareElement(
  element,
  message,
  imageUses,
) {
  element.querySelectorAll(STRIP_SELECTOR).forEach((node) => node.remove());
  for (const node of [element, ...element.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }
  element.querySelectorAll('a[href]').forEach((link) => {
    const href = absoluteUrl(link.getAttribute('href'));
    if (href && /^https?:/i.test(href) && !link.classList.contains('content-link')) {
      link.setAttribute('href', href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    } else {
      link.removeAttribute('href');
    }
  });
  element.querySelectorAll('img').forEach((image) => {
    const url = absoluteUrl(image.getAttribute('src'));
    if (!url) return;
    const small = image.matches(SMALL_IMAGE_SELECTOR);
    imageUses.push({ image, url, small });
  });
  const header = element.querySelector('.message-header') ?? element;
  const stamp = document.createElement('span');
  stamp.className = 'nx-time';
  stamp.textContent = formatClock(Number(message.timestamp));
  stamp.title = `${formatDateKey(Number(message.timestamp))} ${formatClock(Number(message.timestamp))}`;
  const sender = header.querySelector('.message-sender');
  if (sender) sender.after(stamp);
  else header.prepend(stamp);
  const badge = whisperBadge(message);
  if (badge) stamp.insertAdjacentHTML('afterend', badge);
  element.classList.toggle('whisper', Boolean(message.whisper?.length));
  element.removeAttribute('data-message-id');
  return element;
}

async function embedImages(
  imageUses,
  { embed, maxSize, onProgress },
) {
  const images = {};
  if (!embed) {
    for (const use of imageUses) use.image.setAttribute('src', use.url);
    return images;
  }
  const byUrl = new Map();
  for (const use of imageUses) {
    const key = `${use.url}|${use.small ? 'small' : 'large'}`;
    if (!byUrl.has(key)) byUrl.set(key, { url: use.url, small: use.small, uses: [] });
    byUrl.get(key).uses.push(use);
  }
  const groups = [...byUrl.values()];
  let done = 0;
  await runPool(
    groups,
    6,
    async (group, index) => {
      const id = `i${index}`;
      try {
        const response = await fetch(group.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await shrinkImage(await response.blob(), group.small ? 128 : maxSize);
        images[id] = await blobToDataUrl(blob);
        for (const use of group.uses) {
          use.image.removeAttribute('src');
          use.image.setAttribute('data-nx-img', id);
        }
      } catch (error) {
        console.warn(`nihil-compendium-module | 채팅 내보내기: 그림을 넣지 못해 주소로 남깁니다. ${group.url}`, error);
        for (const use of group.uses) use.image.setAttribute('src', group.url);
      }
      done += 1;
      onProgress?.(done, groups.length);
    },
  );
  return images;
}

/** Foundry 문서에 붙이지 않은 링크로 받는다. 붙이면 Foundry 클릭 처리기가 새 탭으로 돌린다. */
export function downloadHtml(filename, html) {
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

function progressNotice(message) {
  const notifications = globalThis.ui?.notifications;
  try {
    const notice = notifications?.info?.(message, { progress: true, permanent: true });
    if (notice && typeof notice.update === 'function') return notice;
  } catch {
    // 진행 표시를 못 쓰는 판이면 그냥 넘어간다.
  }
  return { update() {}, remove() {} };
}

/** 고른 메시지를 HTML 문서로 만든다. */
export async function exportChatHtml({
  start = null,
  end = null,
  includeWhispers = true,
  embedImages: embed = true,
  maxImageSize = 1600,
  filename,
} = {}) {
  const game = globalThis.game;
  const rows = selectChatRows(
    rowsFromMessages(game.messages.contents),
    { start, end, includeWhispers },
  );
  if (!rows.length) throw new Error('고른 범위에 메시지가 없습니다.');
  const notice = progressNotice(`채팅 ${rows.length.toLocaleString()}건을 그리는 중입니다.`);
  try {
    const imageUses = [];
    const days = new Map();
    for (const [index, row] of rows.entries()) {
      const element = prepareElement(
        await renderMessage(row.message),
        row.message,
        imageUses,
      );
      const key = formatDateKey(row.timestamp);
      if (!days.has(key)) days.set(key, { date: key, elements: [] });
      days.get(key).elements.push(element);
      if (index % 25 === 0) notice.update({ pct: (index / rows.length) * 0.7, message: `채팅 그리는 중 ${index.toLocaleString()} / ${rows.length.toLocaleString()}` });
    }
    const images = await embedImages(
      imageUses,
      {
        embed,
        maxSize: maxImageSize,
        onProgress: (done, total) => notice.update({ pct: 0.7 + (done / total) * 0.28, message: `그림 넣는 중 ${done} / ${total}` }),
      },
    );
    const first = rows[0].timestamp;
    const last = rows.at(-1).timestamp;
    const firstDate = formatDateKey(first);
    const lastDate = formatDateKey(last);
    const title = firstDate === lastDate ? `채팅 기록 ${formatDayLabel(firstDate)}` : `채팅 기록 ${firstDate} ~ ${lastDate}`;
    const html = buildChatExportDocument({
      title,
      worldTitle: game.world?.title ?? '',
      rangeLabel: `${firstDate} ${formatClock(first)} ~ ${lastDate} ${formatClock(last)}`,
      exportedAt: Date.now(),
      exportedBy: game.user?.name ?? '',
      days: [...days.values()].map((day) => ({ date: day.date, messages: day.elements.map((element) => element.outerHTML) })),
      images,
      hasWhispers: rows.some((row) => row.whisper),
    });
    const name = sanitizeChatExportFileName(filename) || defaultChatExportFileName(first, last);
    const size = downloadHtml(name, html);
    notice.update({ pct: 1, message: `채팅 ${rows.length.toLocaleString()}건을 ${name}(으)로 받았습니다.` });
    return { filename: name, count: rows.length, size, images: Object.keys(images).length };
  } finally {
    setTimeout(() => notice.remove?.(), 4000);
  }
}

function dialogContent(days, total) {
  const latest = days.at(-1);
  const dayOptions = [...days].reverse().map((day) => (
    `<option value="${day.date}" ${day === latest ? 'selected' : ''}>${escapeHtml(formatDayLabel(day.date))} · ${day.count.toLocaleString()}건</option>`
  )).join('');
  return `
  <div class="ncm-chat-export" style="display:grid;gap:10px">
    <p style="margin:0">월드 채팅을 날짜별로 묶어 HTML 파일 하나로 받습니다. 원본 메시지는 바꾸지 않습니다. 시각은 한국 표준시입니다.</p>
    <label style="display:grid;gap:4px">날짜
      <select name="day">
        ${dayOptions}
        <option value="all">전체 · ${total.toLocaleString()}건</option>
        <option value="custom">직접 지정</option>
      </select>
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="display:grid;gap:4px">시작 시각<input name="start" type="datetime-local" step="1"></label>
      <label style="display:grid;gap:4px">끝 시각<input name="end" type="datetime-local" step="1"></label>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 18px">
      <label><input name="whispers" type="checkbox" checked> 귓속말 포함</label>
      <label><input name="embed" type="checkbox" checked> 그림을 파일 안에 넣기</label>
      <label style="display:inline-flex;gap:6px;align-items:center">큰 그림 최대
        <select name="maxSize" style="width:auto">
          <option value="1024">1024px</option>
          <option value="1600" selected>1600px</option>
          <option value="0">원본</option>
        </select>
      </label>
    </div>
    <label style="display:grid;gap:4px">파일 이름<input name="filename" type="text"></label>
    <p data-summary role="status" style="margin:0;font-weight:600"></p>
  </div>`;
}

function readForm(root) {
  const start = parseLocalInput(root.querySelector('[name="start"]').value);
  const end = parseLocalInput(
    root.querySelector('[name="end"]').value,
    { endOfSecond: true },
  );
  return {
    start,
    end,
    includeWhispers: root.querySelector('[name="whispers"]').checked,
    embedImages: root.querySelector('[name="embed"]').checked,
    maxImageSize: Number(root.querySelector('[name="maxSize"]').value),
    filename: root.querySelector('[name="filename"]').value,
  };
}

function wireDialog(
  dialog,
  rows,
  days,
) {
  const root = dialog.element;
  const fields = {
    day: root.querySelector('[name="day"]'),
    start: root.querySelector('[name="start"]'),
    end: root.querySelector('[name="end"]'),
    filename: root.querySelector('[name="filename"]'),
    summary: root.querySelector('[data-summary]'),
  };
  let filenameEdited = false;
  const applyDay = () => {
    const value = fields.day.value;
    if (value === 'custom') return;
    const day = value === 'all'
      ? { first: rows[0].timestamp, last: rows.at(-1).timestamp }
      : days.find((entry) => entry.date === value);
    if (!day) return;
    fields.start.value = formatLocalInput(day.first);
    fields.end.value = formatLocalInput(day.last);
  };
  const refresh = () => {
    const form = readForm(root);
    const exportButton = root.querySelector('[data-action="export"]');
    if (Number.isNaN(form.start) || Number.isNaN(form.end) || (form.start !== null && form.end !== null && form.start > form.end)) {
      fields.summary.textContent = '시작·끝 시각을 확인해 주세요.';
      if (exportButton) exportButton.disabled = true;
      return null;
    }
    const selected = selectChatRows(rows, form);
    const whispers = selected.filter((row) => row.whisper).length;
    const dayCount = new Set(selected.map((row) => formatDateKey(row.timestamp))).size;
    fields.summary.textContent = selected.length
      ? `메시지 ${selected.length.toLocaleString()}건 · ${dayCount}일${whispers ? ` · 귓속말 ${whispers}건 포함` : ''}`
      : '고른 범위에 메시지가 없습니다.';
    if (!filenameEdited) {
      fields.filename.value = selected.length
        ? defaultChatExportFileName(selected[0].timestamp, selected.at(-1).timestamp)
        : '채팅 기록.html';
    }
    if (exportButton) exportButton.disabled = !selected.length;
    return selected;
  };
  fields.day.addEventListener('change', () => {
    applyDay();
    refresh();
  });
  for (const input of [fields.start, fields.end]) {
    input.addEventListener('change', () => {
      fields.day.value = 'custom';
      refresh();
    });
  }
  fields.filename.addEventListener('input', () => {
    filenameEdited = Boolean(fields.filename.value.trim());
  });
  root.addEventListener('change', (event) => {
    if (event.target?.name === 'whispers') refresh();
  });
  applyDay();
  refresh();
}

/** GM 전용 채팅 내보내기 창. */
export async function openChatExport() {
  const game = globalThis.game;
  if (!game?.user?.isGM) {
    globalThis.ui?.notifications?.warn('채팅 내보내기는 GM만 쓸 수 있습니다.');
    return null;
  }
  const existing = foundry.applications.instances?.get?.(DIALOG_ID);
  if (existing) {
    existing.bringToFront?.();
    return existing;
  }
  const rows = selectChatRows(rowsFromMessages(game.messages.contents));
  if (!rows.length) {
    globalThis.ui?.notifications?.warn('현재 월드에 내보낼 채팅이 없습니다.');
    return null;
  }
  const days = groupByDay(rows.map((row) => row.timestamp));
  const dialog = new foundry.applications.api.DialogV2({
    id: DIALOG_ID,
    window: { title: '채팅 내보내기', icon: 'fa-solid fa-file-export', resizable: true },
    position: { width: 560 },
    form: { closeOnSubmit: false },
    content: dialogContent(days, rows.length),
    buttons: [
      {
        action: 'export',
        label: 'HTML 내보내기',
        icon: 'fa-solid fa-download',
        default: true,
        callback: async (
          _event,
          button,
          app,
        ) => {
          const form = readForm(app.element);
          button.disabled = true;
          try {
            const result = await exportChatHtml(form);
            globalThis.ui?.notifications?.info(`채팅 ${result.count.toLocaleString()}건을 ${result.filename}(으)로 받았습니다.`);
          } catch (error) {
            console.error('nihil-compendium-module | 채팅 내보내기 실패', error);
            globalThis.ui?.notifications?.error(`채팅 내보내기 실패: ${error?.message ?? error}`);
          } finally {
            button.disabled = false;
          }
        },
      },
      {
        action: 'close',
        label: '닫기',
        callback: async (
          _event,
          _button,
          app,
        ) => {
          await app.close();
        },
      },
    ],
  });
  dialog.addEventListener(
    'render',
    () => wireDialog(
      dialog,
      rows,
      days,
    ),
    { once: true },
  );
  await dialog.render({ force: true });
  return dialog;
}

/** 설정 탭에 GM용 「채팅 내보내기」 단추를 붙인다. */
export function injectSettingsChatExportButton(html) {
  if (!globalThis.game?.user?.isGM) return false;
  const root = html?.querySelector ? html : html?.[0];
  if (!root?.ownerDocument) return false;
  if (root.querySelector(`[data-action="${CHAT_EXPORT_BUTTON_ACTION}"]`)) return false;
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.dataset.action = CHAT_EXPORT_BUTTON_ACTION;
  button.innerHTML = '<i class="fa-solid fa-file-export"></i> 채팅 내보내기';
  button.addEventListener('click', () => openChatExport());
  const after = root.querySelector('[data-action="open-ncm-resource-manager"]')
    ?? root.querySelector('[data-action="open-ncm-workbench"]');
  if (after) {
    after.after(button);
    return true;
  }
  const first = root.querySelector('button');
  if (first) first.before(button);
  else root.prepend(button);
  return true;
}
