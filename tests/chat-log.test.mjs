import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dateRangeText,
  defaultChatLogFileName,
  formatClock,
  formatDateKey,
  formatDayLabel,
  formatDuration,
  formatLocalInput,
  groupByDay,
  parseLocalInput,
  sanitizeChatLogFileName,
  scriptJson,
  selectChatRows,
} from '../scripts/chat-log/shared.mjs';
import { messageSceneContext, planSceneShots, shotCropRect } from '../scripts/chat-log/scene-shots.mjs';
import {
  combatCardHtml,
  computeReplayStates,
  replayOrders,
  replayRuntimeSource,
  replayStepsFromRecord,
  separateLabels,
  summarizeCombat,
} from '../scripts/chat-log/combat-replay.mjs';
import { buildChatLogDocument } from '../scripts/chat-log/document.mjs';

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
  assert.equal(formatDuration(36 * 60000), '36분');
  assert.equal(formatDuration(65 * 60000), '1시간 5분');
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
  assert.equal(dateRangeText(lateNight, lateNight + 5), '2026-11-27');
  assert.equal(dateRangeText(lateNight, afterMidnight), '2026-11-27~2026-11-28');
});

test('file names carry the title and the date or date range', () => {
  assert.equal(defaultChatLogFileName('센트럴 워치 4 늑대와 소녀', lateNight, lateNight + 5), '센트럴 워치 4 늑대와 소녀 2026-11-27.html');
  assert.equal(defaultChatLogFileName('룩스테라: 모험', lateNight, afterMidnight, { publicCopy: true }), '룩스테라_ 모험 2026-11-27~2026-11-28 공개판.html');
  assert.equal(defaultChatLogFileName('', lateNight, lateNight), '채팅 로그 2026-11-27.html');
  assert.equal(sanitizeChatLogFileName('기록.HTML'), '기록.html');
  assert.equal(sanitizeChatLogFileName('  .html '), '');
  assert.equal(sanitizeChatLogFileName('???'), '');
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
  assert.equal(scriptJson({ a: '</script>' }), '{"a":"\\u003c/script>"}');
});

test('scene context reads the workbench flag first, then created-gallery, then speaker.scene', () => {
  const view = { id: 'S1', x: 1000, y: 800, scale: 0.5, w: 1600, h: 900 };
  assert.deepEqual(messageSceneContext({ flags: { 'nihil-compendium-module': { scene: { ...view, level: 'L1' } } } }), {
    sceneId: 'S1', levelId: 'L1', focus: { x: 1000, y: 800 }, view: { x: 1000, y: 800, width: 3200, height: 1800 },
  });
  assert.equal(messageSceneContext({ flags: { 'created-gallery': { scene: { ...view, token: { x: 5, y: 6 } } } } }).focus.x, 5);
  assert.deepEqual(messageSceneContext({ speaker: { scene: 'S2' } }), { sceneId: 'S2', levelId: null, focus: null, view: null });
  assert.equal(messageSceneContext({}), null);
});

test('scene shots split on scene change and long moves and keep only long stretches', () => {
  const at = (scene, x) => ({ flags: { 'nihil-compendium-module': { scene: { id: scene, x, y: 0, scale: 1, w: 1000, h: 1000 } } } });
  const messages = [
    ...Array.from({ length: 3 }, () => at('A', 0)),
    {},
    ...Array.from({ length: 2 }, () => at('A', 5000)),
    ...Array.from({ length: 4 }, () => at('B', 0)),
  ];
  const shots = planSceneShots(messages, { minLines: 3 });
  assert.deepEqual(shots.map((shot) => [shot.sceneId, shot.start, shot.count]), [['A', 0, 4], ['B', 6, 4]]);
  const crop = shotCropRect(shots[0], { sceneX: 0, sceneY: 0, sceneWidth: 4000, sceneHeight: 4000 }, { width: 2000, height: 2000 });
  assert.deepEqual(crop, { x: 0, y: 0, width: 500, height: 500 });
});

const record = {
  id: 'R1',
  combatId: 'C1',
  sceneId: 'S1',
  sceneName: '밀포드 마을',
  startedAt: 1000,
  endedAt: 1000 + 36 * 60000,
  round: 2,
  participants: [
    { tokenId: 'a', name: '백야', disposition: 1, dealt: 12, taken: 3, healed: 0, crits: 1, fumbles: 0, startHp: 20, hp: { value: 17, max: 20 }, x: 100, y: 100 },
    { tokenId: 'b', name: '늑대', disposition: -1, dealt: 3, taken: 12, healed: 0, crits: 0, fumbles: 0, startHp: 11, hp: { value: 0, max: 11 }, x: 200, y: 100 },
    { tokenId: 'h', name: '숨은 자', disposition: -1, hidden: true, dealt: 0, taken: 0, hp: { value: 5, max: 5 } },
  ],
  rounds: [{ round: 1, order: ['b', 'a', 'h'] }, { round: 2 }],
  events: [
    { type: 'turn', round: 1, tokenId: 'b', name: '늑대' },
    { type: 'damage', round: 1, tokenId: 'a', target: '백야', source: '늑대', amount: 3, after: 17 },
    { type: 'move', round: 1, tokenId: 'h', target: '숨은 자', x: 0, y: 0 },
    { type: 'turn', round: 1, tokenId: 'a', name: '백야' },
    { type: 'turn', round: 1, tokenId: 'a', name: '백야' },
    { type: 'move', round: 1, tokenId: 'a', target: '백야', x: 150, y: 100 },
    { type: 'damage', round: 1, tokenId: 'b', target: '늑대', source: '백야', amount: 12, after: 0 },
    { type: 'down', round: 1, tokenId: 'b', target: '늑대' },
    { type: 'status-on', round: 1, tokenId: 'b', target: '늑대', status: 'prone', label: '넘어짐' },
    { type: 'turn', round: 2, tokenId: 'a', name: '백야' },
    { type: 'damage', round: 2, tokenId: 'h', target: '숨은 자', amount: 1, after: 4 },
  ],
};

test('combat summary leaves hidden combatants out of every list', () => {
  const summary = summarizeCombat(record);
  assert.deepEqual(summary.participants.map((participant) => participant.name), ['백야', '늑대']);
  assert.equal(summary.top.name, '백야');
  assert.equal(summary.participants[1].defeated, true);
  assert.deepEqual(summary.timeline.map((round) => [round.round, round.damage, round.downs]), [[1, 15, ['늑대']], [2, 0, []]]);
  const card = combatCardHtml(summary, { anchorId: 'c-1' });
  assert.match(card, /id="c-1"/);
  assert.match(card, /36분/);
  assert.doesNotMatch(card, /숨은 자/);
});

test('replay steps skip hidden tokens and repeated turns, orders fall back to turn order', () => {
  const steps = replayStepsFromRecord(record, ['a', 'b']);
  assert.deepEqual(steps.map((step) => step.type), ['turn', 'damage', 'turn', 'move', 'damage', 'down', 'status-on', 'turn']);
  assert.equal(steps.find((step) => step.type === 'status-on').text, '늑대 상태 +넘어짐');
  assert.deepEqual(replayOrders(record, ['a', 'b']), { 1: ['b', 'a'], 2: ['a'] });
});

test('replay states track position, hp, downs, damage credit and recent steps', () => {
  const steps = replayStepsFromRecord(record, ['a', 'b']);
  const states = computeReplayStates({
    tokens: [
      { id: 'a', x: 100, y: 100, hp: 20 },
      { id: 'b', x: 200, y: 100, hp: 11 },
    ],
    steps,
  });
  assert.equal(states.length, steps.length + 1);
  const afterMove = states[4];
  assert.deepEqual(afterMove.pos.a, { x: 150, y: 100 });
  const afterHit = states[5];
  assert.equal(afterHit.hp.b, 0);
  assert.equal(afterHit.fx.hit, true);
  assert.equal(afterHit.dealt.a, 12);
  assert.equal(states[6].down.b, true);
  assert.deepEqual(states[7].status.b, ['넘어짐']);
  assert.equal(states.at(-1).round, 2);
  assert.equal(states.at(-1).recent.length, 5);
});

test('name labels that overlap are pushed apart', () => {
  const ys = separateLabels([
    { x: 100, y: 50, w: 60, h: 14 },
    { x: 110, y: 52, w: 60, h: 14 },
    { x: 400, y: 50, w: 60, h: 14 },
  ]);
  assert.equal(ys[0], 50);
  assert.ok(ys[1] >= 50 + 14);
  assert.equal(ys[2], 50);
});

test('the replay runtime source is self-contained and the document wires tools in', () => {
  const source = replayRuntimeSource();
  assert.match(source, /function computeReplayStates/);
  assert.match(source, /function separateLabels/);
  assert.doesNotThrow(() => new Function(source.replace('(function replayPlayerMain', '(function noop')));
  const html = buildChatLogDocument({
    title: '늑대와 소녀 <시험>',
    subtitle: '2026-11-26 · 메시지 2건',
    body: '<div class="message general" data-time="1"><img src="__HXIMG_0__"></div>',
    toc: [{ type: 'day', anchor: 'd-2026-11-26', label: '2026년 11월 26일 (목)', time: '21:00' }, { type: 'scene', anchor: 's-1', label: '임시 거처', time: '21:05' }],
    images: { __HXIMG_0__: 'data:image/webp;base64,AAAA' },
    portraits: { '--hp0': 'data:image/webp;base64,BBBB', '--hp1': '' },
    hasWhispers: true,
    hasScenes: true,
    hasReplay: true,
  });
  assert.match(html, /<title>늑대와 소녀 &lt;시험&gt;<\/title>/);
  assert.match(html, /src="data:image\/webp;base64,AAAA"/);
  assert.match(html, /--hp0:url\("data:image\/webp;base64,BBBB"\)/);
  assert.match(html, /--hp1:none;/);
  assert.match(html, /href="#s-1">📍 임시 거처<small>21:05<\/small>/);
  assert.match(html, /hx-hide-whispers/);
  assert.match(html, /id="scene-panel"/);
  assert.match(html, /function computeReplayStates/);
});
