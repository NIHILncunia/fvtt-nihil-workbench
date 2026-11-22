import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Handlebars from 'handlebars';
import {
  SCENE_BACKGROUND_COLOR,
  columnsFromGrid,
  gridFromColumns,
  readSceneState,
  sceneCreateData,
  sceneLevelUpdate,
  sceneNameFromEntry,
  sceneUpdateData,
} from '../scripts/workbench/scene-fields.mjs';

test('grid size comes from the image width and horizontal cell count', () => {
  assert.deepEqual(gridFromColumns(1500, 1000, 30), { size: 50, columns: 30, rows: 20, exact: true });
  const inexact = gridFromColumns(1680, 944, 34);
  assert.equal(inexact.size, 49);
  assert.equal(inexact.exact, false);
  assert.equal(inexact.rows, 19.27);
  assert.throws(() => gridFromColumns(1000, 800, 60), /20px/);
  assert.throws(() => gridFromColumns(1000, 800, 0), /정수/);
  assert.throws(() => gridFromColumns(null, 800, 10), /크기/);
  assert.equal(columnsFromGrid(1680, 50), 34);
  assert.equal(columnsFromGrid(null, 50), null);
});

test('new scenes keep only the decided fields and put the background on the v14 level', () => {
  const data = sceneCreateData({ name: ' 성 배틀맵 1 ', src: 'https://nihilncunia-images.com/battle-maps/a.webp', width: 1440, height: 1920, columns: 29, luminosity: 0.234, globalLight: true, darkness: 0.7 });
  assert.deepEqual(data, {
    name: '성 배틀맵 1',
    active: false,
    width: 1440,
    height: 1920,
    grid: { type: 1, size: 50 },
    environment: { darknessLevel: 0.7, globalLight: { enabled: true }, base: { luminosity: 0.23 } },
    flags: { 'nihil-compendium-module': { sceneWorkbench: { columns: 29, src: 'https://nihilncunia-images.com/battle-maps/a.webp' } } },
  });
  assert.equal('background' in data, false, 'v14 ignores scene background fields');
  assert.equal('backgroundColor' in data, false);
  assert.deepEqual(sceneLevelUpdate('x.webp'), { background: { src: 'x.webp', color: SCENE_BACKGROUND_COLOR } });
  assert.equal(SCENE_BACKGROUND_COLOR, '#000000');
  assert.throws(() => sceneCreateData({ name: '', src: 'x', width: 10, height: 10, columns: 1 }), /이름/);
  assert.throws(() => sceneCreateData({ name: 'a', src: '', width: 10, height: 10, columns: 1 }), /배경/);
  const clamped = sceneCreateData({ name: 'a', src: 'x', width: 1000, height: 1000, columns: 10, luminosity: 5, darkness: -1 });
  assert.equal(clamped.environment.base.luminosity, 1);
  assert.equal(clamped.environment.darknessLevel, 0);
  const update = sceneUpdateData({ name: 'b', src: 'y', width: 1000, height: 500, columns: 20, globalLight: false });
  assert.equal(update['grid.size'], 50);
  assert.equal(update['environment.globalLight.enabled'], false);
  assert.deepEqual(update['flags.nihil-compendium-module.sceneWorkbench'], { columns: 20, src: 'y' });
});

test('scene state reads the initial level background and the stored or derived cell count', () => {
  const source = {
    _id: 's1', name: '섬의 성소', width: 1500, height: 1000, grid: { size: 50 }, initialLevel: 'L1',
    environment: { darknessLevel: 0.5, globalLight: { enabled: true }, base: { luminosity: -0.2 } },
    levels: [{ _id: 'L0', background: { src: 'other.webp' } }, { _id: 'L1', background: { src: 'main.webp', color: '#999999' } }],
    flags: {},
  };
  const state = readSceneState({ id: 's1', toObject: () => source });
  assert.equal(state.src, 'main.webp');
  assert.equal(state.columns, 30);
  assert.equal(state.backgroundColor, '#999999');
  assert.equal(state.darkness, 0.5);
  assert.equal(state.luminosity, -0.2);
  source.flags = { 'nihil-compendium-module': { sceneWorkbench: { columns: 31 } } };
  assert.equal(readSceneState({ toObject: () => source }).columns, 31);
  assert.equal(sceneNameFromEntry({ name: '정글 배틀맵 3' }), '정글 배틀맵 3');
  assert.equal(sceneNameFromEntry({ url: 'https://x/y/숲 풍경.webp' }), '숲 풍경');
});

test('scene workbench template renders new and existing scene states', async () => {
  const source = await readFile(new URL('../templates/workbench/scene-workbench.hbs', import.meta.url), 'utf8');
  const render = Handlebars.create().compile(source);
  const fresh = render({ canEdit: true, isNew: true, state: { name: '', src: '', columns: 20 }, scenes: [], grid: { ok: false, text: '배경 이미지 크기를 알 수 없습니다.' }, sizeText: '크기 미확인', luminosityText: '0.00', darknessText: '0.00', backgroundColor: '#000000' });
  assert.match(fresh, /씬 만들기/);
  assert.match(fresh, /배경 고르기/);
  assert.doesNotMatch(fresh, /씬 삭제/);
  const existing = render({ canEdit: true, isNew: false, state: { name: '성', src: 'a.webp', columns: 29, globalLight: true }, scenes: [{ id: 's', name: '성', selected: true, active: true }], grid: { ok: true, text: '한 칸 50px' }, sizeText: '1440×1920px', luminosityText: '0.00', darknessText: '0.70', backgroundColor: '#000000' });
  assert.match(existing, /씬 저장/);
  assert.match(existing, /씬 삭제/);
  assert.match(existing, /name="sceneGlobalLight" checked/);
  assert.match(existing, /is-selected/);
});

test('scene thumbnails are made when missing or when the background changes', async () => {
  const { needsSceneThumbnail, refreshSceneThumbnail } = await import('../scripts/workbench/scene-fields.mjs');
  assert.equal(needsSceneThumbnail({ thumb: null, previousSrc: null, nextSrc: 'a.webp' }), true);
  assert.equal(needsSceneThumbnail({ thumb: 't.webp', previousSrc: 'a.webp', nextSrc: 'a.webp' }), false);
  assert.equal(needsSceneThumbnail({ thumb: 't.webp', previousSrc: 'a.webp', nextSrc: 'b.webp' }), true);
  assert.equal(needsSceneThumbnail({ thumb: null, previousSrc: null, nextSrc: '' }), false);

  const calls = [];
  const scene = {
    thumb: null,
    async createThumbnail(options) { calls.push(['create', options]); return { thumb: 'data:image/webp;base64,AAAA' }; },
    async update(data) { calls.push(['update', data]); },
  };
  assert.deepEqual(await refreshSceneThumbnail(scene, { levelId: 'L1', previousSrc: null, nextSrc: 'a.webp' }), { updated: true, reason: null });
  assert.deepEqual(calls, [['create', { level: 'L1' }], ['update', { thumb: 'data:image/webp;base64,AAAA' }]]);

  scene.thumb = 'worlds/x/assets/scenes/s-thumb.webp';
  calls.length = 0;
  assert.deepEqual(await refreshSceneThumbnail(scene, { levelId: 'L1', previousSrc: 'a.webp', nextSrc: 'a.webp' }), { updated: false, reason: null });
  assert.equal(calls.length, 0);

  const failing = { thumb: null, async createThumbnail() { throw new Error('CORS'); }, async update() { throw new Error('never'); } };
  assert.deepEqual(await refreshSceneThumbnail(failing, { nextSrc: 'a.webp' }), { updated: false, reason: 'CORS' });
});
