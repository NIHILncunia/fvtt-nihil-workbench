import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Handlebars from 'handlebars';
import {
  canCreateWorkbenchFolder,
  folderCreateDialog,
  installFolderCreateDialog,
  openFolderWorkbench,
  openWorkbenchFolder,
} from '../scripts/workbench/folder-workbench.mjs';
import { editDocument } from '../scripts/workbench/document-workbench-app.mjs';
import { buildDocumentPatch, readDocumentFields } from '../scripts/workbench/document-fields.mjs';

const apps = [];
const writes = [];
let renderFailure = false;
let silentRender = false;
let writeResult;
let writeError;
class FolderConfig {}
class ApplicationV2 {
  constructor(options) { this.options = options; }
  render() {
    apps.push(this);
    this.rendered = !silentRender;
    if (renderFailure) return Promise.reject(new Error('render failed'));
    return Promise.resolve(this);
  }
  async close() { this.closed = true; return this; }
}
class Folder {
  static schema = { fields: {
    name: {}, color: { nullable: true },
    sorting: { choices: { a: '이름순', m: '수동 정렬' } },
  } };
  static defaultName() { return '코어 기본 폴더'; }
  static canUserCreate(user) { return user.isGM; }
  static async create(
    source,
    options,
  ) {
    writes.push({ source, options });
    if (writeError) throw writeError;
    return writeResult;
  }
  constructor(
    source,
    options,
  ) {
    this.source = { color: null, sort: 0, flags: {}, ...source };
    this.options = options;
    this.schema = Folder.schema;
  }
  toObject() { return structuredClone(this.source); }
  _getSheetClass() { return FolderConfig; }
}
globalThis.foundry = { applications: {
  api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base, DialogV2: { confirm: async () => true } },
  sheets: { FolderConfig },
} };
globalThis.CONFIG = { Folder: { documentClass: Folder } };
globalThis.customElements = { get: () => class {} };
globalThis.ui = { notifications: { error() {}, info() {}, warn() {} } };
globalThis.console = { ...console, warn() {} };

function reset() {
  apps.length = 0;
  writes.length = 0;
  renderFailure = false;
  silentRender = false;
  writeError = null;
  writeResult = { id: 'new-folder' };
  globalThis.game = { user: { id: 'gm', role: 4, isGM: true }, packs: new Map() };
}
const event = { preventDefault() {} };
async function save(
  app,
  values = {},
) {
  app.values = () => Object.fromEntries(app.fields.map(
    (field) => [field.path, values[field.path] ?? field.value],
  ));
  await app.constructor.DEFAULT_OPTIONS.form.handler.call(
    app,
    event,
  );
}

for (const [type, label] of Object.entries({
  Actor: '액터', Item: '아이템', Scene: '씬', JournalEntry: '저널', RollTable: '표',
  Cards: '카드', Macro: '매크로', Playlist: '재생목록', Compendium: '컴펜디움',
})) test(
  `${type} core dialog returns the created Folder with type, parent, defaults and operation intact`,
  async () => {
    reset();
    const options = { keepId: true, renderSheet: false };
    let fallbacks = 0;
    const promise = folderCreateDialog(
      () => { fallbacks++; },
      { type, folder: 'parent', flags: { other: { preserve: true } }, sort: 123 },
      options,
      { position: { top: 30, left: 80 } },
    );
    const app = apps.at(-1);
    assert.equal(app.config.title, `${label} 폴더 생성`);
    assert.equal(app.options.position.height, 'auto');
    assert.equal(app.options.position.left, 80);
    await save(app);
    assert.equal(await promise, writeResult);
    assert.deepEqual(writes[0], { source: {
      name: '코어 기본 폴더', color: null, sorting: 'a', sort: 123,
      type, folder: 'parent', flags: { other: { preserve: true } },
    }, options });
    assert.deepEqual(options, { keepId: true, renderSheet: false });
    assert.equal(fallbacks, 0);
  },
);

test('close returns null once and never creates a Folder', async () => {
  reset();
  const result = folderCreateDialog(
    () => assert.fail('fallback'),
    { type: 'Item' },
  );
  const app = apps.at(-1);
  app.values = () => ({});
  await app.close();
  await app.close();
  assert.equal(await result, null);
  assert.equal(writes.length, 0);
});

test('all compendium types retain pack scope; lock and ownership changes block saving', async () => {
  reset();
  for (const type of ['Actor', 'Item', 'Scene', 'JournalEntry', 'RollTable', 'Cards', 'Macro', 'Playlist']) {
    const pack = { documentName: type, locked: false, documentClass: Folder, testUserPermission: () => true };
    game.packs.set('other-module.pack', pack);
    const app = openFolderWorkbench({ data: { type, folder: 'pack-parent' }, createOptions: { pack: 'other-module.pack' } });
    pack.locked = true;
    await save(app);
    assert.equal(app.saved, false);
    pack.locked = false;
    pack.testUserPermission = () => false;
    await save(app);
    assert.equal(app.saved, false);
    pack.testUserPermission = () => true;
    await save(app);
    assert.equal(writes.at(-1).options.pack, 'other-module.pack');
    assert.equal(writes.at(-1).source.folder, 'pack-parent');
  }
  assert.equal(writes.length, 8);
});

test('non-workbench users and denied folder or pack permissions use the original dialog', async () => {
  reset();
  let fallbacks = 0;
  const original = () => { fallbacks++; return 'original'; };
  for (const user of [{ role: 3, isGM: true }, { role: 1, isGM: false }, { id: 'rXB1GcSui4mDsgAn', role: 1, isGM: false }]) {
    game.user = user;
    assert.equal(await folderCreateDialog(original, { type: 'Item' }), 'original');
  }
  game.user = { role: 4, isGM: true };
  assert.equal(canCreateWorkbenchFolder('Item', { pack: 'missing' }), false);
  assert.equal(await folderCreateDialog(original, { type: 'Item' }, { pack: 'missing' }), 'original');
  assert.equal(fallbacks, 4);
  assert.equal(apps.length, 0);
});

test('render failure, unknown types, custom contracts and custom Folder sheets restore the original dialog', async () => {
  reset();
  const calls = [];
  const original = (...args) => { calls.push(args); return 'original'; };
  renderFailure = true;
  assert.equal(await folderCreateDialog(original, { type: 'Item' }), 'original');
  assert.equal(apps[0].closed, true);
  renderFailure = false;
  assert.equal(await folderCreateDialog(original, { type: 'Other' }), 'original');
  const options = { title: 'legacy' };
  assert.equal(await folderCreateDialog(original, { type: 'Item' }, options), 'original');
  assert.equal(calls.at(-1)[1], options);
  const dialog = { customCallback() {} };
  assert.equal(await folderCreateDialog(original, { type: 'Item' }, {}, dialog), 'original');
  assert.equal(calls.at(-1)[2], dialog);
  const getSheet = Folder.prototype._getSheetClass;
  Folder.prototype._getSheetClass = () => class CustomSheet {};
  try {
    assert.equal(await folderCreateDialog(original, { type: 'Item' }), 'original');
  } finally { Folder.prototype._getSheetClass = getSheet; }
  assert.equal(writes.length, 0);
});

test('cancelled writes and write errors keep input and do not fall back or resolve success', async () => {
  reset();
  let settled = false;
  const result = folderCreateDialog(
    () => assert.fail('must not retry a write through core'),
    { type: 'Item' },
  );
  result.then(() => { settled = true; });
  const app = apps.at(-1);
  writeResult = undefined;
  await save(app, { name: '입력 유지' });
  assert.equal(app.saved, false);
  assert.equal(settled, false);
  writeError = new Error('permission lost');
  await save(app, { name: '입력 유지' });
  assert.equal(app.saved, false);
  assert.equal(app.closed, undefined);
  await app.close();
  assert.equal(await result, null);
});

test('closing during a write waits for the actual Folder result and rejects double submit', async () => {
  reset();
  let release;
  writeResult = new Promise((resolve) => { release = resolve; });
  const result = folderCreateDialog(() => assert.fail(), { type: 'Item' });
  const app = apps.at(-1);
  const saving = save(app);
  await app.close();
  await save(app);
  assert.equal(app.closed, undefined);
  assert.equal(writes.length, 1);
  const created = { id: 'actual-folder' };
  release(created);
  await saving;
  assert.equal(await result, created);
});

test('afterCreate refresh failure cannot allow a duplicate Folder write', async () => {
  reset();
  const app = openFolderWorkbench({ data: { type: 'Item' }, afterCreate: () => { throw new Error('refresh'); } });
  await save(app);
  assert.equal(app.saved, true);
  assert.equal(app.result, writeResult);
  assert.equal(writes.length, 1);
});

test('folder color preserves null on unchanged save, supports clear, validates hex and leaves other color paths alone', () => {
  const source = { color: null, flags: { color: 'meaning' } };
  const fields = readDocumentFields(source, Folder.schema);
  fields.find((field) => field.path === 'color').colorPicker = true;
  assert.deepEqual(buildDocumentPatch(fields, { color: '' }, source).patch, {});
  assert.deepEqual(buildDocumentPatch(fields, { color: '#A0b1C2' }, source).patch, { color: '#A0b1C2' });
  assert.throws(() => buildDocumentPatch(fields, { color: '#fff' }, source), /RRGGBB/);
  assert.throws(() => buildDocumentPatch(fields, { color: 'red' }, source), /RRGGBB/);
  assert.deepEqual(buildDocumentPatch(fields, { flags: '{"color":"text"}' }, source).patch, { 'flags.color': 'text' });
  const colored = { color: '#123456' };
  const colorFields = readDocumentFields(colored, Folder.schema);
  colorFields[0].colorPicker = true;
  assert.deepEqual(buildDocumentPatch(colorFields, { color: '' }, colored).patch, { color: null });
  assert.deepEqual(buildDocumentPatch(colorFields, { color: '  #123456  ' }, colored).patch, {});
});

test('Folder edit enables only the root color picker and keeps unrelated document fields ordinary', () => {
  reset();
  const source = { name: '폴더', color: null, flags: { color: 'other' } };
  const document = { name: source.name, documentName: 'Folder', schema: Folder.schema, toObject: () => source, update() {} };
  const app = editDocument(document, { roots: ['name', 'color', 'flags'] });
  assert.equal(app.fields.find((field) => field.path === 'color').colorPicker, true);
  assert.equal(app.fields.find((field) => field.path === 'flags').colorPicker, false);
  const other = editDocument({ ...document, documentName: 'Item' }, { roots: ['color'] });
  assert.equal(other.fields[0].colorPicker, false);
});

test('color clear changes only the associated picker and respects edit permission', () => {
  reset();
  const app = openFolderWorkbench({ data: { type: 'Item' } });
  const picker = { value: '#123456' };
  const target = { closest: () => ({ querySelector: () => picker }) };
  app.constructor.DEFAULT_OPTIONS.actions.clearColor.call(app, event, target);
  assert.equal(picker.value, '');
  picker.value = '#123456';
  game.user.role = 3;
  app.constructor.DEFAULT_OPTIONS.actions.clearColor.call(app, event, target);
  assert.equal(picker.value, '#123456');
});

test('folder template uses one value-bearing core picker with direct entry and a clear button', async () => {
  const template = await readFile(new URL('../templates/workbench/document-workbench.hbs', import.meta.url), 'utf8');
  const html = Handlebars.compile(template)({ canEdit: true, fields: [{ path: 'color', colorPicker: true, value: '' }] });
  assert.equal((html.match(/data-document-path="color"/g) ?? []).length, 1);
  assert.match(html, /<color-picker[^>]*value=""/);
  assert.match(html, /data-action="clearColor"/);
});

test('direct wrapper chains existing modules, keeps this and installs once', async () => {
  reset();
  class CustomFolder extends Folder {}
  let owner;
  CustomFolder.createDialog = function () { owner = this; return 'prior-wrapper'; };
  CONFIG.Folder.documentClass = CustomFolder;
  try {
    assert.equal(installFolderCreateDialog(), true);
    assert.equal(installFolderCreateDialog(), false);
    game.user.role = 3;
    assert.equal(await CustomFolder.createDialog({ type: 'Item' }), 'prior-wrapper');
    assert.equal(owner, CustomFolder);
  } finally { CONFIG.Folder.documentClass = Folder; }
});

test('libWrapper registers MIXED once and registration failure leaves core intact', () => {
  reset();
  class WrappedFolder extends Folder {}
  WrappedFolder.createDialog = () => 'core';
  CONFIG.Folder.documentClass = WrappedFolder;
  const calls = [];
  globalThis.libWrapper = { register: (...args) => calls.push(args) };
  try {
    assert.equal(installFolderCreateDialog(), true);
    assert.equal(installFolderCreateDialog(), false);
    assert.equal(calls[0][1], 'CONFIG.Folder.documentClass.createDialog');
    assert.equal(calls[0][3], 'MIXED');
    class FailingFolder extends WrappedFolder {}
    CONFIG.Folder.documentClass = FailingFolder;
    libWrapper.register = () => { throw new Error('conflict'); };
    assert.equal(installFolderCreateDialog(), false);
    assert.equal(FailingFolder.createDialog(), 'core');
  } finally {
    delete globalThis.libWrapper;
    CONFIG.Folder.documentClass = Folder;
  }
});

test('direct workbench render failure falls back to core and refreshes only after creation', async () => {
  reset();
  renderFailure = true;
  const result = { id: 'core-folder' };
  let refreshed;
  let done;
  const completed = new Promise((resolve) => { done = resolve; });
  Folder.createDialog = async () => result;
  const app = openWorkbenchFolder({
    data: { type: 'Item' },
    afterCreate: (created) => { refreshed = created; done(); },
  });
  await completed;
  assert.equal(app.closed, true);
  assert.equal(refreshed, result);
  assert.equal(writes.length, 0);
});

test('missing color-picker falls back on direct workbench entry without widening pack policy', async () => {
  reset();
  const get = customElements.get;
  customElements.get = () => undefined;
  let fallbacks = 0;
  Folder.createDialog = async () => { fallbacks++; return { id: 'core' }; };
  try {
    const result = await openWorkbenchFolder({ data: { type: 'Item' } });
    assert.equal(result.id, 'core');
    const denied = await openWorkbenchFolder({ data: { type: 'Item' }, canCreate: () => false });
    assert.equal(denied, null);
    assert.equal(fallbacks, 1);
    assert.equal(apps.length, 0);
  } finally { customElements.get = get; }
});

test('a render that resolves without showing a window restores core on both entry paths', async () => {
  reset();
  silentRender = true;
  assert.equal(await folderCreateDialog(
    () => 'core',
    { type: 'Item' },
  ), 'core');
  let done;
  const completed = new Promise((resolve) => { done = resolve; });
  Folder.createDialog = async () => ({ id: 'core' });
  const app = openWorkbenchFolder({
    data: { type: 'Item' },
    afterCreate: done,
  });
  assert.equal((await completed).id, 'core');
  assert.equal(app.closed, true);
});

test('actual core sorting choices expressed as an array have readable Korean labels', () => {
  reset();
  const original = Folder.schema.fields.sorting;
  Folder.schema.fields.sorting = { choices: ['a', 'm'] };
  try {
    const app = openFolderWorkbench({ data: { type: 'Item' } });
    const sorting = app.fields.find((field) => field.path === 'sorting');
    assert.deepEqual(
      sorting.options.map((option) => ({ value: option.value, label: option.label })),
      [{ value: 'a', label: '이름순' }, { value: 'm', label: '수동 정렬' }],
    );
    const editing = editDocument(
      { documentName: 'Folder', schema: Folder.schema, toObject: () => ({ sorting: 'm' }), update() {} },
      { roots: ['sorting'] },
    );
    assert.deepEqual(
      editing.fields[0].options.map((option) => option.label),
      ['이름순', '수동 정렬'],
    );
  } finally {
    Folder.schema.fields.sorting = original;
  }
});

test('folder Escape requests close and prevents the core main menu without affecting other editors', () => {
  reset();
  const app = openFolderWorkbench({ data: { type: 'Item' } });
  let closed = 0;
  let prevented = 0;
  let stopped = 0;
  app.close = () => { closed++; };
  const event = { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  app._onFolderEscape(event);
  assert.deepEqual(
    [closed, prevented, stopped],
    [1, 1, 1],
  );
  app._onFolderEscape({ ...event, key: 'Enter' });
  app.config.folderForm = false;
  app._onFolderEscape(event);
  assert.equal(closed, 1);
});
