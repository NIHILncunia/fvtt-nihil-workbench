import assert from 'node:assert/strict';
import test from 'node:test';
import { importLocalizedStatblock, resumeStatblockLocalization } from '../scripts/statblock-importer/service.mjs';

const rawPayload = '===STATBLOCK===\nTest Drake\n===LOCALIZATION===\n{"actorName":"시험 드레이크","items":{"Bite":{"name":"물기","description":"시험 공격"}}}';

test('SBI partially saved localization keeps the created NPC and retries without creating another', async () => {
  const previousGame = globalThis.game;
  let imports = 0, itemAttempts = 0;
  const item = { id: 'bite', name: 'Bite', system: { description: { value: '' } } };
  const actor = {
    id: 'npc', type: 'npc', isOwner: true, name: 'Test Drake', folder: null, items: [item],
    async update(patch) { this.name = patch.name ?? this.name; return this; },
    async updateEmbeddedDocuments(type, updates) {
      itemAttempts++;
      if (itemAttempts === 1) return [];
      for (const update of updates) { item.name = update.name; item.system.description.value = update['system.description.value']; }
      return [item];
    },
  };
  const sbi = { api: { parse: () => ({ actor: {} }), import: async () => { imports++; return { actor5e: actor, importIssues: ['시험 경고'] }; } } };
  globalThis.game = { actors: new Map([['npc', actor]]) };
  try {
    let failure;
    await assert.rejects(importLocalizedStatblock({ rawPayload }, sbi), error => { failure = error; return /일부 저장/.test(error.message); });
    assert.equal(failure.actor5e, actor);
    assert.equal(failure.recovery.actorId, 'npc');
    assert.equal(actor.name, '시험 드레이크');
    assert.equal(item.name, 'Bite');
    const result = await resumeStatblockLocalization(failure.recovery);
    assert.equal(result.actor5e, actor);
    assert.equal(item.name, '물기');
    assert.equal(imports, 1);
    assert.deepEqual(result.importIssues, ['시험 경고']);
    assert.deepEqual((await resumeStatblockLocalization(failure.recovery)).itemUpdates, []);
    actor.isOwner = false;
    await assert.rejects(resumeStatblockLocalization(failure.recovery), /권한/);
    globalThis.game.actors.clear();
    await assert.rejects(resumeStatblockLocalization(failure.recovery), /찾을 수/);
  } finally { globalThis.game = previousGame; }
});

test('SBI cancelled actor localization reports recovery instead of success', async () => {
  const actor = { id: 'npc', name: 'Test Drake', folder: null, items: [], update: async () => undefined };
  const sbi = { api: { parse: () => ({ actor: {} }), import: async () => ({ actor5e: actor }) } };
  await assert.rejects(importLocalizedStatblock({ rawPayload }, sbi), error => /취소/.test(error.message) && error.actor5e === actor && error.recovery.actorId === actor.id);
});
