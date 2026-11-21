import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityFieldUpdate } from '../scripts/workbench/activity-field-adapter.mjs';
import { buildTypeFieldUpdate } from '../scripts/workbench/type-field-adapter.mjs';
import { buildAdvancementFieldUpdate } from '../scripts/workbench/advancement-adapter.mjs';

for (const [name, build] of [['activity', buildActivityFieldUpdate], ['type', buildTypeFieldUpdate], ['advancement', buildAdvancementFieldUpdate]]) {
  test(`${name}: nested unsafe compound keys fail before update and existing data stays intact`, () => {
    const original = { module: { keep: [1, { name: '시험' }] } };
    for (const key of ['__proto__', 'prototype', 'constructor', 'nested.path', '-=field']) {
      const value = JSON.stringify({ module: { keep: [1, { [key]: 'changed' }] } });
      assert.throws(() => build([{ path: 'flags', kind: 'json', original, value }]), /키/);
    }
    assert.deepEqual(original, { module: { keep: [1, { name: '시험' }] } });
    assert.deepEqual(build([{ path: 'flags', kind: 'json', original, value: JSON.stringify(original) }]), {});
    const legacy = JSON.parse('{"module":{"legacy.key":"keep","safe":1}}');
    const patch = build([{ path: 'flags', kind: 'json', original: legacy, value: JSON.stringify({ module: { 'legacy.key': 'keep', safe: 2 } }) }]);
    assert.deepEqual(patch[name === 'type' ? 'system.flags' : 'flags'], { module: { 'legacy.key': 'keep', safe: 2 } });
  });
}
