import assert from 'node:assert/strict';
import test from 'node:test';
import { readActivityCommonFields, buildActivityFieldUpdate } from '../scripts/workbench/activity-field-adapter.mjs';
import { buildActivityTabs } from '../scripts/workbench/activity-tabs.mjs';
import { effectFields, validateEffectPatch } from '../scripts/workbench/effect-fields.mjs';
import { buildDocumentPatch } from '../scripts/workbench/document-fields.mjs';

class StringField { options = {}; }
class BooleanField { options = {}; }
class SchemaField { constructor(fields) { this.fields = fields; this.options = {}; } }

function fixture() {
  const source = { type: 'attack', useConditionText: 'true', effectConditionText: '', midiProperties: { confirmTargets: 'default', chooseEffects: false, magicDamage: false, triggeredActivityId: 'keep', custom: { keep: true } }, flags: { other: { keep: true } } };
  const activity = { type: 'attack', schema: { fields: { useConditionText: new StringField(), effectConditionText: new StringField(), midiProperties: new SchemaField({ confirmTargets: new StringField(), chooseEffects: new BooleanField(), magicDamage: new BooleanField(), triggeredActivityId: new StringField() }) } }, toObject: () => structuredClone(source) };
  return { source, activity };
}

test('Midi activity controls use installed v13 paths, Korean choices and the automation tab', () => {
  const { activity, source } = fixture();
  const fields = readActivityCommonFields(activity);
  assert.deepEqual(fields.map(field => field.path), ['useConditionText', 'effectConditionText', 'midiProperties.confirmTargets', 'midiProperties.chooseEffects', 'midiProperties.magicDamage']);
  const confirm = fields.find(field => field.path === 'midiProperties.confirmTargets');
  assert.equal(confirm.hasChoices, true);
  assert.deepEqual(confirm.options.map(option => option.value), ['default', 'always', 'never']);
  assert.match(confirm.label, /대상 확인/);
  assert.equal(buildActivityTabs('attack', fields).find(tab => tab.id === 'automation').fields.length, 5);
  const update = buildActivityFieldUpdate(fields.map(field => ({ ...field, value: field.path === confirm.path ? 'always' : field.path === 'midiProperties.chooseEffects' ? true : field.value })));
  assert.deepEqual(update, { 'midiProperties.confirmTargets': 'always', 'midiProperties.chooseEffects': true });
  assert.equal(source.midiProperties.triggeredActivityId, 'keep');
  assert.throws(() => buildActivityFieldUpdate([{ ...confirm, value: 'invalid' }]), /선택/);
  assert.deepEqual(source.flags, { other: { keep: true } });
  assert.deepEqual(buildActivityFieldUpdate(fields), {});
});

test('Midi settings are absent without schema and retain unknown existing enum until edited', () => {
  assert.deepEqual(readActivityCommonFields({ type: 'attack', schema: { fields: {} }, toObject: () => ({}) }), []);
  const { activity, source } = fixture();
  source.midiProperties.confirmTargets = 'future';
  const fields = readActivityCommonFields(activity);
  const field = fields.find(field => field.path === 'midiProperties.confirmTargets');
  assert.ok(field.options.some(option => option.value === 'future' && option.selected));
  assert.deepEqual(buildActivityFieldUpdate(fields), {});
});

test('DAE controls preserve all unedited flags, expose item conditions and reject invalid stacking', () => {
  const source = { name: '시험', changes: [], statuses: [], flags: { dae: { stackable: 'future', selfTarget: true, custom: { id: 'keep' } }, 'midi-qol': { onUseMacroName: 'keep' } } };
  const fields = effectFields(source, { dae: true, itemEffect: true });
  assert.ok(fields.find(field => field.path === 'flags.dae.stackable').options.some(option => option.value === 'future' && option.selected));
  assert.deepEqual(buildDocumentPatch(fields, Object.fromEntries(fields.map(field => [field.path, field.value])), source).patch, {});
  const { patch } = buildDocumentPatch(fields, { 'flags.dae.selfTarget': false, 'flags.dae.stackable': 'noneName', 'flags.dae.enableCondition': 'true', 'flags.dae.durationExpression': '1d4' }, source);
  assert.deepEqual(patch, { 'flags.dae.selfTarget': false, 'flags.dae.stackable': 'noneName', 'flags.dae.enableCondition': 'true', 'flags.dae.durationExpression': '1d4' });
  assert.doesNotThrow(() => validateEffectPatch(patch));
  assert.throws(() => validateEffectPatch({ 'flags.dae.stackable': 'invalid' }), /중첩/);
  assert.throws(() => validateEffectPatch({ 'flags.dae.selfTarget': 'false' }), /선택/);
  assert.deepEqual(source.flags.dae.custom, { id: 'keep' });
  assert.equal(source.flags['midi-qol'].onUseMacroName, 'keep');
  assert.ok(!effectFields({ ...source, transfer: true }, { dae: true, itemEffect: true }).some(field => field.path === 'flags.dae.selfTarget'));
  assert.ok(!effectFields({ flags: {} }).some(field => field.path.startsWith('flags.dae.')));
});
