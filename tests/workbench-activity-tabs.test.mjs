import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { activityFieldTab, buildActivityTabs } from '../scripts/workbench/activity-tabs.mjs';

test('Activity fields appear exactly once in their related tab, retaining all editing descriptors', () => {
  const common = [
    'img', 'description.chatFlavor', 'visibility.level.min', 'activation.override',
    'uses.recovery', 'duration.units', 'consumption.targets', 'range.override',
    'target.template.width', 'effects', 'macroData.command', 'useConditionText', 'flags',
  ].map((path) => ({ path, isComplex: path === 'effects' }));
  const specific = [{ path: 'profiles', isComplex: true }, { path: 'settings', isComplex: true }];
  const tabs = buildActivityTabs(
    'transform',
    common,
    specific,
    'type',
  );
  assert.deepEqual(tabs.map((tab) => tab.label), ['기본 정보', '발동·소모', '대상·범위', '변신', '효과', '자동화']);
  assert.deepEqual(tabs.flatMap((tab) => tab.fields).map((field) => field.path).sort(), [...common, ...specific].map((field) => field.path).sort());
  assert.equal(tabs.filter((tab) => tab.active).length, 1);
  assert.equal(tabs.find((tab) => tab.active).id, 'type');
  assert.ok(tabs.find((tab) => tab.id === 'effects').fields[0].common);
  assert.ok(tabs.find((tab) => tab.id === 'type').fields.every((field) => !field.common && field.isComplex));
  assert.equal(activityFieldTab('consumption.scaling.allowed'), 'activation');
});

test('New Activity uses only relevant tabs; unavailable selection safely falls back', () => {
  assert.deepEqual(buildActivityTabs('utility').map((tab) => tab.id), ['identity', 'activation', 'targets']);
  for (const type of ['attack', 'damage', 'heal', 'save']) {
    const tabs = buildActivityTabs(type);
    assert.ok(tabs.some((tab) => tab.id === 'type'));
  }
  const tabs = buildActivityTabs(
    'summon',
    [],
    [{ path: 'profiles' }],
    'effects',
  );
  assert.equal(tabs.find((tab) => tab.active).id, 'identity');
  assert.equal(tabs.find((tab) => tab.id === 'type').label, '소환');
});

test('System-generated facility orders do not expose unsupported standard tabs', () => {
  const tabs = buildActivityTabs('order', [{ path: 'img' }], [{ path: 'order' }], 'activation');
  assert.deepEqual(tabs.map(tab => tab.id), ['identity', 'type']);
  assert.equal(tabs.find(tab => tab.active).id, 'identity');
});

test('Activity entry owns the editor; inactive tabs retain controls rather than disabling or removing them', async () => {
  const template = await readFile(new URL('../templates/workbench/item-workbench.hbs', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles/workbench.css', import.meta.url), 'utf8');
  assert.ok(template.includes('aria-expanded="{{expanded}}"'));
  assert.ok(template.includes('id="ncm-activity-entry-{{id}}" {{#unless expanded}}hidden{{/unless}}'));
  assert.ok(template.includes('{{#each selected.activityTabs}}'));
  assert.ok(template.includes('data-activity-panel="{{id}}" {{#unless active}}hidden{{/unless}}'));
  assert.ok(template.includes('{{> activityEditor @root}}'));
  assert.ok(template.includes('{{> activityField this}}'));
  assert.ok(css.includes('[data-activity-panel][hidden]'));
  assert.ok(!template.includes('활동 작업 영역'));
});
