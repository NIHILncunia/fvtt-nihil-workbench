import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Handlebars from 'handlebars';
import {
  ARCHIVE_API_URL,
  clearImageCache,
  filterIconEntries,
  galleryEntry,
  galleryKind,
  iconCategoryTree,
  iconTags,
  loadGalleryEntries,
  loadIconCategories,
  normalizeIconCategories,
  sameImagePath,
} from '../scripts/gallery/archive-images.mjs';
import {
  getIconGalleryClass,
  getImageGalleryClass,
  openIconGallery,
  openImageGallery,
} from '../scripts/gallery/image-gallery-app.mjs';
import {
  injectFilePickerIconButton,
  registerFilePickerIconHooks,
} from '../scripts/gallery/file-picker-icons.mjs';

const icons = [
  { imageId: '1', iconName: 'Fire bow', category: 'weapons/bows', categoryName: '활', tags: ['불꽃', '원거리'], source: 'game-icons', fileName: 'fire-bow.webp', url: 'https://x/icons/fire-bow.webp?v=12345678' },
  { imageId: '2', iconName: 'Ice bow', category: 'weapons/bows', categoryName: '활', tags: ['얼음', '원거리'], url: 'https://x/icons/ice-bow.webp' },
  { imageId: '3', iconName: 'Fire claw', category: 'creatures/claws', categoryName: '발톱', tags: ['불꽃'], url: 'https://x/icons/claw.webp' },
];
const entries = icons.map((icon) => galleryEntry(
  icon,
  galleryKind('icon').sources[0],
));

function response(data) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

test(
  '아이콘은 원 이름과 분류·태그·출처를 보존하고 파일 이름으로 대체한다',
  () => {
    assert.deepEqual(
      galleryKind('icon'),
      { title: '아이콘', sources: [{ id: 'icon', area: 'icon', role: '' }] },
    );
    assert.equal(
      entries[0].name,
      'Fire bow',
    );
    assert.equal(
      entries[0].group,
      'weapons/bows',
    );
    assert.equal(
      entries[0].categoryName,
      '활',
    );
    assert.equal(
      entries[0].source,
      'game-icons',
    );
    assert.deepEqual(
      entries[0].tags,
      ['불꽃', '원거리'],
    );
    for (const word of ['fire bow', '활', 'weapons/bows', '불꽃', '원거리']) {
      assert.ok(entries[0].search.includes(word));
    }
    const fallback = galleryEntry(
      { ...icons[0], iconName: '', tags: ['불꽃', '불꽃', null] },
      galleryKind('icon').sources[0],
    );
    assert.equal(
      fallback.name,
      'fire-bow',
    );
    assert.deepEqual(
      fallback.tags,
      ['불꽃'],
    );
  },
);

test(
  '분류표의 세 가지 응답과 대체 필드·잘못된 수를 정규화한다',
  () => {
    const raw = [{ categoryKey: 'weapons/bows', categoryName: '활', sortOrder: '3', parentKey: 'weapons', iconCount: '7' }];
    for (const data of [{ items: raw }, { categories: raw }, raw]) {
      assert.deepEqual(
        normalizeIconCategories({ data }),
        [{ key: 'weapons/bows', name: '활', order: 3, parent: 'weapons', count: 7 }],
      );
    }
    assert.deepEqual(
      normalizeIconCategories({ data: { items: [{ key: 'magic', name: '마법', order: 2, parent: null, count: 0 }] } }),
      [{ key: 'magic', name: '마법', order: 2, parent: '', count: 0 }],
    );
    assert.equal(
      normalizeIconCategories([{ key: 'skills', count: '잘못된 값' }])[0].count,
      null,
    );
    for (const data of [null, {}, { items: {} }, [{}, { key: 'a/b/c' }]]) {
      assert.deepEqual(
        normalizeIconCategories(data),
        [],
      );
    }
  },
);

test(
  '분류 트리는 항목만으로 두 단계를 만들고 표의 순서·이름·수를 우선한다',
  () => {
    const tree = iconCategoryTree(
      [],
      entries,
    );
    const weapons = tree.find((root) => root.key === 'weapons');
    assert.equal(
      weapons.name,
      '무기',
    );
    assert.equal(
      weapons.count,
      2,
    );
    assert.equal(
      weapons.children[0].name,
      '활',
    );
    assert.equal(
      weapons.children[0].count,
      2,
    );
    const table = normalizeIconCategories([
      { key: 'weapons', name: '무기', order: 2, count: 20 },
      { key: 'magic', name: '마법', order: 1, count: 5 },
      { key: 'weapons/bows', name: '활 종류', count: 10 },
    ]);
    const fromTable = iconCategoryTree(
      table,
      entries,
    );
    assert.equal(
      fromTable[0].key,
      'creatures',
    );
    assert.equal(
      fromTable.find((root) => root.key === 'weapons').count,
      20,
    );
    assert.equal(
      fromTable.find((root) => root.key === 'weapons').children[0].name,
      '활 종류',
    );
  },
);

test(
  '상위 분류는 하위를 포함하고 태그는 모두 포함하며 검색어와 교차한다',
  () => {
    assert.equal(
      filterIconEntries(
        entries,
        { category: 'weapons' },
      ).length,
      2,
    );
    assert.equal(
      filterIconEntries(
        entries,
        { category: 'weapon' },
      ).length,
      0,
    );
    assert.equal(
      filterIconEntries(
        entries,
        { category: 'weapons/bows' },
      ).length,
      2,
    );
    assert.deepEqual(
      filterIconEntries(
        entries,
        { tags: ['불꽃', '원거리'] },
      ).map((entry) => entry.name),
      ['Fire bow'],
    );
    assert.equal(
      filterIconEntries(
        entries,
        { tags: ['불꽃', '얼음'] },
      ).length,
      0,
    );
    assert.equal(
      filterIconEntries(
        entries,
        { category: 'weapons', tags: ['불꽃'], search: 'FIRE 활' },
      ).length,
      1,
    );
    assert.equal(
      filterIconEntries(
        entries,
        { search: 'creatures/claws 불꽃' },
      ).length,
      1,
    );
    assert.deepEqual(
      iconTags(entries),
      [
        { name: '불꽃', count: 2 }, { name: '얼음', count: 1 }, { name: '원거리', count: 2 },
      ],
    );
  },
);

test(
  '현재 아이콘 경로는 버전 쿼리만 제외하고 비교한다',
  () => {
    assert.ok(sameImagePath(
      icons[0].url,
      'https://x/icons/fire-bow.webp',
    ));
    assert.ok(sameImagePath(
      'a.webp?size=2&v=old',
      'a.webp?size=2&v=new',
    ));
    assert.ok(sameImagePath(
      'a.webp?v=old&size=2',
      'a.webp?size=2',
    ));
    assert.equal(
      sameImagePath(
        'a.webp?size=2',
        'a.webp?size=3',
      ),
      false,
    );
    assert.equal(
      sameImagePath(
        'a.webp',
        'b.webp',
      ),
      false,
    );
    assert.equal(
      sameImagePath(
        '',
        '',
      ),
      false,
    );
  },
);

test(
  '아이콘과 분류표는 같은 인증으로 받고 분류 캐시는 만료·강제 조회·토큰 변경을 구분한다',
  async () => {
    clearImageCache();
    const calls = [];
    const fetcher = async (
      url,
      options,
    ) => {
      calls.push({ url, options });
      return response(url.endsWith('icon-categories') ? { categories: [{ key: 'weapons' }] } : { pages: 1, items: icons });
    };
    const loaded = await loadGalleryEntries(
      'icon',
      { token: '시험', fetcher, now: 1 },
    );
    assert.equal(
      loaded.length,
      3,
    );
    assert.equal(
      new URL(calls[0].url).searchParams.get('area'),
      'icon',
    );
    await loadIconCategories({ token: '시험', fetcher, now: 1 });
    assert.equal(
      calls[1].url,
      `${ARCHIVE_API_URL}/images/icon-categories`,
    );
    await loadIconCategories({ token: '시험', fetcher, now: 2 });
    assert.equal(
      calls.length,
      2,
    );
    await loadIconCategories({ token: '시험', fetcher, now: 300002 });
    await loadIconCategories({ token: '시험', fetcher, now: 300003, force: true });
    await loadIconCategories({ token: '다른 토큰', fetcher, now: 300004 });
    assert.equal(
      calls.length,
      5,
    );
    assert.ok(calls.every(({ options }) => options.cache === 'no-store'));
    assert.equal(
      calls[1].options.headers.Authorization,
      'Bearer 시험',
    );
  },
);

test(
  '분류표의 토큰·인증·네트워크·응답 오류도 기존 오류 계약을 따른다',
  async () => {
    clearImageCache();
    await assert.rejects(
      loadIconCategories({ token: '' }),
      { code: 'TOKEN' },
    );
    for (const [code, fetcher] of [
      ['AUTH', async () => ({ status: 403 })],
      ['NETWORK', async () => { throw new Error('연결 실패'); }],
      ['RESPONSE', async () => ({ ok: true, json: async () => { throw new Error('응답 오류'); } })],
      ['RESPONSE', async () => ({ ok: false, json: async () => ({ error: true, message: '목록 오류' }) })],
    ]) {
      await assert.rejects(
        loadIconCategories({ token: '시험', fetcher, force: true }),
        { code },
      );
    }
  },
);

test(
  '아이콘 템플릿은 글자 없는 격자와 선택 정보·조회·오류·토큰 경로를 렌더한다',
  async () => {
    const source = await readFile(
      new URL(
        '../templates/gallery/icon-gallery.hbs',
        import.meta.url,
      ),
      'utf8',
    );
    const render = Handlebars.compile(source);
    const html = render({
      entries: [{ ...entries[0], selected: true, current: true }],
      categories: iconCategoryTree(
        [],
        entries,
      ),
      tags: iconTags(entries),
      total: 3,
      categoryTotal: 3,
      canPickLocal: true,
    });
    const tile = html.match(/<button[^>]*data-entry-id="icon:1"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(tile);
    assert.match(
      tile[0],
      /data-tooltip="Fire bow"/,
    );
    assert.match(
      tile[0],
      /aria-pressed="true"/,
    );
    assert.equal(
      tile[1].replace(
        /<[^>]+>/g,
        '',
      ).trim(),
      '',
    );
    assert.doesNotMatch(
      tile[0],
      /ncm-gallery__name|ncm-gallery__badge/,
    );
    for (const text of ['이름·태그로 조회', '조회 결과', '조건에 맞는 아이콘이 없습니다.', '로컬 파일에서 선택', '이 아이콘 쓰기', '무기', '활']) assert.ok(html.includes(text));
    assert.doesNotMatch(
      html,
      /거르기|필터/,
    );
    const token = render({ needsToken: true });
    assert.match(
      token,
      /data-gallery-token/,
    );
    assert.doesNotMatch(
      token,
      /data-icon-grid/,
    );
    const error = render({ error: '목록 오류' });
    assert.match(
      error,
      /목록 오류/,
    );
    assert.match(
      error,
      /다시 시도/,
    );
    assert.doesNotMatch(
      error,
      /data-icon-grid/,
    );
  },
);

// 브라우저 없이 입력·이벤트·선택 상태의 계약만 검사하는 작은 DOM 대역이다.
function element(dataset = {}) {
  const classes = new Set();
  return {
    dataset,
    hidden: false,
    attributes: {},
    listeners: {},
    classList: { toggle: (
      name,
      active,
    ) => active ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
    setAttribute(
      name,
      value,
    ) { this.attributes[name] = value; },
    addEventListener(
      name,
      callback,
    ) { this.listeners[name] = callback; },
  };
}

function galleryRoot() {
  const cards = entries.map((entry) => element({ entryId: entry.id }));
  const category = element({ category: 'weapons' });
  const tag = element({ tag: '불꽃' });
  const fields = Object.fromEntries(['count', 'empty', 'name', 'category', 'tags', 'apply', 'grid'].map((name) => [name, element()]));
  const selectors = {
    '[data-gallery-count]': fields.count,
    '[data-gallery-empty]': fields.empty,
    '[data-icon-name]': fields.name,
    '[data-icon-category]': fields.category,
    '[data-icon-tags]': fields.tags,
    '[data-action="applyIcon"]': fields.apply,
    '[data-icon-grid]': fields.grid,
  };
  return {
    cards, fields, category, tag,
    querySelector: (selector) => selectors[selector] ?? null,
    querySelectorAll: (selector) => selector === '[data-entry-id]' ? cards : (selector === '[data-category], [data-tag]' ? [category, tag] : []),
  };
}

const click = { preventDefault() {}, stopPropagation() {} };

test(
  '아이콘 앱은 현재 경로를 선택하고 클릭·조회·적용·두 번 누르기를 구분한다',
  async (t) => {
    const original = { foundry: globalThis.foundry, game: globalThis.game, fetch: globalThis.fetch };
    t.after(() => Object.assign(
      globalThis,
      original,
    ));
    globalThis.foundry = { applications: { api: {
      ApplicationV2: class {
        render() { this.rendered = true; }
        async close() { this.closed = true; }
      },
      HandlebarsApplicationMixin: (Base) => Base,
    } } };
    globalThis.game = { settings: { get: () => '시험', set: async () => {} } };
    clearImageCache();
    globalThis.fetch = async (url) => response(url.endsWith('icon-categories') ? [] : { items: icons });
    const selected = [];
    const app = openIconGallery({ current: 'https://x/icons/fire-bow.webp?v=old', onSelect: (...args) => selected.push(args) });
    const Class = getIconGalleryClass();
    assert.ok(app instanceof Class);
    assert.match(
      Class.PARTS.main.template,
      /icon-gallery.hbs$/,
    );
    const context = await app._prepareContext();
    assert.equal(
      context.entries[0].source,
      'game-icons',
    );
    assert.ok(context.entries.find((entry) => entry.id === 'icon:1').selected);
    assert.equal(
      context.categories.find((root) => root.key === 'weapons').count,
      2,
    );
    app.element = galleryRoot();
    app._onRender(
      {},
      {},
    );
    assert.equal(
      app.element.fields.name.textContent,
      'Fire bow',
    );
    assert.equal(
      app.element.fields.apply.disabled,
      false,
    );
    Class.DEFAULT_OPTIONS.actions.choose.call(
      app,
      click,
      app.element.cards[1],
    );
    assert.equal(
      selected.length,
      0,
    );
    assert.equal(
      app.closed,
      undefined,
    );
    assert.equal(
      app.element.cards[1].attributes['aria-pressed'],
      'true',
    );
    assert.equal(
      app.element.fields.name.textContent,
      'Ice bow',
    );
    Class.DEFAULT_OPTIONS.actions.category.call(
      app,
      click,
      app.element.category,
    );
    Class.DEFAULT_OPTIONS.actions.tag.call(
      app,
      click,
      app.element.tag,
    );
    assert.deepEqual(
      app.element.cards.map((card) => card.hidden),
      [false, true, true],
    );
    app.search = '존재하지 않는 이름';
    app.applyFilter();
    assert.equal(
      app.element.fields.count.textContent,
      '0',
    );
    assert.equal(
      app.element.fields.empty.hidden,
      false,
    );
    await Class.DEFAULT_OPTIONS.actions.applyIcon.call(
      app,
      click,
    );
    assert.equal(
      selected[0][0],
      icons[1].url,
    );
    assert.equal(
      app.closed,
      true,
    );
  
    const double = openIconGallery({ onSelect: (...args) => selected.push(args) });
    await double._prepareContext();
    double.element = galleryRoot();
    double._onRender(
      {},
      {},
    );
    assert.equal(
      double.element.fields.apply.disabled,
      true,
    );
    double.element.fields.grid.listeners.dblclick({ ...click, target: { closest: () => double.element.cards[2] } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      selected[1][0],
      icons[2].url,
    );
    assert.equal(
      double.closed,
      true,
    );
  
    const item = openImageGallery({ kind: 'item' });
    item.entries = [];
    assert.ok(item instanceof getImageGalleryClass());
    assert.equal(
      (await item._prepareContext()).canOpenIcons,
      true,
    );
    await getImageGalleryClass().DEFAULT_OPTIONS.actions.switchGallery.call(
      item,
      click,
    );
    assert.equal(
      item.closed,
      true,
    );
  },
);

test(
  '분류표 장애는 항목 기반 트리로 대체하고 이미지 인증 오류는 토큰 입력으로 남긴다',
  async (t) => {
    const original = { game: globalThis.game, fetch: globalThis.fetch };
    t.after(() => Object.assign(
      globalThis,
      original,
    ));
    globalThis.game = { settings: { get: () => '시험' } };
    clearImageCache();
    globalThis.fetch = async (url) => {
      if (url.endsWith('icon-categories')) throw new Error('분류표 연결 실패');
      return response({ items: icons });
    };
    const app = new (getIconGalleryClass())();
    const context = await app._prepareContext();
    assert.equal(
      context.error,
      null,
    );
    assert.match(
      context.categoryWarning,
      /받은 아이콘/,
    );
    assert.equal(
      context.categories.length,
      2,
    );
    globalThis.fetch = async () => ({ status: 401 });
    await app.load(true);
    const failed = await app._prepareContext();
    assert.equal(
      failed.needsToken,
      true,
    );
    assert.equal(
      failed.entries.length,
      0,
    );
  },
);

function pickerDom() {
  const buttons = [];
  const footer = { append: (button) => buttons.push(button) };
  const root = {
    ownerDocument: { createElement: () => element() },
    querySelector: (selector) => selector === '.ncm-gallery__picker-icons' ? buttons[0] : footer,
  };
  return { root, buttons };
}

test(
  'FilePicker는 GM의 image·imagevideo에만 중복 없이 아이콘 단추를 붙인다',
  (t) => {
    const original = globalThis.game;
    t.after(() => { globalThis.game = original; });
    globalThis.game = { user: { isGM: true } };
    for (const type of ['image', 'imagevideo', 'audio', 'video', 'folder', 'any', undefined]) {
      const { root, buttons } = pickerDom();
      const allowed = ['image', 'imagevideo'].includes(type);
      assert.equal(
        injectFilePickerIconButton(
          { type },
          root,
        ),
        allowed,
      );
      assert.equal(
        buttons.length,
        allowed ? 1 : 0,
      );
      if (allowed) {
        assert.equal(
          buttons[0].textContent,
          '아이콘',
        );
        assert.equal(
          injectFilePickerIconButton(
            { type },
            root,
          ),
          false,
        );
      }
    }
    globalThis.game.user.isGM = false;
    assert.equal(
      injectFilePickerIconButton(
        { type: 'image' },
        pickerDom().root,
      ),
      false,
    );
  },
);

test(
  'FilePicker 적용은 직접 속성과 options 대체 경로에서 입력·이벤트·콜백·닫기 순서를 지킨다',
  async (t) => {
    const original = globalThis.game;
    t.after(() => { globalThis.game = original; });
    globalThis.game = { user: { isGM: true } };
    for (const useOptions of [false, true]) {
      const calls = [];
      let options;
      const field = { value: 'old.webp', dispatchEvent: (event) => calls.push(['change', event.type, event.bubbles]) };
      const data = {
        type: 'image', field,
        callback: function(
          url,
          picker,
        ) {
          assert.equal(
            this,
            picker,
          );
          assert.equal(
            field.value,
            url,
          );
          calls.push(['callback', url]);
        },
      };
      const picker = {
        ...(useOptions ? { options: data } : data),
        close: async () => calls.push(['close']),
        bringToFront: () => calls.push(['front']),
      };
      const { root, buttons } = pickerDom();
      injectFilePickerIconButton(
        picker,
        [root],
        (value) => { options = value; },
      );
      buttons[0].listeners.click(click);
      assert.equal(
        options.current,
        'old.webp',
      );
      options.onPickLocal();
      assert.deepEqual(
        calls,
        [['front']],
      );
      calls.length = 0;
      await options.onSelect('new.webp');
      assert.deepEqual(
        calls,
        [['change', 'change', true], ['callback', 'new.webp'], ['close']],
      );
    }
  },
);

test(
  'FilePicker 훅은 코어와 실제 대체 클래스 이름을 등록하고 재등록하지 않는다',
  (t) => {
    const original = { Hooks: globalThis.Hooks, CONFIG: globalThis.CONFIG, foundry: globalThis.foundry };
    t.after(() => Object.assign(
      globalThis,
      original,
    ));
    const names = [];
    globalThis.Hooks = { on: (name) => names.push(name) };
    globalThis.CONFIG = { ux: { FilePicker: class CustomPicker {} } };
    globalThis.foundry = { applications: { apps: { FilePicker: class FilePicker {} } } };
    registerFilePickerIconHooks();
    registerFilePickerIconHooks();
    assert.deepEqual(
      names,
      ['renderFilePicker', 'renderCustomPicker'],
    );
    globalThis.CONFIG.ux.FilePicker = class LaterPicker {};
    registerFilePickerIconHooks();
    assert.equal(
      names.at(-1),
      'renderLaterPicker',
    );
  },
);

test(
  '분류표에 부모가 없어도 하위 표의 수를 합산한다',
  () => {
    const tree = iconCategoryTree(
      normalizeIconCategories([
        { key: 'weapons/bows', count: 10 },
        { key: 'weapons/swords', count: 7 },
      ]),
      [],
    );
    assert.equal(
      tree[0].count,
      17,
    );
    assert.equal(
      tree[0].name,
      '무기',
    );
  },
);

test(
  '아이콘 적용은 중복 실행을 막고 콜백 실패 때 선택을 보존한다',
  async () => {
    const Class = getIconGalleryClass();
    let resolveSelection;
    let calls = 0;
    const app = new Class({ onSelect: () => {
      calls += 1;
      return new Promise((resolve) => { resolveSelection = resolve; });
    } });
    app.entries = entries;
    app.selectedId = entries[0].id;
    app.element = galleryRoot();
    const pending = Class.DEFAULT_OPTIONS.actions.applyIcon.call(
      app,
      click,
    );
    assert.equal(
      app.element.fields.apply.disabled,
      true,
    );
    await Class.DEFAULT_OPTIONS.actions.applyIcon.call(
      app,
      click,
    );
    assert.equal(
      calls,
      1,
    );
    resolveSelection();
    await pending;
    assert.equal(
      app.closed,
      true,
    );
  
    const failed = new Class({ onSelect: async () => { throw new Error('적용 실패'); } });
    failed.entries = entries;
    failed.selectedId = entries[0].id;
    failed.element = galleryRoot();
    await assert.rejects(
      Class.DEFAULT_OPTIONS.actions.applyIcon.call(
        failed,
        click,
      ),
      /적용 실패/,
    );
    assert.equal(
      failed.closed,
      undefined,
    );
    assert.equal(
      failed.selectedId,
      entries[0].id,
    );
    assert.equal(
      failed.element.fields.apply.disabled,
      false,
    );
  },
);

test(
  'FilePicker의 콜백 전용·입력칸 전용 경로를 적용하고 취소 때 닫지 않는다',
  async (t) => {
    const original = globalThis.game;
    t.after(() => { globalThis.game = original; });
    globalThis.game = { user: { isGM: true } };
    for (const onlyField of [false, true]) {
      let selected;
      let closed = false;
      let options;
      const field = { value: 'old.webp', dispatchEvent() {} };
      const picker = {
        type: 'image', request: 'old.webp',
        ...(onlyField ? { field } : { callback: (url) => { selected = url; } }),
        close: async () => { closed = true; },
      };
      const { root, buttons } = pickerDom();
      injectFilePickerIconButton(
        picker,
        root,
        (value) => { options = value; },
      );
      buttons[0].listeners.click(click);
      assert.equal(
        options.current,
        'old.webp',
      );
      options.onPickLocal();
      assert.equal(
        closed,
        false,
      );
      await options.onSelect('new.webp');
      assert.equal(
        onlyField ? field.value : selected,
        'new.webp',
      );
      assert.equal(
        closed,
        true,
      );
    }
  },
);

test(
  '모듈 진입점은 아이콘 API와 FilePicker 훅을 실제로 등록한다',
  async (t) => {
    const original = { game: globalThis.game, Hooks: globalThis.Hooks };
    t.after(() => Object.assign(
      globalThis,
      original,
    ));
    const module = { api: {} };
    const names = [];
    globalThis.game = { modules: new Map([['nihil-compendium-module', module]]) };
    globalThis.Hooks = { on: (name) => names.push(name), once() {} };
    await import(`../scripts/module.mjs?icon-test=${Date.now()}`);
    assert.equal(
      module.api.openIconGallery,
      openIconGallery,
    );
    assert.equal(
      module.api.openImageGallery,
      openImageGallery,
    );
    assert.ok(names.includes('renderFilePicker'));
  },
);
