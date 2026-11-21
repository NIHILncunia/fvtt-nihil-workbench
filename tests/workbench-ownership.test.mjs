import assert from 'node:assert/strict';
import test from 'node:test';
import { ownershipFields, ownershipPatch, canManageOwnership, editOwnership } from '../scripts/workbench/ownership-workbench-app.mjs';
import { buildDocumentPatch } from '../scripts/workbench/document-fields.mjs';
import { getDocumentWorkbenchClass } from '../scripts/workbench/document-workbench-app.mjs';

const users = [{ id: 'player', name: '플레이어' }, { id: 'other', name: '다른 사용자' }, { id: 'gm', isGM: true }];

test('Ownership controls preserve absent overrides and skip GM rows', () => {
  const source = { ownership: { default: 1, player: 3, removedUser: 2 } };
  const fields = ownershipFields(source, users);
  assert.deepEqual(fields.map(field => field.path), ['ownership.default', 'ownership.player', 'ownership.other']);
  assert.equal(fields[2].value, '-1');
  assert.equal(fields[2].options.find(option => option.selected).label, '기본 권한 따르기');
  const patch = buildDocumentPatch(fields, { 'ownership.player': '-1', 'ownership.other': '2' }, source);
  assert.deepEqual(ownershipPatch(patch.patch, fields), { 'ownership.-=player': null, 'ownership.other': 2 });
  assert.equal(source.ownership.removedUser, 2);
  assert.deepEqual(buildDocumentPatch(fields, Object.fromEntries(fields.map(field => [field.path, field.initial])), source).patch, {});
});

test('Ownership edits detect same-user conflicts and preserve other external changes', () => {
  const source = { ownership: { default: 0, player: 1 } };
  const fields = ownershipFields(source, users);
  assert.deepEqual(buildDocumentPatch(fields, { 'ownership.player': '2' }, { ownership: { ...source.ownership, other: 3 } }).conflicts, []);
  assert.deepEqual(buildDocumentPatch(fields, { 'ownership.player': '2' }, { ownership: { ...source.ownership, player: 3 } }).conflicts, ['ownership.player']);
  for (const value of ['-2', '4', '1.5', 'NaN']) assert.throws(() => buildDocumentPatch(fields, { 'ownership.player': value }, source), /숫자/);
  assert.throws(() => ownershipPatch({ 'ownership.default': -1 }, fields), /권한/);
  assert.throws(() => ownershipPatch({ 'ownership.unknown': 3 }, fields), /권한/);
  assert.throws(() => ownershipFields(source, [{ id: '__proto__' }]), /ID/);
});

test('Ownership editor rejects inherited, pack, deleted and non-GM targets and preserves failed input', async () => {
  const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
  const errors = [], writes = [];
  const source = { ownership: { default: 0, player: 1 } };
  const document = { id: 'actor', documentName: 'Actor', name: '시험 액터', toObject: () => structuredClone(source), update: async patch => { writes.push(patch); return document; } };
  globalThis.game = { user: { isGM: true }, users: new Map(users.map(user => [user.id, user])), actors: new Map([['actor', document]]), items: new Map() };
  globalThis.foundry = { applications: { api: { ApplicationV2: class { render() {} async close() { this.closed = true; } }, HandlebarsApplicationMixin: base => base, DialogV2: { confirm: async () => true } } } };
  globalThis.ui = { notifications: { error: message => errors.push(message), warn: message => errors.push(message), info() {} } };
  try {
    assert.equal(canManageOwnership(document), true);
    assert.equal(canManageOwnership({ ...document, parent: {} }), false);
    assert.equal(canManageOwnership({ ...document, pack: 'test.pack' }), false);
    assert.equal(canManageOwnership(document, () => false), false);
    const app = editOwnership(document);
    app.values = () => ({ 'ownership.player': '2' });
    const save = () => getDocumentWorkbenchClass().DEFAULT_OPTIONS.form.handler.call(app, { preventDefault() {} });
    source.ownership.player = 3;
    await save();
    assert.equal(writes.length, 0);
    assert.equal(app.closed, undefined);
    assert.ok(errors.at(-1).includes('다른 곳'));
    source.ownership.player = 1;
    globalThis.game.user.isGM = false;
    await save();
    assert.equal(writes.length, 0);
    globalThis.game.user.isGM = true;
    globalThis.game.actors.delete(document.id);
    await save();
    assert.equal(writes.length, 0);
    globalThis.game.actors.set(document.id, document);
    document.update = async () => undefined;
    await save();
    assert.equal(app.closed, undefined);
    assert.ok(errors.at(-1).includes('취소'));
    assert.equal(app.values()['ownership.player'], '2');
    document.update = async patch => { writes.push(patch); return document; };
    await save();
    assert.deepEqual(writes, [{ 'ownership.player': 2 }]);
    assert.equal(app.closed, true);
  } finally { Object.assign(globalThis, previous); }
});
