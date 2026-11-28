// 채팅 로그 내보내기 창(2026-11-28): 설정 탭 단추와 api.openChatLogExport()로 연다(GM 전용).
import {
  defaultChatLogFileName,
  escapeHtml,
  formatDateKey,
  formatDayLabel,
  formatLocalInput,
  groupByDay,
  parseLocalInput,
} from './shared.mjs';
import { chatLogRows, exportChatLog } from './export.mjs';

const DIALOG_ID = 'ncm-chat-log-export';
export const CHAT_LOG_BUTTON_ACTION = 'open-ncm-chat-log';
const TITLE_STORAGE_KEY = 'nihil-compendium-module.chatLogTitle';

function storedTitle() {
  try {
    return globalThis.localStorage?.getItem(TITLE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeTitle(title) {
  try {
    globalThis.localStorage?.setItem(TITLE_STORAGE_KEY, title);
  } catch {
    // 저장소를 못 쓰면 다음에 다시 적으면 된다.
  }
}

function dialogContent(
  days,
  total,
) {
  const latest = days.at(-1);
  const dayOptions = [...days].reverse().map((day) => (
    `<option value="${day.date}" ${day === latest ? 'selected' : ''}>${escapeHtml(formatDayLabel(day.date))} · ${day.count.toLocaleString()}건</option>`
  )).join('');
  const row = 'display:grid;gap:4px';
  return `
  <div class="ncm-chat-log" style="display:grid;gap:10px">
    <p style="margin:0">채팅을 RP 로그(하트 형식) HTML 하나로 받습니다. 장면 지도, 전투 요약·리플레이, 날짜별 구분과 목차가 들어갑니다. 원본 메시지는 바꾸지 않습니다. 시각은 한국 표준시입니다.</p>
    <label style="${row}">로그 제목<input name="title" type="text" placeholder="예: 센트럴 워치 4 늑대와 소녀"></label>
    <label style="${row}">날짜
      <select name="day">
        ${dayOptions}
        <option value="all">전체 · ${total.toLocaleString()}건</option>
        <option value="custom">직접 지정</option>
      </select>
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="${row}">시작 시각<input name="start" type="datetime-local" step="1"></label>
      <label style="${row}">끝 시각<input name="end" type="datetime-local" step="1"></label>
    </div>
    <fieldset style="display:grid;gap:6px;margin:0;padding:6px 10px">
      <legend>담을 것</legend>
      <label><input name="publicCopy" type="checkbox"> 플레이어 공개판(귓속말·GM 전용 굴림·숨긴 전투원 빼기)</label>
      <label><input name="whispers" type="checkbox" checked> 귓속말 포함</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center">
        <label><input name="withScenes" type="checkbox" checked> 장면 지도</label>
        <label style="display:inline-flex;gap:6px;align-items:center">한 장면 최소 <input name="sceneMinLines" type="number" min="1" max="500" value="20" style="width:64px"> 줄</label>
      </div>
      <label><input name="withCombats" type="checkbox" checked> 전투 요약과 리플레이</label>
      <label style="display:inline-flex;gap:6px;align-items:center">큰 그림 최대
        <select name="maxSize" style="width:auto">
          <option value="1024">1024px</option>
          <option value="1600" selected>1600px</option>
          <option value="2400">2400px</option>
        </select>
      </label>
    </fieldset>
    <label style="${row}">파일 이름<input name="filename" type="text"></label>
    <p data-summary role="status" style="margin:0;font-weight:600"></p>
  </div>`;
}

function readForm(root) {
  const value = (name) => root.querySelector(`[name="${name}"]`);
  return {
    title: value('title').value.trim(),
    start: parseLocalInput(value('start').value),
    end: parseLocalInput(
      value('end').value,
      { endOfSecond: true },
    ),
    publicCopy: value('publicCopy').checked,
    includeWhispers: value('whispers').checked,
    withScenes: value('withScenes').checked,
    sceneMinLines: Math.max(1, Number(value('sceneMinLines').value) || 20),
    withCombats: value('withCombats').checked,
    maxImageSize: Number(value('maxSize').value) || 1600,
    filename: value('filename').value,
  };
}

function wireDialog(
  dialog,
  messages,
  days,
) {
  const root = dialog.element;
  const field = (name) => root.querySelector(`[name="${name}"]`);
  const summary = root.querySelector('[data-summary]');
  let filenameEdited = false;
  field('title').value = storedTitle() || globalThis.game.world?.title || '';
  const applyDay = () => {
    const value = field('day').value;
    if (value === 'custom') return;
    const all = { first: Number(messages[0].timestamp), last: Number(messages.at(-1).timestamp) };
    const day = value === 'all' ? all : days.find((entry) => entry.date === value);
    if (!day) return;
    field('start').value = formatLocalInput(day.first);
    field('end').value = formatLocalInput(day.last);
  };
  const refresh = () => {
    const form = readForm(root);
    const exportButton = root.querySelector('[data-action="export"]');
    field('whispers').disabled = form.publicCopy;
    field('sceneMinLines').disabled = !form.withScenes;
    if (Number.isNaN(form.start) || Number.isNaN(form.end) || (form.start !== null && form.end !== null && form.start > form.end)) {
      summary.textContent = '시작·끝 시각을 확인해 주세요.';
      if (exportButton) exportButton.disabled = true;
      return;
    }
    const rows = chatLogRows(messages, form);
    const whispers = rows.filter((row) => row.whisper).length;
    const dayCount = new Set(rows.map((row) => formatDateKey(row.timestamp))).size;
    summary.textContent = rows.length
      ? `메시지 ${rows.length.toLocaleString()}건 · ${dayCount}일${whispers ? ` · 귓속말 ${whispers}건` : ''}${form.publicCopy ? ' · 공개판' : ''}`
      : '고른 범위에 메시지가 없습니다.';
    if (!filenameEdited) {
      field('filename').value = rows.length
        ? defaultChatLogFileName(form.title || globalThis.game.world?.title, rows[0].timestamp, rows.at(-1).timestamp, { publicCopy: form.publicCopy })
        : '';
    }
    if (exportButton) exportButton.disabled = !rows.length;
  };
  field('day').addEventListener('change', () => {
    applyDay();
    refresh();
  });
  for (const name of ['start', 'end']) {
    field(name).addEventListener('change', () => {
      field('day').value = 'custom';
      refresh();
    });
  }
  field('filename').addEventListener('input', () => {
    filenameEdited = Boolean(field('filename').value.trim());
  });
  root.addEventListener('input', (event) => {
    if (['title', 'sceneMinLines'].includes(event.target?.name)) refresh();
  });
  root.addEventListener('change', (event) => {
    if (['publicCopy', 'whispers', 'withScenes', 'withCombats', 'maxSize'].includes(event.target?.name)) refresh();
  });
  applyDay();
  refresh();
}

/** GM 전용 채팅 로그 내보내기 창. */
export async function openChatLogExport() {
  const game = globalThis.game;
  const foundry = globalThis.foundry;
  if (!game?.user?.isGM) {
    globalThis.ui?.notifications?.warn('채팅 로그 내보내기는 GM만 쓸 수 있습니다.');
    return null;
  }
  const existing = foundry.applications.instances?.get?.(DIALOG_ID);
  if (existing) {
    existing.bringToFront?.();
    return existing;
  }
  const messages = game.messages.contents
    .filter((message) => Number.isFinite(Number(message.timestamp)))
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
  if (!messages.length) {
    globalThis.ui?.notifications?.warn('현재 월드에 내보낼 채팅이 없습니다.');
    return null;
  }
  const days = groupByDay(messages.map((message) => Number(message.timestamp)));
  const dialog = new foundry.applications.api.DialogV2({
    id: DIALOG_ID,
    window: { title: '채팅 로그 내보내기', icon: 'fa-solid fa-scroll', resizable: true },
    position: { width: 600 },
    form: { closeOnSubmit: false },
    content: dialogContent(days, messages.length),
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
          if (form.title) storeTitle(form.title);
          button.disabled = true;
          try {
            const result = await exportChatLog(form);
            const skipped = Object.values(result.skipped).reduce((sum, count) => sum + count, 0);
            globalThis.ui?.notifications?.info(`${result.filename} 받기 완료 — 메시지 ${result.messages.toLocaleString()}건, 장면 ${result.scenes}, 전투 ${result.combats}${skipped ? `, 건너뜀 ${skipped}건` : ''}`);
          } catch (error) {
            console.error('nihil-compendium-module | 채팅 로그 내보내기 실패', error);
            globalThis.ui?.notifications?.error(`채팅 로그 내보내기 실패: ${error?.message ?? error}`);
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
      messages,
      days,
    ),
    { once: true },
  );
  await dialog.render({ force: true });
  return dialog;
}

/** 설정 탭에 GM용 「채팅 로그 내보내기」 단추를 붙인다. */
export function injectSettingsChatLogButton(html) {
  if (!globalThis.game?.user?.isGM) return false;
  const root = html?.querySelector ? html : html?.[0];
  if (!root?.ownerDocument) return false;
  if (root.querySelector(`[data-action="${CHAT_LOG_BUTTON_ACTION}"]`)) return false;
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.dataset.action = CHAT_LOG_BUTTON_ACTION;
  button.innerHTML = '<i class="fa-solid fa-scroll"></i> 채팅 로그 내보내기';
  button.addEventListener('click', () => openChatLogExport());
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
