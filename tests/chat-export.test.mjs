import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatExportDocument,
  defaultChatExportFileName,
  formatClock,
  formatDateKey,
  formatDayLabel,
  formatLocalInput,
  groupByDay,
  parseLocalInput,
  sanitizeChatExportFileName,
  selectChatRows,
} from '../scripts/chat-export/chat-export-core.mjs';

// 2026-11-27 23:30:00 KST = 2026-11-27T14:30:00Z
const lateNight = Date.parse('2026-11-27T14:30:00Z');
// 2026-11-28 00:10:05 KST = 2026-11-27T15:10:05Z (UTC로는 아직 27일)
const afterMidnight = Date.parse('2026-11-27T15:10:05Z');

test('dates and clocks are written in Korea Standard Time', () => {
  assert.equal(formatDateKey(lateNight), '2026-11-27');
  assert.equal(formatDateKey(afterMidnight), '2026-11-28');
  assert.equal(formatClock(afterMidnight), '00:10:05');
  assert.equal(formatLocalInput(afterMidnight), '2026-11-28T00:10:05');
  assert.equal(formatDayLabel('2026-11-28'), '2026년 11월 28일 (토)');
});

test('local inputs are read as KST and an end time covers its whole second', () => {
  assert.equal(parseLocalInput('2026-11-28T00:10:05'), afterMidnight);
  assert.equal(parseLocalInput('2026-11-28T00:10:05', { endOfSecond: true }), afterMidnight + 999);
  assert.equal(parseLocalInput('2026-11-28T00:10'), afterMidnight - 5000);
  assert.equal(parseLocalInput(''), null);
  assert.ok(Number.isNaN(parseLocalInput('어제')));
});

test('messages are grouped by KST day across UTC midnight', () => {
  const days = groupByDay([afterMidnight, lateNight, lateNight + 1000]);
  assert.deepEqual(days.map((day) => [day.date, day.count]), [['2026-11-27', 2], ['2026-11-28', 1]]);
  assert.equal(days[0].first, lateNight);
  assert.equal(days[0].last, lateNight + 1000);
});

test('default file names carry the date or date range', () => {
  assert.equal(defaultChatExportFileName(lateNight, lateNight + 5), '채팅 기록 2026-11-27.html');
  assert.equal(defaultChatExportFileName(lateNight, afterMidnight), '채팅 기록 2026-11-27~2026-11-28.html');
  assert.equal(sanitizeChatExportFileName('늑대와 소녀: 3회차'), '늑대와 소녀_ 3회차.html');
  assert.equal(sanitizeChatExportFileName('기록.HTML'), '기록.html');
  assert.equal(sanitizeChatExportFileName('  .html '), '');
  assert.equal(sanitizeChatExportFileName('???'), '');
});

test('rows are filtered by range and whisper option and sorted in time order', () => {
  const rows = [
    { timestamp: 30, index: 0, whisper: false },
    { timestamp: 10, index: 1, whisper: true },
    { timestamp: 20, index: 2, whisper: false },
    { timestamp: Number.NaN, index: 3, whisper: false },
  ];
  assert.deepEqual(selectChatRows(rows).map((row) => row.timestamp), [10, 20, 30]);
  assert.deepEqual(selectChatRows(rows, { includeWhispers: false }).map((row) => row.timestamp), [20, 30]);
  assert.deepEqual(selectChatRows(rows, { start: 15, end: 25 }).map((row) => row.timestamp), [20]);
});

test('the export document lists days, escapes text and keeps images in a lookup table', () => {
  const html = buildChatExportDocument({
    title: '채팅 기록 <시험>',
    worldTitle: '룩스테라',
    rangeLabel: '2026-11-27 23:30:00 ~ 2026-11-28 00:10:05',
    exportedAt: afterMidnight,
    exportedBy: 'AI 4',
    days: [
      { date: '2026-11-27', messages: ['<li class="chat-message">하나</li>'] },
      { date: '2026-11-28', messages: ['<li class="chat-message whisper">둘</li>'] },
    ],
    images: { i0: 'data:image/png;base64,AAAA', i1: 'x</script>' },
    hasWhispers: true,
  });
  assert.match(html, /<title>채팅 기록 &lt;시험&gt;<\/title>/);
  assert.match(html, /href="#d-2026-11-27">2026년 11월 27일 \(금\) · 1건/);
  assert.match(html, /id="d-2026-11-28"/);
  assert.match(html, /nx-hide-whispers/);
  assert.match(html, /"i0":"data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(html, /x<\/script>/);
  assert.match(html, /메시지 <span id="nx-shown">2<\/span> \/ 2건/);
});
