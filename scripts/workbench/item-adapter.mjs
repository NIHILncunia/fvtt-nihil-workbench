import { validateContainerMove } from './container-adapter.mjs';
import { changeTypeOf, effectChangesOf, normalizeEffectChange } from '../shared/effect-change-types.mjs';

const MODULE_ID = 'nihil-compendium-module';

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
}

function setValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...value];
  if (typeof value.values === 'function') return Array.from(value.values());
  return Array.from(value);
}

function readDamagePart(part) {
  if (!part) return null;
  const customEnabled = Boolean(part.custom?.enabled);
  return {
    number: Number(part.number ?? 0),
    denomination: Number(part.denomination ?? 0),
    bonus: String(part.bonus ?? ''),
    types: setValues(part.types),
    customFormula: customEnabled ? String(part.custom?.formula ?? '') : null,
  };
}

function readEffect(effect) {
  return {
    id: effect.id ?? effect._id,
    name: effect.name ?? '',
    transfer: Boolean(effect.transfer),
    disabled: Boolean(effect.disabled),
    statuses: setValues(effect.statuses),
    changes: Array.from(effectChangesOf(effect), (change) => normalizeEffectChange({ ...change })),
    duration: effect.duration ? { ...effect.duration } : {},
  };
}


function readRawActivitySource(activity) {
  if (!activity) return null;
  if (typeof activity.toObject === 'function') {
    try {
      return activity.toObject();
    } catch {
      // Fall through to the live model below.
    }
  }
  return null;
}

function readRawActivityDamageParts(activity) {
  const source = readRawActivitySource(activity);
  if (Array.isArray(source?.damage?.parts)) return source.damage.parts;
  return Array.from(activity?.damage?.parts ?? [])
    .filter((part) => part?.base !== true && part?.locked !== true);
}

function cloneEffectReference(reference) {
  const clone = { ...reference };
  if (reference?._id != null && clone._id == null) clone._id = reference._id;
  if (reference?.onSave != null && clone.onSave == null) clone.onSave = reference.onSave;
  return clone;
}

function readRawActivityEffectReferences(activity) {
  const source = readRawActivitySource(activity);
  if (Array.isArray(source?.effects)) {
    return source.effects.map((reference) => ({ ...reference }));
  }
  return Array.from(activity?.effects ?? [], cloneEffectReference);
}

export function formatDamagePartFormula(part) {
  if (!part) return '';
  if (part.customFormula != null) return String(part.customFormula);

  const number = Number(part.number ?? 0);
  const denomination = Number(part.denomination ?? 0);
  const bonus = String(part.bonus ?? '').trim();

  if (!number || !denomination) return bonus;

  const base = `${number}d${denomination}`;
  if (!bonus) return base;

  const signed = bonus.match(/^([+-])?\s*(.+)$/);
  const sign = signed?.[1] ?? '+';
  const value = signed?.[2]?.trim() ?? bonus;
  return `${base} ${sign} ${value}`;
}

export function parseSimpleDamageFormula(formula) {
  const source = String(formula ?? '').trim();
  const match = source.match(/^(\d+)d(\d+)(?:\s*([+-])\s*(.+))?$/i);
  if (!match) return null;
  const [, number, denomination, sign, rawBonus] = match;
  let bonus = '';
  if (rawBonus != null) {
    const value = rawBonus.trim();
    bonus = sign === '-' ? `-${value}` : value;
  }
  return {
    number: Number(number),
    denomination: Number(denomination),
    bonus,
  };
}

export function damagePartFromFormula(formula, damageType) {
  const source = String(formula ?? '').trim();
  const types = Array.isArray(damageType)
    ? damageType.filter(Boolean).map(String)
    : (damageType ? [String(damageType)] : []);
  const parsed = parseSimpleDamageFormula(source);
  if (parsed) {
    return {
      ...parsed,
      custom: { enabled: false, formula: '' },
      types,
    };
  }
  if (source) {
    return {
      number: null,
      denomination: null,
      bonus: source,
      custom: { enabled: false, formula: '' },
      types,
    };
  }
  return {
    number: null,
    denomination: null,
    bonus: '',
    custom: { enabled: false, formula: '' },
    types,
  };
}

export function readUses(uses = {}) {
  return {
    spent: Number(uses.spent ?? 0),
    max: uses.max == null ? '' : String(uses.max),
    recovery: Array.from(uses.recovery ?? []).map((entry) => ({
      period: String(entry?.period ?? 'lr'),
      type: String(entry?.type ?? 'recoverAll'),
      formula: entry?.formula == null ? '' : String(entry.formula),
    })),
    hasAutoDestroy: Object.hasOwn(uses, 'autoDestroy'),
    autoDestroy: Boolean(uses.autoDestroy),
  };
}

export function buildUsesUpdate(uses = {}) {
  const update = {};
  if (Object.hasOwn(uses, 'spent')) update['system.uses.spent'] = Number(uses.spent ?? 0);
  if (Object.hasOwn(uses, 'max')) update['system.uses.max'] = uses.max == null ? '' : String(uses.max);
  if (Object.hasOwn(uses, 'recovery')) {
    update['system.uses.recovery'] = Array.from(uses.recovery ?? []).map((entry) => {
      const period = String(entry?.period ?? 'lr');
      const formula = entry?.formula == null ? '' : String(entry.formula).trim();
      if (period === 'recharge') return { period, type: 'recoverAll', formula: formula || '6' };
      const type = String(entry?.type ?? 'recoverAll');
      const result = { period, type };
      if (type === 'formula' && formula) result.formula = formula;
      return result;
    });
  } else if (Object.hasOwn(uses, 'recoveryKind') || Object.hasOwn(uses, 'rechargeThreshold')) {
    const recoveryKind = uses.recoveryKind ?? 'none';
    if (recoveryKind === 'shortRest') update['system.uses.recovery'] = [{ period: 'sr', type: 'recoverAll' }];
    else if (recoveryKind === 'longRest') update['system.uses.recovery'] = [{ period: 'lr', type: 'recoverAll' }];
    else if (recoveryKind === 'recharge') update['system.uses.recovery'] = [{ period: 'recharge', type: 'recoverAll', formula: String(uses.rechargeThreshold ?? 6) }];
    else update['system.uses.recovery'] = [];
  }
  if (Object.hasOwn(uses, 'autoDestroy')) update['system.uses.autoDestroy'] = Boolean(uses.autoDestroy);
  return update;
}

export function attachEffectRef(references = [], effectId, options = {}) {
  if (references.some((reference) => reference?._id === effectId)) return references;
  const reference = { _id: effectId };
  if (options.onSave != null) reference.onSave = Boolean(options.onSave);
  return [...references.map((entry) => ({ ...entry })), reference];
}

export function detachEffectRef(references = [], effectId) {
  return references
    .filter((reference) => reference?._id !== effectId)
    .map((reference) => ({ ...reference }));
}

export function buildOnHitStatusEffectData({ name, statusId, rounds }) {
  return {
    name: String(name ?? statusId ?? 'On-Hit Effect'),
    transfer: false,
    disabled: false,
    statuses: statusId ? [String(statusId)] : [],
    system: { changes: [] },
    duration: { value: Math.max(0, Number(rounds ?? 0)), units: 'rounds' },
    flags: { [MODULE_ID]: { workbench: { role: 'onHit' } } },
  };
}

export function buildPassiveEffectData({ name, key, type, mode, value }) {
  return {
    name: String(name ?? 'Passive Effect'),
    transfer: true,
    disabled: false,
    statuses: [],
    system: {
      changes: [{
        key: String(key ?? ''),
        type: changeTypeOf({ type, mode }),
        value: String(value ?? ''),
        phase: 'initial',
        priority: null,
      }],
    },
    flags: { [MODULE_ID]: { workbench: { role: 'passive' } } },
  };
}

export function readItemWorkbenchModel(item, activityId = null) {
  const activities = collectionValues(item?.system?.activities);
  const selectedActivity = activities.find((activity) => activity.id === activityId)
    ?? activities[0]
    ?? null;

  const allEffects = collectionValues(item?.effects).map(readEffect);
  const rawEffectReferences = readRawActivityEffectReferences(selectedActivity);
  const effectRefs = rawEffectReferences.map((reference) => ({
    effectId: reference?._id ?? null,
    onSave: reference?.onSave ?? null,
  })).filter((reference) => reference.effectId);
  const linkedIds = new Set(effectRefs.map((reference) => reference.effectId));

  const passive = allEffects.filter((effect) => effect.transfer);
  const targetEffects = allEffects.filter((effect) => !effect.transfer);
  const onHit = targetEffects.filter((effect) => linkedIds.has(effect.id));
  const availableTarget = targetEffects.filter((effect) => !linkedIds.has(effect.id));
  const baseDamage = readDamagePart(item?.system?.damage?.base);
  const extraDamage = readRawActivityDamageParts(selectedActivity).map(readDamagePart).filter(Boolean);

  const hasIdentification = Boolean(item?.system && Object.hasOwn(item.system, 'identified'));
  const hasInventory = Boolean(item?.system && Object.hasOwn(item.system, 'quantity'));
  const hasEquipAttunement = Boolean(item?.system && Object.hasOwn(item.system, 'equipped'));
  const hasProperties = Boolean(item?.system && Object.hasOwn(item.system, 'properties'));
  const rawSystem = typeof item?.toObject === 'function' ? item.toObject()?.system ?? item.system : item?.system;
  const hasUses = Boolean(rawSystem && Object.hasOwn(rawSystem, 'uses'));

  return {
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    name: item?.name ?? '',
    type: item?.type ?? '',
    img: item?.img ?? '',
    description: item?.system?.description?.value ?? '',
    identifier: item?.system?.identifier ?? '',
    source: {
      book: item?.system?.source?.book ?? '',
      page: item?.system?.source?.page ?? '',
      custom: item?.system?.source?.custom ?? '',
      license: item?.system?.source?.license ?? '',
      rules: item?.system?.source?.rules ?? '',
      revision: Number(item?.system?.source?.revision ?? 1),
    },
    hasIdentification,
    identification: {
      identified: Boolean(item?.system?.identified),
      name: item?.system?.unidentified?.name ?? '',
      description: item?.system?.unidentified?.description ?? '',
    },
    hasInventory,
    inventory: {
      quantity: Number(item?.system?.quantity ?? 1),
      weight: {
        value: Number(item?.system?.weight?.value ?? 0),
        units: item?.system?.weight?.units ?? 'lb',
      },
      price: {
        value: Number(item?.system?.price?.value ?? 0),
        denomination: item?.system?.price?.denomination ?? 'gp',
      },
      rarity: item?.system?.rarity ?? '',
      containerId: item?.system?.container?.id ?? item?.system?.container ?? null,
    },
    hasEquipAttunement,
    equipAttunement: {
      equipped: Boolean(item?.system?.equipped),
      attunement: item?.system?.attunement ?? '',
      attuned: Boolean(item?.system?.attuned),
    },
    hasProperties,
    properties: setValues(item?.system?.properties).map(String).sort(),
    validProperties: setValues(item?.system?.validProperties).map(String).sort(),
    hasBaseDamage: Boolean(item?.system?.damage?.base),
    activities: activities.map((activity) => ({
      id: activity.id,
      name: activity.name ?? '',
      type: activity.type ?? '',
      sort: Number(activity.sort ?? 0),
    })),
    selectedActivityId: selectedActivity?.id ?? null,
    selectedActivity: selectedActivity ? {
      id: selectedActivity.id,
      name: selectedActivity.name ?? '',
      type: selectedActivity.type ?? '',
      baseDamage,
      extraDamage,
      effectRefs,
    } : null,
    hasUses,
    uses: readUses(rawSystem?.uses ?? item?.system?.uses ?? {}),
    effects: { onHit, availableTarget, passive },
  };
}

export function buildBasicItemUpdate(form = {}, options = {}) {
  const update = {};
  if (Object.hasOwn(form, 'name')) update.name = String(form.name ?? '');
  if (Object.hasOwn(form, 'img')) update.img = String(form.img ?? '');
  if (Object.hasOwn(form, 'description')) {
    update['system.description.value'] = String(form.description ?? '');
  }
  if (Object.hasOwn(form, 'identifier')) {
    update['system.identifier'] = String(form.identifier ?? '');
  }
  if (form.source != null) {
    for (const key of ['book', 'page', 'custom', 'license', 'rules']) {
      if (Object.hasOwn(form.source, key)) update[`system.source.${key}`] = String(form.source[key] ?? '');
    }
    if (Object.hasOwn(form.source, 'revision')) {
      update['system.source.revision'] = Number(form.source.revision ?? 1);
    }
  }
  if (options.hasIdentification && form.identification != null) {
    if (Object.hasOwn(form.identification, 'identified')) update['system.identified'] = Boolean(form.identification.identified);
    if (Object.hasOwn(form.identification, 'name')) update['system.unidentified.name'] = String(form.identification.name ?? '');
    if (Object.hasOwn(form.identification, 'description')) update['system.unidentified.description'] = String(form.identification.description ?? '');
  }
  if (options.hasInventory && form.inventory != null) {
    if (Object.hasOwn(form.inventory, 'quantity')) update['system.quantity'] = Number(form.inventory.quantity ?? 0);
    if (form.inventory.weight != null) {
      if (Object.hasOwn(form.inventory.weight, 'value')) update['system.weight.value'] = Number(form.inventory.weight.value ?? 0);
      if (Object.hasOwn(form.inventory.weight, 'units')) update['system.weight.units'] = String(form.inventory.weight.units ?? 'lb');
    }
    if (form.inventory.price != null) {
      if (Object.hasOwn(form.inventory.price, 'value')) update['system.price.value'] = Number(form.inventory.price.value ?? 0);
      if (Object.hasOwn(form.inventory.price, 'denomination')) update['system.price.denomination'] = String(form.inventory.price.denomination ?? 'gp');
    }
    if (Object.hasOwn(form.inventory, 'rarity')) update['system.rarity'] = String(form.inventory.rarity ?? '');
    if (Object.hasOwn(form.inventory, 'containerId')) update['system.container'] = form.inventory.containerId || null;
  }
  if (options.hasEquipAttunement && form.equipAttunement != null) {
    if (Object.hasOwn(form.equipAttunement, 'equipped')) update['system.equipped'] = Boolean(form.equipAttunement.equipped);
    if (Object.hasOwn(form.equipAttunement, 'attunement')) update['system.attunement'] = String(form.equipAttunement.attunement ?? '');
    if (Object.hasOwn(form.equipAttunement, 'attuned')) update['system.attuned'] = Boolean(form.equipAttunement.attuned);
  }
  if (options.hasProperties && form.properties != null) {
    update['system.properties'] = Array.from(new Set(form.properties.map(String))).sort();
  }
  if (form.uses != null) Object.assign(update, buildUsesUpdate(form.uses));

  if (options.hasBaseDamage && form.baseDamageFormula != null) {
    const selectedTypes = Array.isArray(form.baseDamageTypes)
      ? form.baseDamageTypes.filter(Boolean).map(String)
      : (form.baseDamageType ? [String(form.baseDamageType)] : []);
    const damage = damagePartFromFormula(form.baseDamageFormula, selectedTypes);
    update['system.damage.base.number'] = damage.number;
    update['system.damage.base.denomination'] = damage.denomination;
    update['system.damage.base.bonus'] = damage.bonus;
    update['system.damage.base.types'] = damage.types;
    update['system.damage.base.custom.enabled'] = damage.custom.enabled;
    update['system.damage.base.custom.formula'] = damage.custom.formula;
  }

  return update;
}

export async function saveBasicItem(item, form = {}) {
  if (!item?.update) throw new Error('Item document does not support update().');
  if (Object.hasOwn(form.inventory ?? {}, 'containerId')) validateContainerMove(
    item,
    form.inventory.containerId,
  );
  const update = buildBasicItemUpdate(form, {
    hasBaseDamage: Boolean(item.system?.damage?.base),
    hasIdentification: Boolean(item?.system && Object.hasOwn(item.system, 'identified')),
    hasInventory: Boolean(item?.system && Object.hasOwn(item.system, 'quantity')),
    hasEquipAttunement: Boolean(item?.system && Object.hasOwn(item.system, 'equipped')),
    hasProperties: Boolean(item?.system && Object.hasOwn(item.system, 'properties')),
  });
  return item.update(update);
}

export function buildActivityExtraDamageUpdate(
  activity,
  rows = [],
) {
  const rawParts = readRawActivityDamageParts(activity);
  const parts = rows
    .filter((row) => String(row?.formula ?? '').trim())
    .map((row, index) => {
      const damage = damagePartFromFormula(row.formula, row.types ?? row.type);
      const previous = rawParts[index] ?? {};
      return {
        ...previous,
        ...damage,
        custom: {
          ...(previous.custom ?? {}),
          ...damage.custom,
        },
        types: damage.types,
      };
    });
  return { 'damage.parts': parts };
}

export async function saveActivityExtraDamage(activity, rows = []) {
  if (!activity?.update) throw new Error('Activity does not support update().');
  const updated = await activity.update(buildActivityExtraDamageUpdate(
    activity,
    rows,
  ));
  if (!updated) throw new Error('추가 피해 저장이 취소되었습니다. 입력을 보존했습니다.');
  return updated;
}

export async function setActivityEffectAttached(activity, effectId, attached, options = {}) {
  if (!activity?.update) throw new Error('Activity does not support update().');
  const current = readRawActivityEffectReferences(activity);
  const effects = attached
    ? attachEffectRef(current, effectId, options)
    : detachEffectRef(current, effectId);
  const updated = await activity.update({ effects });
  if (!updated) throw new Error('효과 연결 저장이 취소되었습니다. 효과를 삭제하지 않았습니다. 연결 상태를 확인하십시오.');
  return effects;
}

export async function createOnHitStatusEffect(item, activity, data = {}) {
  if (!item?.createEmbeddedDocuments) {
    throw new Error('Item document does not support embedded ActiveEffect creation.');
  }
  if (!activity) throw new Error('An Activity is required for an on-hit effect.');

  const [effect] = await item.createEmbeddedDocuments('ActiveEffect', [
    buildOnHitStatusEffectData(data),
  ]);
  if (!effect) throw new Error('ActiveEffect creation did not return a document.');

  await setActivityEffectAttached(activity, effect.id, true, {
    onSave: data.onSave,
  });
  return effect;
}

export async function deleteOnHitEffect(item, effectId) {
  if (!item?.deleteEmbeddedDocuments) {
    throw new Error('Item document does not support embedded ActiveEffect deletion.');
  }

  const id = String(effectId ?? '').trim();
  if (!id) throw new Error('An ActiveEffect id is required for deletion.');

  const linkedActivities = collectionValues(item.system?.activities)
    .filter((activity) => readRawActivityEffectReferences(activity)
      .some((reference) => reference?._id === id));

  for (const activity of linkedActivities) {
    await setActivityEffectAttached(activity, id, false);
  }

  const deleted = await item.deleteEmbeddedDocuments('ActiveEffect', [id]);
  if (!deleted?.some(effect => (effect.id ?? effect._id) === id)) {
    throw new Error('효과 삭제가 취소되었습니다. 연결 해제는 이미 저장되었으므로 필요한 연결을 다시 선택하십시오.');
  }
  return id;
}

export async function createPassiveEffect(item, data = {}) {
  if (!item?.createEmbeddedDocuments) {
    throw new Error('Item document does not support embedded ActiveEffect creation.');
  }
  const [effect] = await item.createEmbeddedDocuments('ActiveEffect', [
    buildPassiveEffectData(data),
  ]);
  if (!effect) throw new Error('ActiveEffect creation did not return a document.');
  return effect;
}
