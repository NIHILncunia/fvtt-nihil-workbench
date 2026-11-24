import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

test('manifest loads Workbench stylesheet while keeping module entrypoint', async () => {
  const manifest = JSON.parse(await text('module.json'));
  assert.deepEqual(manifest.esmodules, ['scripts/module.mjs']);
  assert.ok(manifest.styles.includes('styles/workbench.css'));
});

test('Workbench application uses ApplicationV2 Handlebars template and Item adapter', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  assert.match(source, /HandlebarsApplicationMixin/);
  assert.match(source, /ApplicationV2/);
  assert.match(source, /item-adapter\.mjs/);
  assert.match(source, /templates\/workbench\/item-workbench\.hbs/);
  assert.match(source, /openWorkbench/);
  assert.match(source, /data-action|actions/);
});

test('World Item Workbench saves basic edits through its Item document context panel', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  assert.match(source, /item-document-context\.mjs/);
  assert.match(source, /item-workbench-panel\.mjs/);
  assert.match(source, /createWorldItemContext\(item\)/);
  assert.match(source, /itemPanel\.saveBasic\(\s*basicChanges,\s*typeUpdate,/);
});

test('Item Workbench can reuse its complete editor for an Actor Embedded Item context', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(source.includes('export function openEmbeddedItemWorkbench'));
  assert.ok(source.includes('selectEmbeddedItem(actor, item)'));
  assert.ok(source.includes('createEmbeddedItemContext(actor, item)'));
  assert.ok(source.includes('this.documentContext ?? createWorldItemContext(item)'));
});

test('Workbench template exposes two-column Item editing controls', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  for (const required of [
    'ncm-workbench__editor',
    'ncm-workbench__browser',
    'data-action="selectItem"',
    'data-action="selectActivity"',
    'data-action="openAdvanced"',
    'data-action="addOnHitStatus"',
    'data-action="attachEffect"',
    'data-action="detachEffect"',
    'data-action="addPassiveEffect"',
    '명중 시 효과',
    '지속 효과',
    '추가 피해',
    '사용 횟수',
  ]) assert.ok(template.includes(required), `missing template contract: ${required}`);
});

test('Workbench form controls keep buttons the same height as inputs', async () => {
  const css = await text('styles/workbench.css');
  assert.match(css, /--ncm-control-height:\s*32px;/);
  assert.match(css, /input:not\(\[type="checkbox"\]\)[^}]*height:\s*var\(--ncm-control-height\)/s);
  assert.match(css, /select[^}]*height:\s*var\(--ncm-control-height\)/s);
  assert.match(css, /\.window-content button[^}]*height:\s*var\(--ncm-control-height\)/s);
});

test('activity compound headings and lists stay together on a full-width row', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const css = await text('styles/workbench.css');
  assert.ok(template.includes('{{#unless isLeaf}}<div class="ncm-workbench__compound-group">{{/unless}}'));
  assert.match(css, /\.ncm-workbench__compound-group[^}]*grid-column:\s*1\s*\/\s*-1/);
});

test('COMPAT-002 Workbench localizes Item type labels with NCM fallbacks', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes('ITEM_TYPE_FALLBACK_LABELS'));
  assert.ok(app.includes("facility: '시설'"));
  assert.ok(app.includes("backpack: '배낭'"));
  assert.ok(app.includes('function itemTypeLabel(type)'));
  assert.ok(app.includes('if (ITEM_TYPE_FALLBACK_LABELS[type]) return ITEM_TYPE_FALLBACK_LABELS[type]'));
  assert.ok(app.includes('typeLabel: itemTypeLabel(worldItem.type)'));
  assert.ok(app.includes('label: itemTypeLabel(type)'));
  assert.ok(template.includes('{{selected.typeLabel}}'));
  assert.ok(template.includes('<small>{{typeLabel}}</small>'));
});

test('Workbench nested sections expose icons, global controls, and reset on Item changes', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  for (const key of ['basic.identity','basic.source','basic.description','inventory.stock','inventory.physical','inventory.economy','inventory.container','activities.create','activities.list','damage.base','damage.extra','uses.pool','uses.recovery','on-hit.linked','on-hit.available','on-hit.create','passive.list','passive.create']) {
    assert.ok(template.includes(`data-section-key=\"${key}\"`), key);
  }
  assert.ok(template.includes('data-action=\"expandAllSections\"'));
  assert.ok(template.includes('data-action=\"collapseAllSections\"'));
  assert.ok(app.includes('ncm-workbench__toggle-icon'));
  assert.ok(app.includes('fa-chevron-right'));
  assert.ok(app.includes('fa-chevron-down'));
  assert.ok(app.includes('this.sectionOpenState.clear()'));
  assert.ok(app.includes('typeFieldGroups'));
  assert.ok(app.includes('activityCommonFieldGroups'));
  assert.ok(app.includes('activitySpecificFieldGroups'));
});

test('Workbench editor cards are collapsible and preserve open state across rerenders', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  const css = await text('styles/workbench.css');
  assert.equal((template.match(/<section class=\"ncm-workbench__card/g) ?? []).length, 0);
  assert.ok((template.match(/<details class=\"ncm-workbench__card/g) ?? []).length >= 14);
  for (const key of ['basic','activities.workspace','type','properties','equip','inventory','identification','activities.external.source','damage','uses','on-hit','passive']) {
    assert.ok(template.includes(`data-section-key=\"${key}\"`), key);
  }
  assert.ok(app.includes('sectionOpenState = new Map()'));
  assert.ok(app.includes("details[data-section-key]"));
  assert.ok(app.includes("addEventListener('toggle'"));
  assert.ok(css.includes('.ncm-workbench__collapsible > summary'));
});

test('ADV-001/002 Workbench exposes Advancement CRUD and schema-driven fields', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("from './advancement-adapter.mjs'"));
  for (const token of ['selectedAdvancementId','advancementTypeOptions','advancementFieldGroups','createAdvancement','duplicateAdvancement','deleteAdvancement','openAdvancementAdvanced']) assert.ok(app.includes(token), token);
  assert.ok(template.includes('data-section-key=\"advancement\"'));
  assert.ok(template.includes('data-action=\"createAdvancement\"'));
  assert.ok(template.includes('data-action=\"selectAdvancement\"'));
  assert.ok(template.includes('data-action=\"duplicateAdvancement\"'));
  assert.ok(template.includes('data-action=\"deleteAdvancement\"'));
  assert.ok(template.includes('data-action=\"openAdvancementAdvanced\"'));
  assert.ok(template.includes('data-advancement-field'));
  assert.ok(template.includes('data-section-key=\"advancement.{{key}}\"'));
});

test('ACT-004 Workbench preserves unknown Activity discriminators and exposes advanced fallback', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes('CORE_ACTIVITY_TYPES'));
  assert.ok(app.includes('isExternalActivity'));
  assert.ok(app.includes('externalActivitySource'));
  assert.ok(app.includes('openActivityAdvanced: NihilItemWorkbench._openActivityAdvancedAction'));
  assert.ok(template.includes('{{#if selected.isExternalActivity}}'));
  assert.ok(template.includes('data-action=\"openActivityAdvanced\"'));
  assert.ok(template.includes('외부 액티비티'));
  assert.ok(template.includes('{{selected.externalActivitySource}}'));
});

test('ACT-003 Workbench renders and saves native discriminator-specific Activity fields', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes('readActivitySpecificFields'));
  assert.ok(app.includes('nativeActivityClass'));
  assert.ok(app.includes('activityFieldEditsFromForm('));
  assert.ok(template.includes('{{#each groups}}'));
  assert.ok(template.includes('data-activity-specific-field'));
  assert.ok(template.includes('data-activity-specific-path="{{path}}"'));
});

test('ACT-006 blank Activity Composer does not inherit advanced fields from the prior selection', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("const isCreatingActivityWorkspace = this.activityWorkspaceMode === 'create';"));
  assert.ok(app.includes('const activityAdvancedFields = isExternalActivity || isCreatingActivityWorkspace'));
  assert.ok(app.includes('const activityWorkspaceTypeFields = isExternalActivity || isCreatingActivityWorkspace'));
});

test('ACT-002 Workbench renders and saves schema-driven common Activity fields', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("from './activity-field-adapter.mjs'"));
  assert.match(app, /readActivityCommonFields\(\s*selectedActivityDocument,/);
  assert.ok(app.includes('activityFieldEditsFromForm('));
  assert.ok(template.includes('{{#if selected.hasActivityCommonFields}}'));
  assert.ok(template.includes('data-activity-common-field'));
  assert.ok(template.includes('data-activity-path="{{path}}"'));
});

test('Activity creation preserves the editor scroll position across rerender', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("querySelector?.('.ncm-workbench__scroll')?.scrollTop"));
  assert.ok(app.includes('scroll.scrollTop = scrollTop'));
});

test('Workbench rerender restores the current editor scroll position', async () => {
  const moduleUrl = new URL('../scripts/workbench/workbench-app.mjs', import.meta.url);
  moduleUrl.searchParams.set('scroll-preservation-test', `${Date.now()}-${Math.random()}`);
  const { renderWorkbenchPreservingScroll } = await import(moduleUrl.href);
  const beforeRenderScroll = { scrollTop: 12352 };
  const afterRenderScroll = { scrollTop: 0 };
  const workbench = {
    element: {
      querySelector(selector) {
        assert.equal(selector, '.ncm-workbench__scroll');
        return beforeRenderScroll;
      },
    },
    async render(options) {
      assert.deepEqual(options, { force: true });
      this.element = {
        querySelector() {
          return afterRenderScroll;
        },
      };
    },
  };

  await renderWorkbenchPreservingScroll(workbench);

  assert.equal(afterRenderScroll.scrollTop, 12352);
});

test('UI-012 skips the selected Item hook refresh while an Activity Workspace save owns the render', async () => {
  const moduleUrl = new URL('../scripts/workbench/workbench-app.mjs', import.meta.url);
  moduleUrl.searchParams.set('workspace-save-refresh-test', `${Date.now()}-${Math.random()}`);
  const { shouldRefreshAfterItemUpdate } = await import(moduleUrl.href);

  assert.equal(
    shouldRefreshAfterItemUpdate(
      { selectedItemId: 'item-1', isSavingActivityWorkspace: true },
      { id: 'item-1' },
    ),
    false,
  );
  assert.equal(
    shouldRefreshAfterItemUpdate(
      { selectedItemId: 'item-1', isSavingActivityWorkspace: false },
      { id: 'item-1' },
    ),
    true,
  );
  assert.equal(
    shouldRefreshAfterItemUpdate(
      { selectedItemId: 'item-1', isSavingActivityWorkspace: true },
      { id: 'item-2' },
    ),
    true,
  );
});

test('Workbench user-facing chrome is Korean except approved technical identifiers', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  const forbidden = [
    'Type Fields', 'Properties</span>', 'Activity 목록', 'Activity 생성', 'Activity가 없습니다', '선택 Activity',
    '외부 Activity', 'Common Fields', 'Discriminator Fields', '>Advancement<', 'Advancement 생성', 'Advancement 목록',
    '선택 Advancement', 'On-Hit Effects', 'Passive Effects', 'Transfer 지속 효과', 'Item을 선택하십시오',
    'WORLD ITEMS', 'Item Browser', '이 Item 타입', 'Activity 타입 변경',
  ];
  for (const token of forbidden) assert.ok(!template.includes(token), token);
  for (const token of ["label: 'Custom'", "label: 'Multiply'", "label: 'Add'", "label: 'Downgrade'", "label: 'Upgrade'", "label: 'Override'"]) {
    assert.ok(!app.includes(token), token);
  }
  for (const required of ['아이템 편집기', '아이템 탐색기', '액티비티 작업 영역', '성장', '명중 시 효과', '지속 효과']) {
    assert.ok(template.includes(required), required);
  }
});

test('section-level guides replace per-control question icons and generated button tooltips', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  const css = await text('styles/workbench.css');
  assert.ok(app.includes('const SECTION_GUIDES = Object.freeze({'));
  assert.ok(app.includes('sectionGuideOpenState = new Map()'));
  assert.ok(app.includes('_attachSectionGuides()'));
  assert.ok(app.includes("querySelectorAll?.('details[data-section-key]')"));
  assert.ok(app.includes('guideForSection(key)'));
  assert.ok(app.includes('ncm-workbench__section-guide'));
  assert.ok(app.includes("details.insertBefore(guide, summary.nextSibling)"));
  assert.ok(!app.includes('_makeGuideIcon('));
  assert.ok(!app.includes('guideForControl('));
  assert.ok(!app.includes("button.setAttribute('title', guideForButton(button))"));
  assert.ok(css.includes('.ncm-workbench__section-guide'));
  assert.ok(!css.includes('.ncm-workbench__guide-icon'));
});

test('ACT-006 keeps quick-add as a Korean shortcut below the Activity workspace', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const css = await text('styles/workbench.css');
  for (const textValue of ['입력 단축','효과 빠른 추가','추가 피해','회복 효과','내성 공격','상태 효과','사용 가이드','액티비티 작업 영역','유형별 설정']) {
    assert.ok(template.includes(textValue), textValue);
  }
  assert.ok(template.includes('data-action="addQuickDamage"'));
  assert.ok(template.includes('data-action="createQuickActivity" data-purpose="heal"'));
  assert.ok(template.includes('data-action="createQuickActivity" data-purpose="save"'));
  assert.ok(template.includes('data-action="addQuickStatus"'));
  assert.ok(template.includes('name="quickSaveDc"'));
  assert.ok(template.includes('name="quickSaveOnSave"'));
  assert.ok(template.includes('{{typeLabel}}'));
  assert.ok(css.includes('.ncm-workbench__quick-grid'));
  assert.ok(css.includes('.ncm-workbench__guide'));
  assert.ok(css.includes('.ncm-workbench__advanced-note'));
});

test('advanced schema root groups use Korean labels while preserving internal paths', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  for (const pair of [
    ["activation: '발동'", 'activation'], ["range: '사거리'", 'range'], ["target: '대상 / 범위'", 'target'],
    ["damage: '피해'", 'damage'], ["save: '내성 굴림'", 'save'], ["healing: '회복'", 'healing'],
    ["consumption: '소모'", 'consumption'], ["duration: '지속시간'", 'duration'], ["effects: '효과'", 'effects'],
  ]) assert.ok(app.includes(pair[0]), pair[1]);
  assert.ok(app.includes('FIELD_GROUP_LABELS[key]'));
});

test('purpose-first Activity UI exposes Korean quick-add context and actions', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("from './purpose-activity-adapter.mjs'"));
  assert.ok(app.includes('createQuickActivity: NihilItemWorkbench._createQuickActivityAction'));
  assert.ok(app.includes('addQuickDamage: NihilItemWorkbench._addQuickDamageAction'));
  assert.ok(app.includes('addQuickStatus: NihilItemWorkbench._addQuickStatusAction'));
  assert.ok(app.includes('quickPurposeOptions: ACTIVITY_PURPOSES'));
  assert.ok(app.includes('quickHealingTypes'));
  assert.ok(app.includes('quickAbilityOptions'));
  assert.ok(app.includes('quickTargetTypes'));
  assert.ok(app.includes('quickAreaTypes'));
  assert.ok(app.includes('quickRangeTypes'));
  assert.ok(app.includes('quickOnSaveOptions'));
  assert.ok(app.includes('typeLabel: activityTypeLabel(activity.type)'));
  assert.ok(app.includes("buildQuickActivityData(purpose"));
  assert.ok(app.includes('appendQuickDamage(activity'));
});

test('ACT-001 Workbench exposes Activity create duplicate delete and reorder controls in the workspace', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("from './activity-adapter.mjs'"));
  assert.ok(app.includes('availableActivityTypes(item'));
  assert.ok(app.includes('newActivityWorkspace: NihilItemWorkbench._newActivityWorkspaceAction'));
  assert.ok(app.includes('saveActivityWorkspace: NihilItemWorkbench._saveActivityWorkspaceAction'));
  assert.ok(app.includes('duplicateActivity: NihilItemWorkbench._duplicateActivityAction'));
  assert.ok(app.includes('deleteActivity: NihilItemWorkbench._deleteActivityAction'));
  assert.ok(app.includes('moveActivity: NihilItemWorkbench._moveActivityAction'));
  assert.ok(template.includes('name=\"activityWorkspaceNewType\"'));
  assert.ok(template.includes('name=\"activityWorkspaceName\"'));
  assert.ok(template.includes('data-action=\"newActivityWorkspace\"'));
  assert.ok(template.includes('data-action=\"saveActivityWorkspace\"'));
  assert.ok(template.includes('data-action=\"duplicateActivity\"'));
  assert.ok(template.includes('data-action=\"deleteActivity\"'));
  assert.ok(template.includes('data-action=\"moveActivity\"'));
});

test('ACT-006 Workbench exposes one native Activity Composer before quick-add shortcuts', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  const template = await text('templates/workbench/item-workbench.hbs');

  for (const required of [
    'activity-workspace-adapter.mjs',
    'activityWorkspaceMode',
    'activityWorkspaceDraft',
    'newActivityWorkspace:',
    'saveActivityWorkspace:',
    'cancelActivityWorkspace:',
    'addActivityWorkspaceDamage:',
    'removeActivityWorkspaceDamage:',
    'readActivityWorkspace',
    'buildActivityWorkspaceCreateData',
    'buildActivityWorkspaceUpdate',
    'activityWorkspace: activityWorkspaceContext',
  ]) assert.ok(app.includes(required), `missing Composer app contract: ${required}`);

  for (const required of [
    'data-section-key="activities.workspace"',
    '액티비티 작업 영역',
    'data-action="newActivityWorkspace"',
    'data-action="saveActivityWorkspace"',
    'data-action="cancelActivityWorkspace"',
    'data-action="addActivityWorkspaceDamage"',
    'data-action="removeActivityWorkspaceDamage"',
    '입력 단축',
  ]) assert.ok(template.includes(required), `missing Composer template contract: ${required}`);

  assert.ok(
    template.indexOf('data-section-key="basic"')
      < template.indexOf('data-section-key="activities.workspace"'),
    'Composer must follow Item basic information',
  );
  assert.ok(
    template.indexOf('data-section-key="activities.workspace"')
      < template.indexOf('data-section-key="quick-effects"'),
    'Composer must precede quick-add shortcuts',
  );
});

test('ACT-006 Composer only offers native Activity discriminators', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');

  assert.ok(app.includes('.filter((option) => CORE_ACTIVITY_TYPES.has(option.value))'));
  assert.ok(app.includes('CONFIG?.DND5E?.activityActivationTypes'));
  assert.ok(app.includes("action: '행동'"));
});

test('TYPE engine renders schema-driven type fields and submits dotted updates', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("from './type-field-adapter.mjs'"));
  assert.ok(app.includes('readTypeFields(item)'));
  assert.ok(app.includes('buildTypeFieldUpdate(typeFieldEdits)'));
  assert.ok(template.includes('{{#if selected.hasTypeFields}}'));
  assert.ok(template.includes('data-type-field'));
  assert.ok(template.includes('data-type-path="{{path}}"'));
});

test('CORE-006 Workbench exposes full multiple Uses recovery editing', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(template.includes('{{#if selected.hasUses}}'));
  assert.ok(template.includes('name=\"usesMax\"'));
  assert.ok(template.includes('type=\"text\" name=\"usesMax\"'));
  assert.ok(template.includes('data-action=\"addRecovery\"'));
  assert.ok(template.includes('data-action=\"removeRecovery\"'));
  assert.ok(template.includes('data-recovery-period'));
  assert.ok(template.includes('data-recovery-type'));
  assert.ok(template.includes('data-recovery-formula'));
  assert.ok(template.includes('{{#if selected.uses.hasAutoDestroy}}'));
  assert.ok(template.includes('name=\"usesAutoDestroy\"'));
  assert.ok(app.includes('limitedUsePeriods?.recoveryOptions'));
  assert.ok(app.includes("value: 'recoverAll'"));
  assert.ok(app.includes("value: 'loseAll'"));
  assert.ok(app.includes("value: 'formula'"));
});

test('CORE-005 Workbench builds property checkboxes from valid plus existing properties', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(template.includes('{{#if selected.hasProperties}}'));
  assert.ok(template.includes('name=\"properties\"'));
  assert.ok(template.includes('{{#each selected.propertyOptions}}'));
  assert.ok(app.includes('model.validProperties'));
  assert.ok(app.includes('model.properties'));
  assert.ok(app.includes('CONFIG?.DND5E?.itemProperties'));
});

test('CORE-004 Workbench exposes conditional equipped and attunement controls', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(template.includes('{{#if selected.hasEquipAttunement}}'));
  for (const name of ['equipped', 'attunement', 'attuned']) assert.ok(template.includes(`name=\"${name}\"`));
  assert.ok(app.includes('CONFIG?.DND5E?.attunementTypes'));
});

test('CORE-003 Workbench exposes conditional inventory/economy controls and option sources', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(template.includes('{{#if selected.hasInventory}}'));
  for (const name of ['quantity', 'weightValue', 'weightUnits', 'priceValue', 'priceDenomination', 'rarity', 'containerId']) {
    assert.ok(template.includes(`name=\"${name}\"`), `missing ${name}`);
  }
  assert.ok(app.includes('CONFIG?.DND5E?.weightUnits'));
  assert.ok(app.includes('CONFIG?.DND5E?.currencies'));
  assert.ok(app.includes('CONFIG?.DND5E?.itemRarity'));
  assert.match(app, /containerDestinationOptions\(\s*item,\s*worldItems,/);
});

test('CORE-002 Workbench exposes conditional identification controls', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  assert.ok(template.includes('{{#if selected.hasIdentification}}'));
  assert.ok(template.includes('name=\"identified\"'));
  assert.ok(template.includes('name=\"unidentifiedName\"'));
  assert.ok(template.includes('name=\"unidentifiedDescription\"'));
});

test('CORE-001 Workbench exposes identifier and all native source controls', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  for (const name of ['identifier', 'sourceBook', 'sourcePage', 'sourceCustom', 'sourceLicense', 'sourceRules', 'sourceRevision']) {
    assert.ok(template.includes(`name=\"${name}\"`), `missing ${name}`);
  }
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(app.includes("{ value: '2024', label: '2024 규칙'"));
  assert.ok(app.includes("{ value: '2014', label: '2014 레거시'"));
});

test('Workbench empty state spans the entire editor grid and centers its content', async () => {
  const css = await text('styles/workbench.css');
  assert.match(css, /\.ncm-workbench__empty\s*\{[^}]*grid-row:\s*1\s*\/\s*-1;/s);
  assert.match(css, /\.ncm-workbench__empty\s*\{[^}]*place-content:\s*center;/s);
  assert.match(css, /\.ncm-workbench__empty\s*\{[^}]*text-align:\s*center;/s);
});

test('Workbench stylesheet defines the independent two-column layout', async () => {
  const css = await text('styles/workbench.css');
  assert.match(css, /\.ncm-workbench__split\s*\{[^}]*container:\s*ncm-workbench\s*\/\s*inline-size/);
  assert.match(css, /@container ncm-workbench \(width <= 760px\)/);
  assert.match(css, /data-workbench-pane="list"[^\n]*data-workbench-panel="form"/);
  assert.match(css, /grid-template-columns/);
  assert.match(css, /\.ncm-workbench__editor/);
  assert.match(css, /\.ncm-workbench__browser/);
});

test('module entry registers Workbench API and Item Directory context hook', async () => {
  const modulePackage = { api: {} };
  const hookCalls = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;

  globalThis.game = { modules: new Map([['nihil-compendium-module', modulePackage]]) };
  globalThis.Hooks = {
    once(name, fn) { hookCalls.push({ kind: 'once', name, fn }); },
    on(name, fn) { hookCalls.push({ kind: 'on', name, fn }); },
  };

  try {
    const url = new URL('../scripts/module.mjs', import.meta.url);
    url.searchParams.set('workbench-test', `${Date.now()}-${Math.random()}`);
    await import(url.href);
    assert.equal(typeof modulePackage.api.openWorkbench, 'function');
    assert.ok(hookCalls.some(call => call.kind === 'on' && call.name === 'getItemDirectoryEntryContext'));
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});

test('module entry registers Actor Workbench launchers, context, and document synchronization', async () => {
  const source = await text('scripts/module.mjs');
  for (const required of [
    "from './workbench/actor-workbench-app.mjs'",
    'openActorWorkbench',
    'refreshActorWorkbench',
    'syncUpdatedActor',
    'syncDeletedActor',
    'renderActorDirectory',
    'getActorDirectoryEntryContext',
    "Hooks.on('createActor'",
    "Hooks.on('updateActor'",
    "Hooks.on('deleteActor'",
  ]) assert.ok(source.includes(required), required);
});

test('Actor Directory Workbench context entry is hidden from non-privileged Actor owners', async () => {
  const modulePackage = { api: {} };
  const hookCalls = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const actor = { id: 'PC-1', type: 'character', isOwner: true };

  globalThis.game = {
    modules: new Map([['nihil-compendium-module', modulePackage]]),
    actors: { get(id) { return id === actor.id ? actor : null; } },
    user: { id: 'ordinary-player', isGM: false },
  };
  globalThis.Hooks = {
    once(name, fn) { hookCalls.push({ kind: 'once', name, fn }); },
    on(name, fn) { hookCalls.push({ kind: 'on', name, fn }); },
  };

  try {
    const url = new URL('../scripts/module.mjs', import.meta.url);
    url.searchParams.set('actor-context-permission-test', `${Date.now()}-${Math.random()}`);
    await import(url.href);
    const hook = hookCalls.find(call => call.kind === 'on' && call.name === 'getActorDirectoryEntryContext');
    const options = [];
    hook.fn(null, options);
    assert.equal(options[0].visible({ dataset: { entryId: actor.id } }), false);
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});

test('Item Directory context entry resolves Foundry V13 data-entry-id', async () => {
  const modulePackage = { api: {} };
  const hookCalls = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const item = { isOwner: true };

  globalThis.game = {
    modules: new Map([['nihil-compendium-module', modulePackage]]),
    items: { get(id) { return id === 'ITEM-V13' ? item : null; } },
    user: { isGM: true },
  };
  globalThis.Hooks = {
    once(name, fn) { hookCalls.push({ kind: 'once', name, fn }); },
    on(name, fn) { hookCalls.push({ kind: 'on', name, fn }); },
  };

  try {
    const url = new URL('../scripts/module.mjs', import.meta.url);
    url.searchParams.set('entry-id-test', `${Date.now()}-${Math.random()}`);
    await import(url.href);
    const hook = hookCalls.find(call => call.kind === 'on' && call.name === 'getItemDirectoryEntryContext');
    assert.ok(hook);
    const options = [];
    hook.fn(null, options);
    const workbench = options.find(option => option.label === 'Nihil Workbench에서 편집');
    assert.ok(workbench);
    const entry = { dataset: { entryId: 'ITEM-V13' } };
    assert.equal(workbench.visible(entry), true);
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});

test('Foundry V13 Item Directory class is patched before sidebar context menu creation', async () => {
  const modulePackage = { api: {} };
  const hookCalls = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const previousConfig = globalThis.CONFIG;

  class ItemDirectory5eMock {
    _getEntryContextOptions() { return [{ name: 'BASE' }]; }
  }

  globalThis.game = {
    modules: new Map([['nihil-compendium-module', modulePackage]]),
    items: { get(id) { return id === 'ITEM-V13' ? { isOwner: true } : null; } },
    user: { isGM: true },
  };
  globalThis.CONFIG = { ui: { items: ItemDirectory5eMock } };
  globalThis.Hooks = {
    once(name, fn) { hookCalls.push({ kind: 'once', name, fn }); },
    on(name, fn) { hookCalls.push({ kind: 'on', name, fn }); },
  };

  try {
    const url = new URL('../scripts/module.mjs', import.meta.url);
    url.searchParams.set('v13-class-test', `${Date.now()}-${Math.random()}`);
    await import(url.href);
    const directory = new ItemDirectory5eMock();
    const options = directory._getEntryContextOptions();
    const workbench = options.find(option => option.label === 'Nihil Workbench에서 편집');
    assert.ok(workbench, 'class prototype must include Workbench before sidebar construction');
    assert.equal(options[0].name, 'BASE');
    assert.equal(workbench.visible({ dataset: { entryId: 'ITEM-V13' } }), true);
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
    globalThis.CONFIG = previousConfig;
  }
});

test('Foundry V13 Item Directory options are patched on ready', async () => {
  const modulePackage = { api: {} };
  const hookCalls = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const previousUi = globalThis.ui;
  const item = { isOwner: true };
  const directory = {
    _getEntryContextOptions() { return [{ name: 'BASE' }]; },
  };

  globalThis.game = {
    modules: new Map([['nihil-compendium-module', modulePackage]]),
    items: { get(id) { return id === 'ITEM-V13' ? item : null; } },
    user: { isGM: true },
  };
  globalThis.ui = { items: directory };
  globalThis.Hooks = {
    once(name, fn) { hookCalls.push({ kind: 'once', name, fn }); },
    on(name, fn) { hookCalls.push({ kind: 'on', name, fn }); },
  };

  try {
    const url = new URL('../scripts/module.mjs', import.meta.url);
    url.searchParams.set('v13-directory-test', `${Date.now()}-${Math.random()}`);
    await import(url.href);
    const ready = hookCalls.find(call => call.kind === 'once' && call.name === 'ready');
    assert.ok(ready, 'ready hook must patch the live Item Directory instance');
    ready.fn();
    const options = directory._getEntryContextOptions();
    const workbench = options.find(option => option.label === 'Nihil Workbench에서 편집');
    assert.ok(workbench);
    assert.equal(options[0].name, 'BASE');
    assert.equal(workbench.visible({ dataset: { entryId: 'ITEM-V13' } }), true);
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
    globalThis.ui = previousUi;
  }
});

test('Workbench can open with no selected Item and only privileged users see management controls', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  const template = await text('templates/workbench/item-workbench.hbs');
  assert.ok(source.includes('rDepyiOStMqbIYMg'));
  assert.ok(source.includes('rXB1GcSui4mDsgAn'));
  assert.ok(source.includes('selectItem(null)'));
  assert.ok(!source.includes('if (!this.selectedItemId && worldItems.length) this.selectedItemId = worldItems[0].id'));
  assert.ok(template.includes('data-action="createItem"'));
  assert.ok(template.includes('data-action="duplicateItem"'));
  assert.ok(template.includes('{{#if canManageItems}}'));
  assert.ok(template.includes('{{#unless selected}}disabled{{/unless}}'));
});

test('Workbench folder create action uses the current Item Folder as parent and enters the created folder', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  const template = await text('templates/workbench/item-workbench.hbs');
  assert.ok(source.includes('createFolder: NihilItemWorkbench._createFolderAction'));
  assert.ok(source.includes("type: 'Item'"));
  assert.ok(source.includes('folder: this.currentFolderId'));
  assert.ok(source.includes('createFolderInWorkbench({'));
  assert.ok(source.includes('this.setCurrentFolder(created.id)'));
  assert.ok(template.includes('data-action="createFolder"'));
  assert.ok(template.includes('폴더 생성'));
});

test('CORE-007 Workbench Item creation defaults to the currently browsed Folder', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(source.includes('createItemInWorkbench({'));
  assert.ok(source.includes('folder: this.currentFolderId'));
  assert.ok(source.includes('this.selectItem(created.id)'));
});

test('Workbench duplicate action clones the selected Item and auto-selects the clone', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(source.includes('duplicateItem: NihilItemWorkbench._duplicateItemAction'));
  assert.ok(source.includes('selectedItem.clone('));
  assert.ok(source.includes('{ save: true }'));
  assert.ok(source.includes('this.selectItem(clone.id)'));
});

test('Item Browser navigates folders by current Folder id instead of rendering a hierarchy tree', async () => {
  const source = await text('scripts/workbench/workbench-app.mjs');
  const template = await text('templates/workbench/item-workbench.hbs');
  assert.ok(source.includes('currentFolderId = null'));
  assert.ok(source.includes('openFolder: NihilItemWorkbench._openFolderAction'));
  assert.ok(source.includes('goParentFolder: NihilItemWorkbench._goParentFolderAction'));
  assert.ok(source.includes('goBreadcrumb: NihilItemWorkbench._goBreadcrumbAction'));
  assert.ok(source.includes('folder?.folder?.id'));
  assert.ok(source.includes('worldItem.folder?.id'));
  assert.ok(template.includes('ncm-workbench__path'));
  assert.ok(template.includes('data-action="goParentFolder"'));
  assert.ok(template.includes('data-action="openFolder"'));
  assert.ok(template.includes('data-action="goBreadcrumb"'));
  assert.ok(template.includes('data-browser-folder'));
  assert.ok(!template.includes('ncm-workbench__folder-tree'));
});

test('SYNC-003 registers Item create/update/delete hooks and follows an externally moved selected Item', async () => {
  const moduleSource = await text('scripts/module.mjs');
  const workbenchSource = await text('scripts/workbench/workbench-app.mjs');
  assert.match(moduleSource, /Hooks\.on\(\s*'createItem'/);
  assert.match(moduleSource, /Hooks\.on\(\s*'updateItem'/);
  assert.match(moduleSource, /Hooks\.on\(\s*'deleteItem'/);
  assert.ok(workbenchSource.includes('export function syncUpdatedItem'));
  assert.ok(workbenchSource.includes('workbenchInstance.selectedItemId === item?.id'));
  assert.ok(workbenchSource.includes('workbenchInstance.currentFolderId = item?.folder?.id ?? null'));
});

test('SYNC-002 registers Folder update/delete hooks and returns deleted current Folder to its parent', async () => {
  const moduleSource = await text('scripts/module.mjs');
  const workbenchSource = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(moduleSource.includes("Hooks.on('updateFolder'"));
  assert.ok(moduleSource.includes("Hooks.on('preDeleteFolder'"));
  assert.ok(moduleSource.includes("Hooks.on('deleteFolder'"));
  assert.ok(moduleSource.includes('deletedFolderParents'));
  assert.ok(workbenchSource.includes('export function syncDeletedFolder'));
  assert.ok(workbenchSource.includes('workbenchInstance.currentFolderId === folderId'));
  assert.ok(workbenchSource.includes('workbenchInstance.setCurrentFolder(parentFolderId)'));
});

test('SYNC-001 registers a Folder create hook that refreshes an open Workbench', async () => {
  const moduleSource = await text('scripts/module.mjs');
  const workbenchSource = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(moduleSource.includes("Hooks.on('createFolder'"));
  assert.ok(moduleSource.includes('refreshWorkbench'));
  assert.ok(workbenchSource.includes('export function refreshWorkbench'));
});

test('UI-001 Workbench launcher relies on native Item Directory button sizing', async () => {
  const moduleSource = await text('scripts/module.mjs');
  const css = await text('styles/workbench.css');
  assert.ok(!moduleSource.includes('referenceRect'));
  assert.ok(!moduleSource.includes('button.style.width'));
  assert.ok(!moduleSource.includes('button.style.height'));
  assert.ok(moduleSource.includes("footer.querySelector('button')"));
  assert.ok(moduleSource.includes("referenceButton?.className"));
  assert.ok(!css.includes('.ncm-open-workbench { width: 97%; }'));
});

test('Item Directory footer gets a privileged Workbench launcher', async () => {
  const source = await text('scripts/module.mjs');
  assert.ok(source.includes('renderItemDirectory'));
  assert.ok(source.includes('ncm-open-workbench'));
  assert.ok(source.includes('rDepyiOStMqbIYMg'));
  assert.ok(source.includes('rXB1GcSui4mDsgAn'));
  assert.ok(source.includes('openWorkbench()'));
});

test('base damage types use independent pressed buttons with official D&D5e icons', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  assert.match(template, /data-base-damage-types/);
  assert.match(template, /data-base-damage-type[^>]*aria-pressed=/);
  assert.doesNotMatch(template, /type="checkbox"[^>]*name="baseDamageTypes"/);
  assert.match(template, /<dnd5e-icon src="{{icon}}"/);
});


test('each damage type grid uses an explicit button action instead of native checkboxes', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const source = await text('scripts/workbench/workbench-app.mjs');
  for (const selector of [
    'data-activity-workspace-damage-type',
    'data-base-damage-type',
    'data-extra-damage-type',
  ]) {
    assert.ok(template.includes(selector), selector);
  }
  assert.equal((template.match(/data-action="toggleDamageType"/g) ?? []).length, 3);
  assert.match(source, /toggleDamageType: NihilItemWorkbench\._toggleDamageTypeAction/);
  assert.match(source, /types:\s*\[\.\.\.part\.types\]/);
  assert.match(source, /\[aria-pressed="true"\]/);
});

test('Item Browser folder rows use the same 52px height as Item rows', async () => {
  const css = await text('styles/workbench.css');
  assert.match(css, /\.ncm-workbench__folder-row\s*\{[^}]*height:\s*auto\s*!important;/s);
  assert.match(css, /\.ncm-workbench__folder-row\s*\{[^}]*min-height:\s*52px;/s);
});

test('Item Browser rows are tall enough for icon, name, and metadata without overflow', async () => {
  const css = await text('styles/workbench.css');
  assert.match(css, /\.ncm-workbench__item-row\s*\{[^}]*height:\s*auto\s*!important;/s);
  assert.match(css, /\.ncm-workbench__item-row\s*\{[^}]*min-height:\s*52px;/s);
  assert.match(css, /\.ncm-workbench__item-row\s*\{[^}]*box-sizing:\s*border-box;/s);
});

test('damage type option keeps check icon, damage icon, and text aligned', async () => {
  const css = await text('styles/workbench.css');
  assert.match(css, /\.ncm-workbench__damage-type-option\s*\{[^}]*grid-template-columns:\s*16px 18px minmax\(0, 1fr\);/s);
  assert.match(css, /\.ncm-workbench__check-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s);
  assert.match(css, /\.ncm-workbench__damage-type-label\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*min-height:\s*18px;[^}]*line-height:\s*1\.25;[^}]*overflow-wrap:\s*anywhere;/s);
});

test('Activity Composer damage types use three readable columns without changing standard grids', async () => {
  const css = await text('styles/workbench.css');
  const labelRule = css.match(/\.ncm-workbench__damage-type-label\s*\{[^}]*\}/s)?.[0] ?? '';
  const mobileRules = css.split('@container ncm-workbench (width <= 760px)')[1] ?? '';
  assert.match(css, /\.ncm-workbench__damage-type-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\[data-activity-workspace-damage-row\]\s+\.ncm-workbench__damage-type-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.doesNotMatch(labelRule, /overflow: hidden|text-overflow: ellipsis|white-space: nowrap/);
  assert.match(mobileRules, /\.ncm-workbench__damage-type-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\[data-activity-workspace-damage-row\]\s+\.ncm-workbench__damage-type-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
});


test('damage type buttons use icon-based pressed visuals without native checkbox chrome', async () => {
  const template = await text('templates/workbench/item-workbench.hbs');
  const css = await text('styles/workbench.css');
  assert.match(template, /class="ncm-workbench__check-icon"/);
  assert.match(template, /ncm-workbench__check-icon--off/);
  assert.match(template, /ncm-workbench__check-icon--on/);
  assert.match(template, /data-lucide-icon="square"/);
  assert.match(template, /data-lucide-icon="square-check-big"/);
  assert.doesNotMatch(template, /ncm-workbench__damage-type-input/);
  assert.match(css, /\.ncm-workbench__damage-type-option\[aria-pressed="true"\]/);
  assert.match(css, /\.ncm-workbench__damage-type-option\[aria-pressed="true"\]\s+\.ncm-workbench__check-icon--off[^}]*display:\s*none;/s);
  assert.match(css, /\.ncm-workbench__damage-type-option\[aria-pressed="true"\]\s+\.ncm-workbench__check-icon--on[^}]*display:\s*block;/s);
});

test('Workbench does not generate individual action button guide tooltips', async () => {
  const app = await text('scripts/workbench/workbench-app.mjs');
  assert.ok(!app.includes('function guideForButton('));
  assert.ok(!app.includes("button.setAttribute('title', guideForButton(button))"));
});
