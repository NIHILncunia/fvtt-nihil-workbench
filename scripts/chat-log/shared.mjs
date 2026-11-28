// 채팅 로그 내보내기 공용 함수(2026-11-28). Foundry 없이 node 시험으로 확인한다.
// 시각은 모두 한국 표준시(Asia/Seoul)로 적는다.

export const CHAT_LOG_MODULE_ID = 'nihil-compendium-module';
export const CREATED_GALLERY_ID = 'created-gallery';
export const CHAT_LOG_TIME_ZONE = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function zonedParts(timestamp) {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: CHAT_LOG_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
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

/** 21:05 */
export function formatShortClock(timestamp) {
  return formatClock(timestamp).slice(0, 5);
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

/** 36분, 1시간 5분 */
export function formatDuration(milliseconds) {
  const minutes = Math.max(0, Math.round(Number(milliseconds || 0) / 60000));
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
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

/** 날짜 범위 글자: 2026-11-28, 2026-11-27~2026-11-28 */
export function dateRangeText(firstTimestamp, lastTimestamp) {
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) return '';
  const first = formatDateKey(firstTimestamp);
  const last = formatDateKey(lastTimestamp);
  return first === last ? first : `${first}~${last}`;
}

/** 제목과 날짜를 붙인 기본 파일 이름. */
export function defaultChatLogFileName(
  title,
  firstTimestamp,
  lastTimestamp,
  { publicCopy = false } = {},
) {
  const range = dateRangeText(firstTimestamp, lastTimestamp);
  const base = [String(title ?? '').trim() || '채팅 로그', range].filter(Boolean).join(' ');
  return sanitizeChatLogFileName(`${base}${publicCopy ? ' 공개판' : ''}`) || '채팅 로그.html';
}

/** 파일 이름에 못 쓰는 글자를 바꾸고 .html을 붙인다. 쓸 글자가 없으면 빈 문자열. */
export function sanitizeChatLogFileName(name) {
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

const LINE_SEPARATOR_ESCAPE = `${String.fromCharCode(92)}u2028`;
const PARAGRAPH_SEPARATOR_ESCAPE = `${String.fromCharCode(92)}u2029`;

/** 스크립트 안에 넣을 JSON. </script>로 끊기지 않게 한다. */
export function scriptJson(value) {
  return JSON.stringify(value)
    .replace(
      /</g,
      '\\u003c',
    )
    .split(String.fromCharCode(0x2028))
    .join(LINE_SEPARATOR_ESCAPE)
    .split(String.fromCharCode(0x2029))
    .join(PARAGRAPH_SEPARATOR_ESCAPE);
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
