// 채팅 로그 HTML 문서 틀(2026-11-28): 하트 로그 본문 + 머리말·목차·찾기 + 장면 패널 + 리플레이.
import { escapeHtml, scriptJson } from './shared.mjs';
import { replayRuntimeSource } from './combat-replay.mjs';

function logCss() {
  return `
  * { box-sizing: border-box; }
  html { scroll-padding-top: 64px; }
  body { margin: 0; background: #efece4; font-family: 'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; }
  .log-head { max-width: 820px; margin: 28px auto 0; padding: 0 16px; }
  .log-head h1 { font-size: 24px; color: #2a2015; margin: 0 0 4px; }
  .log-head p { margin: 0; color: #6a5c47; font-size: 13px; }
  .hx-bar { position: sticky; top: 0; z-index: 6; max-width: 820px; margin: 12px auto 0; padding: 8px 14px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center;
            background: rgba(239,236,228,.96); backdrop-filter: blur(4px); border-bottom: 1px solid #ddd3bf; }
  .hx-bar input[type=search] { flex: 1 1 200px; min-width: 0; height: 30px; padding: 0 10px; border: 1px solid #cfc5b0; border-radius: 6px; background: #fff; font: inherit; font-size: 14px; }
  .hx-bar button, .hx-bar summary { height: 30px; padding: 0 10px; border: 1px solid #cfc5b0; border-radius: 6px; background: #fff; color: #2a2015; cursor: pointer; font: inherit; font-size: 13px; display: inline-flex; align-items: center; }
  .hx-bar label { font-size: 13px; color: #4a4438; display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
  .hx-bar .hx-count { font-size: 12.5px; color: #6a5c47; min-width: 4em; }
  .hx-toc { position: relative; }
  .hx-toc summary { list-style: none; }
  .hx-toc summary::-webkit-details-marker { display: none; }
  .hx-toc-list { position: absolute; top: 36px; left: 0; width: min(420px, 86vw); max-height: 70vh; overflow: auto; padding: 8px 0; margin: 0; list-style: none;
                 background: #fff; border: 1px solid #d9cfbb; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
  .hx-toc-list li a { display: flex; gap: 8px; padding: 5px 14px; color: #2a2015; text-decoration: none; font-size: 13.5px; }
  .hx-toc-list li a:hover { background: #f1e9d6; }
  .hx-toc-list li a small { margin-left: auto; color: #8a7d66; font-variant-numeric: tabular-nums; }
  .hx-toc-list li.hx-toc-day a { font-weight: 700; color: #7a2e12; border-top: 1px solid #eee4d2; margin-top: 4px; padding-top: 7px; }
  .hx-toc-list li.hx-toc-scene a { padding-left: 26px; }
  .hx-toc-list li.hx-toc-combat a { padding-left: 26px; color: #7a2e12; }
  .log-body { max-width: 820px; margin: 10px auto 60px; padding: 18px 14px 30px; background: #ffffff; border-radius: 6px; box-shadow: 0 1px 6px rgba(0,0,0,.08); overflow-wrap: break-word; }
  .log-body img { max-width: 100%; height: auto; }
  .log-body .hx-time { position: absolute; right: 6px; top: 10px; font-size: 11px; color: #a89c86; font-variant-numeric: tabular-nums; font-style: normal; font-weight: 400; }
  .log-body .message.desc .hx-time { display: none; }
  .log-body .message.hx-hit { outline: 2px solid #f0c040; outline-offset: -2px; background-color: #fff8db !important; }
  .log-body .message.hx-hit.hx-current { outline-color: #d9480f; }
  body.hx-hide-whispers .log-body .message.whisper { display: none; }
  .log-body .hx-day { color: #7a2e12 !important; font-style: normal !important; margin-top: 14px !important; }
  .log-body .scene-card { margin: 6px 0 2px; max-width: 340px; border-radius: 10px; overflow: hidden; background: #f7f5ef; border: 1px solid #e6e0d2; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .log-body .scene-card .scene-img { display: block; width: 100%; max-width: 100%; margin: 0; border-radius: 0; }
  .log-body .scene-caption { padding: 10px 14px 12px; font-size: 13.5px; line-height: 1.65; color: #4a4438; }
  .log-body .cgx-img { display: inline-block; max-width: 100%; background: center / cover no-repeat; vertical-align: top; }
  .log-body .avatar .cgx-img { display: block; cursor: zoom-in; }
  .log-body .log-scene { margin: 14px -4px 10px; scroll-margin-top: 64px; }
  .log-body .log-scene .log-scene-img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 1px 6px rgba(0,0,0,.18); }
  .log-body .log-scene .log-scene-caption { margin: 6px 2px 0; font-size: 12.5px; color: #6a5c47; }
  #scene-panel { display: none; }
  body.scene-panel-on #scene-panel { display: flex; flex-direction: column; position: fixed; left: 0; top: 0; bottom: 0; width: calc(100vw - 880px); background: #1b1712; z-index: 7; }
  #scene-panel .scene-panel-frame { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; cursor: grab; touch-action: none; }
  #scene-panel .scene-panel-frame.dragging { cursor: grabbing; }
  #scene-panel img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center center; user-select: none; -webkit-user-drag: none; }
  #scene-panel .scene-panel-caption { flex: 0 0 auto; padding: 8px 14px; background: #2a2015; color: #f5ecd8; font-size: 13px; display: flex; justify-content: space-between; gap: 10px; }
  #scene-panel .scene-panel-caption span { opacity: .7; font-size: 12px; }
  body.scene-panel-on .log-head, body.scene-panel-on .log-body, body.scene-panel-on .hx-bar { margin-left: calc(100vw - 850px); margin-right: 20px; }
  body.scene-panel-on .log-body .log-scene { margin: 12px 0 6px; }
  body.scene-panel-on .log-body .log-scene .log-scene-img { display: none; }
  body.scene-panel-on .log-body .log-scene .log-scene-caption { margin: 0; padding: 4px 10px; border-left: 3px solid #c9a84c; background: #f7f5ef; font-weight: 600; color: #4a4438; }
  body.scene-panel-on .log-body .log-scene.is-current .log-scene-caption { border-left-color: #7a2e12; background: #f1e9d6; }
  .log-body .log-combat-start { padding: 6px 5px; margin: 10px 0 4px; text-align: center; font-weight: bold; color: #7a2e12; border-top: 2px solid #7a2e12; border-bottom: 1px solid #e6dfcf; scroll-margin-top: 64px; }
  .log-body .log-combat-start .log-combat-names { font-weight: normal; font-size: 12.5px; color: #6a5c47; }
  .log-body .log-combat { margin: 14px 0 12px; border: 1px solid #d9cfbb; border-radius: 10px; background: #faf7f0; overflow: hidden; scroll-margin-top: 64px; }
  .log-body .log-combat-head { padding: 9px 14px; background: #2a2015; color: #f5ecd8; font-weight: 700; font-size: 14px; display: flex; justify-content: space-between; gap: 10px; }
  .log-body .log-combat-head span { font-weight: 400; opacity: .85; font-size: 12.5px; }
  .log-body .log-combat-body { padding: 10px 14px 12px; font-size: 13.5px; line-height: 1.6; color: #3f3a30; }
  .log-body .log-combat table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 13px; }
  .log-body .log-combat th, .log-body .log-combat td { padding: 4px 6px; border-bottom: 1px solid #e6dfcf; text-align: left; }
  .log-body .log-combat th { color: #6a5c47; font-weight: 600; }
  .log-body .log-combat tr.side--1 td:first-child { color: #9b1c1c; }
  .log-body .log-combat tr.side-1 td:first-child { color: #2b6a2f; }
  .log-body .log-combat .down { color: #9b1c1c; font-weight: 600; }
  .log-body .log-combat .log-combat-map { display: block; width: 100%; height: auto; border-radius: 6px; margin: 4px 0 8px; }
  .log-body .log-combat .log-combat-rounds { margin: 6px 0 0; padding-left: 18px; }
  .log-body .log-replay { margin: 4px 0 10px; }
  .log-body .log-replay-canvas { display: block; width: 100%; height: auto; border-radius: 6px; background: #1b1712; outline: none; }
  .log-body .log-replay-canvas:focus-visible { box-shadow: 0 0 0 2px #f0c040; }
  .log-body .log-replay-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 6px 0 2px; }
  .log-body .log-replay-bar button { min-width: 32px; height: 28px; padding: 0 6px; border: 1px solid #cfc5b0; border-radius: 5px; background: #fff; color: #2a2015; cursor: pointer; font-size: 13px; }
  .log-body .log-replay-bar button:hover { background: #f1e9d6; }
  .log-body .log-replay-bar input[type=range] { flex: 1 1 140px; min-width: 110px; }
  .log-body .log-replay-bar select { height: 28px; border: 1px solid #cfc5b0; border-radius: 5px; background: #fff; }
  .log-body .log-replay-label { font-size: 12.5px; color: #6a5c47; white-space: nowrap; }
  .log-body .log-replay-order { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
  .log-body .log-replay-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 2px; border: 1px solid #d9cfbb; border-radius: 999px; background: #fff; font-size: 12px; position: relative; }
  .log-body .log-replay-chip img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
  .log-body .log-replay-chip.side-1 { border-color: #9fd3a4; }
  .log-body .log-replay-chip.side--1 { border-color: #f1a5a5; }
  .log-body .log-replay-chip.is-active { background: #fff3bf; border-color: #f0b400; font-weight: 700; }
  .log-body .log-replay-chip.is-down { opacity: .5; text-decoration: line-through; }
  .log-body .log-replay-chip .hp { width: 28px; height: 4px; background: #ddd; border-radius: 2px; overflow: hidden; }
  .log-body .log-replay-chip .hp i { display: block; height: 100%; background: #40c057; }
  .log-body .log-replay-caption { min-height: 1.6em; padding: 4px 8px; border-radius: 5px; background: #2a2015; color: #f5ecd8; font-size: 13.5px; }
  .log-body .log-replay-recent { list-style: none; margin: 4px 0 0; padding: 0; font-size: 12.5px; color: #6a5c47; }
  .log-body .log-replay-recent li { padding: 1px 8px; }
  .log-body .log-replay-recent li.is-now { color: #2a2015; font-weight: 600; }
  .log-body .log-replay-recent li.type-damage, .log-body .log-replay-recent li.type-down, .log-body .log-replay-recent li.type-defeated { color: #a61e1e; }
  .log-body .log-replay-recent li.type-heal { color: #2b8a3e; }
  @font-face { font-family: 'Pretendard-Regular'; src: local('Pretendard Regular'), local('Pretendard'); }
  .log-body * { font-family: 'Pretendard', 'Pretendard-Regular', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif !important; }
  .log-body .sheet-result span, .log-body .sheet-result * { font-family: 'Fraunces', Georgia, 'Times New Roman', serif !important; }
  #img-zoom { position: fixed; top: 64px; left: 12px; width: min(240px, calc(50vw - 430px)); z-index: 99; display: none; pointer-events: none; text-align: center; }
  #img-zoom.near-cursor { width: 220px; }
  #img-zoom img { max-width: 100%; max-height: 320px; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.35); background: #fff; }
  .hx-foot { max-width: 820px; margin: -40px auto 40px; padding: 0 16px; font-size: 12px; color: #8a7d66; }
  @media print { .hx-bar, #scene-panel, #img-zoom { display: none !important; } body.scene-panel-on .log-head, body.scene-panel-on .log-body { margin: 0 auto; } }
  `;
}

function pageScript() {
  return `
(function () {
  // 찾기: 맞는 메시지를 표시하고 Enter·버튼으로 다음·이전으로 옮긴다.
  var input = document.getElementById('hx-search');
  var count = document.getElementById('hx-count');
  var messages = Array.prototype.slice.call(document.querySelectorAll('.log-body .message'));
  var texts = messages.map(function (m) { return m.textContent.toLowerCase(); });
  var hits = [], at = -1;
  function mark() {
    var query = (input.value || '').trim().toLowerCase();
    hits = [];
    messages.forEach(function (m, i) {
      var hit = !!query && texts[i].indexOf(query) >= 0;
      m.classList.toggle('hx-hit', hit);
      m.classList.remove('hx-current');
      if (hit) hits.push(m);
    });
    at = -1;
    count.textContent = query ? (hits.length ? '0/' + hits.length : '없음') : '';
  }
  function go(step) {
    if (!hits.length) return;
    if (at >= 0) hits[at].classList.remove('hx-current');
    at = (at + step + hits.length) % hits.length;
    hits[at].classList.add('hx-current');
    hits[at].scrollIntoView({ block: 'center' });
    count.textContent = (at + 1) + '/' + hits.length;
  }
  if (input) {
    var timer = null;
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(mark, 150); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!hits.length) mark(); go(e.shiftKey ? -1 : 1); } });
    document.getElementById('hx-next').addEventListener('click', function () { if (!hits.length) mark(); go(1); });
    document.getElementById('hx-prev').addEventListener('click', function () { if (!hits.length) mark(); go(-1); });
  }
  var whispers = document.getElementById('hx-hide-whispers');
  if (whispers) whispers.addEventListener('change', function () { document.body.classList.toggle('hx-hide-whispers', whispers.checked); });
  var toc = document.querySelector('.hx-toc');
  if (toc) toc.addEventListener('click', function (e) { if (e.target.closest('a')) toc.open = false; });
  document.addEventListener('click', function (e) { if (toc && toc.open && !e.target.closest('.hx-toc')) toc.open = false; });

  // 초상·그림 위에 올리면 크게 보기.
  var zoom = document.getElementById('img-zoom');
  var body = document.querySelector('.log-body');
  function srcOf(el) {
    if (!el || !el.tagName) return null;
    if (el.tagName === 'IMG' && !el.closest('.log-replay')) return el.getAttribute('src');
    if (el.classList && el.classList.contains('cgx-img')) {
      var m = getComputedStyle(el).backgroundImage.match(/^url\\(["']?(.*?)["']?\\)$/);
      return m ? m[1] : null;
    }
    return null;
  }
  function place(e) {
    var gutter = (window.innerWidth - 820) / 2;
    if (gutter >= 170 && !document.body.classList.contains('scene-panel-on')) { zoom.classList.remove('near-cursor'); zoom.style.left = '12px'; zoom.style.top = '64px'; return; }
    zoom.classList.add('near-cursor');
    var x = e.clientX + 18, y = e.clientY + 18;
    if (x + 230 > window.innerWidth) x = Math.max(8, e.clientX - 238);
    if (y + 330 > window.innerHeight) y = Math.max(8, window.innerHeight - 338);
    zoom.style.left = x + 'px'; zoom.style.top = y + 'px';
  }
  if (zoom && body) {
    body.addEventListener('mouseover', function (e) {
      var src = srcOf(e.target);
      if (!src || e.target.closest('.log-scene, .scene-card')) return;
      zoom.innerHTML = '';
      var img = document.createElement('img');
      img.src = src; img.alt = '';
      zoom.appendChild(img);
      place(e);
      zoom.style.display = 'block';
    });
    body.addEventListener('mousemove', function (e) { if (zoom.style.display === 'block') place(e); });
    body.addEventListener('mouseout', function (e) { if (srcOf(e.target)) { zoom.style.display = 'none'; zoom.innerHTML = ''; } });
  }

  // 장면 패널: 넓은 화면에서 지금 읽는 자리의 장면을 왼쪽에 크게 보여 준다(휠 확대, 끌어 이동).
  var panel = document.getElementById('scene-panel');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.log-body .log-scene'));
  if (!panel || !cards.length) return;
  var frame = panel.querySelector('.scene-panel-frame');
  var img = panel.querySelector('img');
  var caption = panel.querySelector('.scene-panel-caption b');
  var wide = window.matchMedia('(min-width: 1300px)');
  var current = -1, scale = 1, tx = 0, ty = 0, drag = null;
  function apply() { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
  function reset() { scale = 1; tx = 0; ty = 0; apply(); }
  function pick() {
    if (!wide.matches) return;
    var middle = window.innerHeight / 2, index = 0;
    for (var i = 0; i < cards.length; i++) if (cards[i].getBoundingClientRect().top < middle) index = i;
    if (index === current) return;
    current = index;
    var source = cards[index].querySelector('img');
    if (source) img.src = source.getAttribute('src');
    var text = cards[index].querySelector('.log-scene-caption');
    caption.textContent = text ? text.textContent : '';
    cards.forEach(function (card, i) { card.classList.toggle('is-current', i === index); });
    reset();
  }
  function mode() { document.body.classList.toggle('scene-panel-on', wide.matches); current = -1; pick(); }
  window.addEventListener('scroll', pick, { passive: true });
  window.addEventListener('resize', pick);
  if (wide.addEventListener) wide.addEventListener('change', mode); else wide.addListener(mode);
  frame.addEventListener('wheel', function (e) {
    e.preventDefault();
    scale = Math.min(8, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });
  frame.addEventListener('pointerdown', function (e) { drag = { x: e.clientX - tx, y: e.clientY - ty }; frame.classList.add('dragging'); if (frame.setPointerCapture) frame.setPointerCapture(e.pointerId); });
  frame.addEventListener('pointermove', function (e) { if (!drag) return; tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); });
  function endDrag() { drag = null; frame.classList.remove('dragging'); }
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);
  frame.addEventListener('dblclick', reset);
  mode();
})();
`;
}

function tocHtml(toc) {
  if (!toc.length) return '';
  const items = toc.map((item) => (
    `<li class="hx-toc-${item.type}"><a href="#${item.anchor}">${item.type === 'scene' ? '📍 ' : item.type === 'combat' ? '⚔️ ' : '📅 '}${escapeHtml(item.label)}${item.time ? `<small>${escapeHtml(item.time)}</small>` : ''}</a></li>`
  )).join('');
  return `<details class="hx-toc"><summary>목차</summary><ul class="hx-toc-list">${items}</ul></details>`;
}

/**
 * 문서 전체. body는 하트 로그 본문(그림 자리표가 든 HTML), images는 { 자리표: dataUrl },
 * portraits는 { CSS 변수: dataUrl }.
 */
export function buildChatLogDocument({
  title,
  subtitle = '',
  body,
  toc = [],
  images = {},
  portraits = {},
  hasWhispers = false,
  hasScenes = false,
  hasReplay = false,
  footer = '',
}) {
  let html = body;
  for (const [placeholder, dataUrl] of Object.entries(images)) html = html.split(placeholder).join(dataUrl);
  const rootVariables = Object.entries(portraits).map(([name, dataUrl]) => (dataUrl ? `${name}:url("${dataUrl}");` : `${name}:none;`)).join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" media="print" onload="this.media='all'">
<style>${logCss()}</style>
${rootVariables ? `<style>:root{${rootVariables}}</style>` : ''}
</head>
<body>
<header class="log-head"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</header>
<nav class="hx-bar" aria-label="로그 도구">
  ${tocHtml(toc)}
  <input id="hx-search" type="search" placeholder="이름·대사 찾기 (Enter: 다음)" aria-label="이름·대사 찾기">
  <button id="hx-prev" type="button" title="이전 찾은 곳">▲</button><button id="hx-next" type="button" title="다음 찾은 곳">▼</button>
  <span id="hx-count" class="hx-count" role="status"></span>
  ${hasWhispers ? '<label><input id="hx-hide-whispers" type="checkbox"> 귓속말 숨기기</label>' : ''}
</nav>
<main class="log-body">
${html}
</main>
${footer ? `<p class="hx-foot">${escapeHtml(footer)}</p>` : ''}
<div id="img-zoom" aria-hidden="true"></div>
${hasScenes ? '<aside id="scene-panel" aria-label="현재 장면"><div class="scene-panel-frame"><img alt=""></div><div class="scene-panel-caption"><b></b><span>휠: 확대 · 끌기: 이동 · 더블클릭: 원래대로</span></div></aside>' : ''}
<script>${pageScript()}</script>
${hasReplay ? `<script>${replayRuntimeSource()}</script>` : ''}
</body>
</html>
`;
}

export { scriptJson };
