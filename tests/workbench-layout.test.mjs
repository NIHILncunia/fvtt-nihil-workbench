import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Handlebars from 'handlebars';

import { workbenchFolderPath } from '../scripts/workbench/workbench-layout.mjs';

function folderChain(depth) {
  let folder = null;
  for (let i = 1; i <= depth; i++) {
    folder = { id: `folder-${i}`, name: `시험 폴더 ${i}`, folder };
  }
  return folder;
}

async function render(kind, context) {
  const source = await readFile(
    new URL(`../templates/workbench/${kind}-workbench.hbs`, import.meta.url),
    'utf8',
  );
  return Handlebars.compile(source)(context);
}

test('Deep folder paths expose the root-side ancestors, the parent and the current location', () => {
  const path = workbenchFolderPath(folderChain(6));
  assert.deepEqual(
    path.middle.map(({ id }) => id),
    ['folder-1', 'folder-2', 'folder-3', 'folder-4'],
  );
  assert.deepEqual(
    path.ancestors.map(({ id }) => id),
    ['folder-1', 'folder-2', 'folder-3', 'folder-4', 'folder-5'],
  );
  assert.equal(path.parent.id, 'folder-5');
  assert.deepEqual(path.current, { id: 'folder-6', name: '시험 폴더 6', current: true });
  assert.deepEqual(workbenchFolderPath(null), { current: null, parent: null, middle: [], ancestors: [] });
  assert.equal(workbenchFolderPath(folderChain(1)).parent, null);
  assert.deepEqual(workbenchFolderPath(folderChain(2)).middle, []);
});

test('A malformed folder cycle does not duplicate ancestors or hang navigation', () => {
  const folder = folderChain(3);
  folder.folder.folder.folder = folder;
  const path = workbenchFolderPath(folder);
  assert.deepEqual(path.ancestors.map(({ id }) => id), ['folder-1', 'folder-2']);
  assert.equal(path.current.id, 'folder-3');
});

test('Item and Actor rows and path controls retain their existing navigation and drop targets', async () => {
  const path = workbenchFolderPath(folderChain(6));
  const item = await render('item', {
    path,
    canGoParent: true,
    currentFolder: path.current,
    canManageItems: true,
    folders: [{ id: 'child-item', name: '하위 폴더' }],
  });
  assert.match(item, /상위 4개/);
  assert.match(item, /상위 5개/);
  assert.match(item, /data-action="goBreadcrumb" data-folder-id="folder-6"[^>]*aria-current="location"/);
  assert.match(item, /data-action="openFolder" data-folder-id="child-item"/);
  assert.match(item, /data-workbench-panel="list"[\s\S]*data-workbench-panel="form"/);
  assert.match(item, /<button type="submit" disabled class="ncm-workbench__save"/);

  const actor = await render('actor', {
    canManage: true,
    browser: {
      path,
      hasParentFolder: true,
      currentFolderId: path.current.id,
      parentFolderId: path.parent.id,
      folders: [{ id: 'child-actor', name: '하위 폴더' }],
      rows: [{ id: 'actor-1', name: '시험 액터' }],
    },
  });
  assert.match(actor, /data-action="openActorFolder" data-folder-id="folder-3" data-actor-drop-folder="folder-3"/);
  assert.match(actor, /data-action="goActorParentFolder" data-actor-drop-folder="folder-5"/);
  assert.match(actor, /data-action="goActorRootFolder" data-folder-id="" data-actor-drop-folder=""/);
  assert.match(actor, /data-action="openActorFolder" data-folder-id="child-actor" data-actor-drop-folder="child-actor"/);
  assert.match(actor, /data-action="selectActor" data-actor-id="actor-1" draggable="true"/);
});

test('Scene submit and compendium creation keep their distinct commands above the panes', async () => {
  const scene = await render('scene', { canEdit: false, isNew: false });
  const toolbar = scene.slice(0, scene.indexOf('data-workbench-panel="list"'));
  assert.match(toolbar, /data-action="deleteScene"[^>]*disabled/);
  assert.match(toolbar, /type="submit" class="ncm-workbench__save" disabled/);
  assert.match(scene, /data-workbench-panel="form"[\s\S]*name="sceneName"/);

  const compendium = await render('compendium', {
    pack: { name: '시험 팩', locked: true },
    canWrite: false,
    canToggleLock: true,
    entries: [{ id: 'entry-1', name: '시험 문서' }],
  });
  const compendiumToolbar = compendium.slice(0, compendium.indexOf('data-workbench-panel="list"'));
  assert.match(compendiumToolbar, /data-action="create" disabled/);
  assert.match(compendiumToolbar, /data-action="toggleLock"/);
  assert.doesNotMatch(compendium, /type="submit"/);
  assert.match(compendium, /data-workbench-panel="list"[\s\S]*data-action="edit" data-entry-id="entry-1"[\s\S]*data-workbench-panel="form"/);
});

test('Compendium selection and search remain in the list pane', async () => {
  const html = await render('compendium', {
    pack: { name: '시험 팩', locked: true },
    concepts: [{ value: '시험', selected: true }],
    packs: [{ id: 'test.pack', name: '시험 팩', selected: true }],
  });
  const panels = html.split('data-workbench-panel=');
  const list = panels[1];
  const form = panels[2];
  for (const name of ['packConcept', 'packTarget', 'packSearch']) {
    assert.ok(list.includes('name="' + name + '"'));
    assert.ok(!form.includes('name="' + name + '"'));
  }
  assert.match(form, /컨셉별 모듈 팩에 직접 등록하고 편집합니다/);
});

test('Creation and deletion controls in every split template are explicit buttons', async () => {
  const expected = {
    item: ['createFolder', 'deleteFolder', 'createItem', 'deleteItem'],
    actor: ['createActorFolder', 'deleteActorFolder', 'newActor', 'deleteActor'],
    scene: ['newScene', 'deleteScene'],
    compendium: ['create'],
  };
  for (const [kind, actions] of Object.entries(expected)) {
    const html = await readFile(
      new URL(`../templates/workbench/${kind}-workbench.hbs`, import.meta.url),
      'utf8',
    );
    for (const action of actions) {
      const tags = Array.from(html.matchAll(/<button\b[^>]*>/g), ([tag]) => tag)
        .filter((tag) => tag.includes('data-action="' + action + '"'));
      assert.ok(tags.length > 0, action);
      assert.ok(tags.every((tag) => tag.includes('type="button"')), action);
    }
  }
});
