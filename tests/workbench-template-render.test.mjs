import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import Handlebars from 'handlebars';

const directory = new URL(
  '../templates/workbench/',
  import.meta.url,
);

test(
  'Every Workbench template compiles with the real Handlebars parser',
  async () => {
    const files = (await readdir(directory)).filter((name) =>
      name.endsWith('.hbs'),
    );
    for (const file of files) {
      const source = await readFile(
        new URL(
          file,
          directory,
        ),
        'utf8',
      );
      assert.doesNotThrow(
        () => Handlebars.precompile(source),
        file,
      );
    }
    assert.equal(
      files.length,
      9,
    );
  },
);

test(
  'Pack Actor creation renders its target and direct form while World creation keeps SBI',
  async () => {
    const source = await readFile(
      new URL(
        'actor-workbench.hbs',
        directory,
      ),
      'utf8',
    );
    const render = Handlebars.compile(source);
    const context = {
      canManage: true,
      browser: { typeTabs: [], rows: [], folders: [] },
      creation: {
        isNpc: true,
        isDirect: true,
        type: 'npc',
        folderName: '최상위',
      },
    };
    const world = render(context);
    const pack = render({
      ...context,
      packTarget: {
        id: 'nihil-compendium-module.common-monsters',
        label: '액터',
        locked: false,
      },
    });
    assert.ok(pack.trim().startsWith('<div class="ncm-actor-workbench__layout">'));
    assert.ok(pack.trim().endsWith('</div>'));
    const itemSource = await readFile(
      new URL(
        'item-workbench.hbs',
        directory,
      ),
      'utf8',
    );
    const item = Handlebars.compile(itemSource)({
      packTarget: { label: '아이템', locked: false },
      selected: null,
    });
    assert.ok(item.trim().startsWith('<div class="ncm-workbench__layout">'));
    assert.ok(item.trim().endsWith('</div>'));
    assert.match(
      world,
      /SBI 문자열 사용/,
    );
    assert.doesNotMatch(
      pack,
      /SBI 문자열 사용/,
    );
    assert.match(
      pack,
      /컴펜디움 직접 편집/,
    );
    assert.match(
      pack,
      /name="actorName"/,
    );
  },
);
