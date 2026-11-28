// 채팅 내보내기의 순수 함수 모음(2026-11-28). Foundry 없이 node 시험으로 확인한다.
// 시각은 모두 한국 표준시(Asia/Seoul)로 적는다.

export const CHAT_EXPORT_TIME_ZONE = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function zonedParts(timestamp) {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: CHAT_EXPORT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    },
  ).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** 2026-11-28 */
export function formatDateKey(timestamp) {
  const parts = zonedParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 21:05:09 */
export function formatClock(timestamp) {
  const parts = zonedParts(timestamp);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

/** 2026-11-28T21:05:09 (datetime-local 입력값) */
export function formatLocalInput(timestamp) {
  return `${formatDateKey(timestamp)}T${formatClock(timestamp)}`;
}

/** datetime-local 입력값을 한국 표준시로 읽는다. 비었으면 null, 잘못되면 NaN. */
export function parseLocalInput(value, { endOfSecond = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = /T\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
  const parsed = Date.parse(`${normalized}+09:00`);
  if (Number.isNaN(parsed)) return Number.NaN;
  return endOfSecond ? parsed + 999 : parsed;
}

/** 2026년 11월 28일 (토) */
export function formatDayLabel(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}

/** 시각 목록을 날짜별로 묶는다. 날짜 오름차순. */
export function groupByDay(timestamps) {
  const days = new Map();
  for (const timestamp of timestamps) {
    if (!Number.isFinite(timestamp)) continue;
    const key = formatDateKey(timestamp);
    const day = days.get(key) ?? { date: key, count: 0, first: timestamp, last: timestamp };
    day.count += 1;
    day.first = Math.min(day.first, timestamp);
    day.last = Math.max(day.last, timestamp);
    days.set(key, day);
  }
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/** 범위의 날짜를 붙인 기본 파일 이름. */
export function defaultChatExportFileName(firstTimestamp, lastTimestamp) {
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) return '채팅 기록.html';
  const first = formatDateKey(firstTimestamp);
  const last = formatDateKey(lastTimestamp);
  return first === last ? `채팅 기록 ${first}.html` : `채팅 기록 ${first}~${last}.html`;
}

/** 파일 이름에 못 쓰는 글자를 바꾸고 .html을 붙인다. 쓸 글자가 없으면 빈 문자열. */
export function sanitizeChatExportFileName(name) {
  let text = String(name ?? '')
    .replace(
      /[<>:"/\\|?*\x00-\x1f]/g,
      '_',
    )
    .trim()
    .replace(
      /[. ]+$/g,
      '',
    );
  text = text.replace(
    /\.html?$/i,
    '',
  ).trim();
  if (!text || /^[_.\s]+$/.test(text)) return '';
  return `${text}.html`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character],
  );
}

/**
 * 시간 범위·귓속말 조건으로 메시지를 고른다.
 * rows: [{ timestamp, whisper: boolean, index }]
 */
export function selectChatRows(
  rows,
  { start = null, end = null, includeWhispers = true } = {},
) {
  return rows
    .filter((row) => Number.isFinite(row.timestamp))
    .filter((row) => start === null || row.timestamp >= start)
    .filter((row) => end === null || row.timestamp <= end)
    .filter((row) => includeWhispers || !row.whisper)
    .sort((left, right) => left.timestamp - right.timestamp || (left.index ?? 0) - (right.index ?? 0));
}

function exportCss() {
  return `
  :root { color-scheme: light; --paper: #f4f0e6; --card: #fffdf8; --ink: #22201b; --muted: #6f6857; --line: #ddd4c0; --accent: #7a2e12; --whisper: #5a3f8c; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.6 'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; }
  .nx-top { position: sticky; top: 0; z-index: 5; background: #2a2015; color: #f5ecd8; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
  .nx-top-inner { max-width: 860px; margin: 0 auto; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .nx-top h1 { margin: 0; font-size: 17px; flex: 1 1 260px; }
  .nx-top .nx-meta { font-size: 12.5px; color: #d8cbb0; flex: 1 1 100%; }
  .nx-top input[type=search] { flex: 1 1 200px; min-width: 0; height: 30px; padding: 0 10px; border: 1px solid #6f5f3f; border-radius: 6px; background: #fffdf7; color: var(--ink); }
  .nx-top label { font-size: 13px; display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
  .nx-top button { height: 30px; padding: 0 10px; border: 1px solid #6f5f3f; border-radius: 6px; background: #f1e9d6; color: var(--ink); cursor: pointer; font-size: 13px; }
  .nx-days { max-width: 860px; margin: 14px auto 0; padding: 0 16px; display: flex; flex-wrap: wrap; gap: 6px; }
  .nx-days a { font-size: 13px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--accent); text-decoration: none; }
  main { max-width: 860px; margin: 0 auto; padding: 8px 16px 60px; }
  .nx-day { margin: 26px 0 10px; display: flex; align-items: center; gap: 12px; font-size: 15px; color: var(--accent); scroll-margin-top: 80px; }
  .nx-day::before, .nx-day::after { content: ''; flex: 1; border-top: 1px solid var(--line); }
  .nx-day small { color: var(--muted); font-weight: 400; }
  ol.nx-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .chat-message { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--midi-qol-player-color, #b9ad90); border-radius: 6px; padding: 8px 12px 10px; overflow-wrap: anywhere; }
  .chat-message.whisper { background: #f7f3fc; border-color: #d9cdee; border-left-color: var(--whisper); }
  .chat-message.nx-hidden { display: none; }
  .message-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  .message-sender { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 14.5px; flex: 1 1 auto; min-width: 0; }
  .message-sender .avatar img, .nx-avatar { width: 34px; height: 34px; object-fit: cover; border-radius: 50%; border: 1px solid var(--line); background: #5a4c38; flex: 0 0 auto; }
  .name-stacked { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
  .name-stacked .title { font-weight: 700; }
  .name-stacked .subtitle { font-size: 12px; color: var(--muted); font-weight: 400; }
  .nx-time { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nx-badge { font-size: 11.5px; padding: 1px 7px; border-radius: 999px; background: #ebe3f6; color: var(--whisper); white-space: nowrap; }
  .flavor-text { flex: 1 1 100%; font-size: 13px; color: var(--muted); font-style: italic; }
  .message-content { font-size: 15px; }
  .message-content p { margin: .3em 0; }
  .message-content img { max-width: 100%; height: auto; }
  .chat-message.ic .message-content { font-size: 15.5px; }
  .chat-message.emote .message-content { font-style: italic; }
  .dice-roll { margin: 4px 0; border: 1px solid var(--line); border-radius: 6px; background: #faf6ec; padding: 6px 8px; cursor: pointer; }
  .dice-formula { text-align: center; font-size: 13px; color: var(--muted); }
  .dice-total { margin: 2px 0 0; text-align: center; font-size: 19px; }
  .dice-total.critical, .dice-total .critical { color: #1d7a2f; }
  .dice-total.fumble, .dice-total .fumble { color: #a0201a; }
  .dice-tooltip-collapser, .dice-tooltip { display: none; }
  .dice-roll.nx-open .dice-tooltip-collapser, .dice-roll.nx-open .dice-tooltip { display: block; }
  .dice-tooltip .tooltip-part { margin-top: 4px; }
  .dice-tooltip .part-header, .dice-tooltip .dice { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
  ol.dice-rolls { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
  ol.dice-rolls li { min-width: 26px; padding: 0 5px; text-align: center; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
  ol.dice-rolls li.max { color: #1d7a2f; font-weight: 700; }
  ol.dice-rolls li.min { color: #a0201a; font-weight: 700; }
  ol.dice-rolls li.discarded, ol.dice-rolls li.rerolled { opacity: .45; text-decoration: line-through; }
  .chat-card { border: 1px solid var(--line); border-radius: 6px; background: #faf6ec; overflow: hidden; }
  .chat-card .card-header { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; }
  .chat-card .card-header img { width: 34px; height: 34px; border-radius: 4px; border: 1px solid var(--line); background: #5a4c38; object-fit: cover; }
  .chat-card .card-header .title { font-weight: 700; }
  .chat-card .collapsible-content, .chat-card .card-content { display: none; padding: 0 10px 6px; font-size: 14px; }
  .chat-card.nx-open .collapsible-content, .chat-card.nx-open .card-content { display: block; }
  .chat-card .supplement { margin: 4px 10px; font-size: 13px; }
  .chat-card .icon-row { padding: 4px 10px 8px; }
  ul.pills { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
  ul.pills .pill { font-size: 12px; padding: 1px 8px; border: 1px solid var(--line); border-radius: 999px; background: #fff; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid var(--line); padding: 2px 6px; }
  .nx-empty { text-align: center; color: var(--muted); padding: 40px 0; }
  .nx-foot { max-width: 860px; margin: 0 auto; padding: 0 16px 40px; font-size: 12px; color: var(--muted); }
  @media print { .nx-top, .nx-days { position: static; } .nx-top input, .nx-top button, .nx-top label { display: none; } .chat-message { break-inside: avoid; } }
  `;
}

function exportScript(images) {
  return `
  (function () {
    var IMAGES = ${JSON.stringify(images).replace(/</g, '\\u003c')};
    document.querySelectorAll('img[data-nx-img]').forEach(function (img) {
      var source = IMAGES[img.getAttribute('data-nx-img')];
      if (source) img.src = source;
    });
    document.addEventListener('click', function (event) {
      var header = event.target.closest('.chat-card .card-header');
      if (header) { header.closest('.chat-card').classList.toggle('nx-open'); return; }
      var roll = event.target.closest('.dice-roll');
      if (roll) roll.classList.toggle('nx-open');
    });
    var search = document.getElementById('nx-search');
    var hideWhispers = document.getElementById('nx-hide-whispers');
    var messages = Array.prototype.slice.call(document.querySelectorAll('.chat-message'));
    var texts = messages.map(function (message) { return message.textContent.toLowerCase(); });
    function apply() {
      var query = (search.value || '').trim().toLowerCase();
      var noWhisper = hideWhispers && hideWhispers.checked;
      var shown = 0;
      messages.forEach(function (message, index) {
        var hidden = (query && texts[index].indexOf(query) < 0) || (noWhisper && message.classList.contains('whisper'));
        message.classList.toggle('nx-hidden', !!hidden);
        if (!hidden) shown += 1;
      });
      document.querySelectorAll('.nx-day-section').forEach(function (section) {
        section.style.display = section.querySelector('.chat-message:not(.nx-hidden)') ? '' : 'none';
      });
      document.getElementById('nx-shown').textContent = shown.toLocaleString();
    }
    search.addEventListener('input', apply);
    if (hideWhispers) hideWhispers.addEventListener('change', apply);
    document.getElementById('nx-expand').addEventListener('click', function () {
      var open = !document.body.classList.contains('nx-all-open');
      document.body.classList.toggle('nx-all-open', open);
      document.querySelectorAll('.chat-card, .dice-roll').forEach(function (node) { node.classList.toggle('nx-open', open); });
      this.textContent = open ? '모두 접기' : '모두 펼치기';
    });
  })();
  `;
}

/**
 * 내보낼 HTML 문서 전체를 만든다.
 * days: [{ date: 'YYYY-MM-DD', messages: ['<li class="chat-message">…</li>', …] }]
 * images: { id: dataUrl }
 */
export function buildChatExportDocument({
  title,
  worldTitle = '',
  rangeLabel = '',
  exportedAt = Date.now(),
  exportedBy = '',
  days = [],
  images = {},
  hasWhispers = false,
}) {
  const total = days.reduce((sum, day) => sum + day.messages.length, 0);
  const dayLinks = days.length > 1
    ? `<nav class="nx-days" aria-label="날짜">${days.map((day) => `<a href="#d-${day.date}">${escapeHtml(formatDayLabel(day.date))} · ${day.messages.length.toLocaleString()}건</a>`).join('')}</nav>`
    : '';
  const sections = days.map((day) => `
  <section class="nx-day-section">
    <h2 class="nx-day" id="d-${day.date}">${escapeHtml(formatDayLabel(day.date))} <small>${day.messages.length.toLocaleString()}건</small></h2>
    <ol class="nx-log">
${day.messages.join('\n')}
    </ol>
  </section>`).join('\n');
  const meta = [
    worldTitle && `월드 ${escapeHtml(worldTitle)}`,
    rangeLabel && `범위 ${escapeHtml(rangeLabel)}`,
    `메시지 <span id="nx-shown">${total.toLocaleString()}</span> / ${total.toLocaleString()}건`,
    `내보낸 시각 ${escapeHtml(`${formatDateKey(exportedAt)} ${formatClock(exportedAt)}`)}${exportedBy ? ` (${escapeHtml(exportedBy)})` : ''}`,
    '시각은 한국 표준시',
  ].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${exportCss()}</style>
</head>
<body>
<header class="nx-top">
  <div class="nx-top-inner">
    <h1>${escapeHtml(title)}</h1>
    <input id="nx-search" type="search" placeholder="이름·내용 찾기" aria-label="이름·내용 찾기">
    ${hasWhispers ? '<label><input id="nx-hide-whispers" type="checkbox"> 귓속말 숨기기</label>' : ''}
    <button id="nx-expand" type="button">모두 펼치기</button>
    <div class="nx-meta">${meta}</div>
  </div>
</header>
${dayLinks}
<main>
${total ? sections : '<p class="nx-empty">내보낸 메시지가 없습니다.</p>'}
</main>
<footer class="nx-foot">Nihil Workbench 채팅 내보내기</footer>
<script>${exportScript(images)}</script>
</body>
</html>
`;
}
