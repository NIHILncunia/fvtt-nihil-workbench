import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Handlebars from 'handlebars';
import {
  ArchiveImageError,
  clearImageCache,
  entryGroups,
  filterEntries,
  galleryEntry,
  galleryKind,
  imageQuery,
  loadGalleryEntries,
} from '../scripts/gallery/archive-images.mjs';

const portraitItem = {
  imageId: '11', path: 'wiki/trpg/creatures/a/그레일/그레일 초상화.webp', role: '초상화', width: 941, height: 1672,
  url: 'https://nihilncunia-images.com/creatures/a6/a6.webp', use: 'Y', world: '룩스테라',
  creature: { name: '그레일', classification: '인물', pantheon: null },
};

test('gallery kinds request only the matching archive role or map areas', () => {
  assert.deepEqual(galleryKind('portrait').sources.map((s) => [s.area, s.role]), [['char', '초상화']]);
  assert.deepEqual(galleryKind('token').sources.map((s) => [s.area, s.role]), [['char', '토큰']]);
  assert.deepEqual(galleryKind('map').sources.map((s) => [s.id, s.area]), [['battlemap', 'map'], ['landscape', 'lndscp']]);
  assert.throws(() => galleryKind('scene'), /알 수 없는/);
  const url = new URL(imageQuery({ area: 'char', role: '토큰', page: 2 }));
  assert.equal(url.pathname, '/wp-json/ncoc-archive/v1/images');
  assert.deepEqual(Object.fromEntries(url.searchParams), { area: 'char', page: '2', perPage: '200', role: '토큰' });
  assert.equal(new URL(imageQuery({ area: 'map' })).searchParams.has('role'), false);
});

test('gallery entries keep creature names, groups and searchable text and skip unusable images', () => {
  const source = galleryKind('portrait').sources[0];
  const entry = galleryEntry(portraitItem, source);
  assert.equal(entry.name, '그레일');
  assert.equal(entry.group, '인물');
  assert.equal(entry.url, portraitItem.url);
  assert.ok(entry.search.includes('룩스테라'));
  assert.equal(galleryEntry({ ...portraitItem, url: null }, source), null);
  assert.equal(galleryEntry({ ...portraitItem, use: 'N' }, source), null);
  const map = galleryEntry({ imageId: '3', path: 'maps/battle-maps/성/성 배틀맵 12.webp', role: '배틀맵', theme: '성', url: 'https://x/y.webp' }, galleryKind('map').sources[0]);
  assert.equal(map.name, '성 배틀맵 12');
  assert.equal(map.group, '성');
  const entries = [entry, map, { ...map, id: 'b', group: '숲', search: '숲 배틀맵', source: 'battlemap' }];
  assert.deepEqual(filterEntries(entries, { search: '그레일 룩스' }).map((e) => e.name), ['그레일']);
  assert.equal(filterEntries(entries, { source: 'battlemap', group: '숲' }).length, 1);
  assert.deepEqual(entryGroups(entries).map((g) => [g.value, g.count]), [['성', 1], ['숲', 1], ['인물', 1]]);
});

test('gallery loader pages through the archive, sends the token and caches per kind', async () => {
  clearImageCache();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: true, status: 200, json: async () => ({ error: false, data: { pages: 2, items: [{ ...portraitItem, imageId: String(page) }] } }) };
  };
  const entries = await loadGalleryEntries('portrait', { token: 'tok', fetcher, now: 1000 });
  assert.equal(entries.length, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.auth === 'Bearer tok'));
  await loadGalleryEntries('portrait', { token: 'tok', fetcher, now: 2000 });
  assert.equal(calls.length, 2, 'cached within five minutes');
  await loadGalleryEntries('portrait', { token: 'tok', fetcher, now: 2000, force: true });
  assert.equal(calls.length, 4);
});

test('gallery loader reports a missing or rejected token separately from network errors', async () => {
  clearImageCache();
  await assert.rejects(loadGalleryEntries('token', { token: '' }), (error) => error instanceof ArchiveImageError && error.code === 'TOKEN');
  await assert.rejects(
    loadGalleryEntries('token', { token: 'bad', fetcher: async () => ({ ok: false, status: 403, json: async () => ({}) }) }),
    (error) => error.code === 'AUTH',
  );
  await assert.rejects(
    loadGalleryEntries('token', { token: 'x', fetcher: async () => { throw new TypeError('offline'); } }),
    (error) => error.code === 'NETWORK',
  );
});

test('gallery template compiles and renders shape classes, tabs and the token form', async () => {
  const source = await readFile(new URL('../templates/gallery/image-gallery.hbs', import.meta.url), 'utf8');
  const hb = Handlebars.create();
  const render = hb.compile(source);
  const grid = render({ title: '맵', shape: 'map', hasTabs: true, sources: [{ id: 'battlemap', label: '배틀맵', count: 2, selected: true }], groups: [], entries: [{ id: 'a', url: 'u', name: 'n', group: 'g', search: 'n g', current: true }], total: 1, canPickLocal: true });
  assert.match(grid, /ncm-gallery__grid is-map/);
  assert.match(grid, /data-action="switchSource"/);
  assert.match(grid, /지금 사용 중/);
  assert.match(grid, /로컬 파일에서 선택/);
  const token = render({ title: '토큰', shape: 'token', needsToken: true, error: '토큰이 맞지 않습니다.' });
  assert.match(token, /data-gallery-token/);
  assert.doesNotMatch(token, /ncm-gallery__grid/);
});

test('item icon gallery reads only square concept art and names it by the object', () => {
  assert.deepEqual(galleryKind('item').sources.map((s) => [s.area, s.role]), [['concept', '정사각 설정화']]);
  const entry = galleryEntry({
    imageId: '9', path: 'wiki/trpg/images/settings/아이템/룩스테라/흑룡의 비늘/흑룡의 비늘 정사각 설정화.webp',
    role: '정사각 설정화', width: 1254, height: 1254, url: 'https://nihilncunia-images.com/settings/21/x.webp', use: 'Y', world: '룩스테라',
  }, galleryKind('item').sources[0]);
  assert.equal(entry.name, '흑룡의 비늘');
  assert.equal(entry.group, '룩스테라');
  assert.ok(entry.search.includes('흑룡의 비늘'));
});

test('item workbench image button opens the item icon gallery instead of the file picker', async () => {
  const source = await readFile(new URL('../scripts/workbench/workbench-app.mjs', import.meta.url), 'utf8');
  const action = source.slice(source.indexOf('static async _pickItemImageAction'), source.indexOf('static async _deleteItemAction'));
  assert.match(action, /kind: 'item'/);
  assert.match(action, /onPickLocal: pickLocal/);
});
