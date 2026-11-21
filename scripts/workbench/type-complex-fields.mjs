const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function validateStructuredKeys(value, original, path = '') {
  if (!value || typeof value !== 'object' || JSON.stringify(value) === JSON.stringify(original)) return;
  for (const [key, child] of Object.entries(value)) {
    const before = original && Object.hasOwn(original, key) ? original[key] : undefined;
    if (JSON.stringify(child) === JSON.stringify(before)) continue;
    if (BLOCKED_KEYS.has(key) || key.includes('.') || key.startsWith('-=')) {
      throw new Error(`${path}: 허용하지 않는 복합값 키입니다.`);
    }
    validateStructuredKeys(child, before, `${path}.${key}`);
  }
}

export function schemaChildren(field) {
  // Document references point at entire Document schemas, not embedded editor fields.
  if (field?.constructor?.name?.includes('Document') || field?.options?.idOnly) return null;
  return field?.fields ?? field?.model?.schema?.fields ?? field?.model?.defineSchema?.() ?? null;
}

function fieldName(field) {
  return field?.constructor?.name ?? '';
}

export function complexKind(field) {
  const name = fieldName(field);
  if (['ArrayField', 'SetField'].includes(name) && field.element) return 'list';
  if (name === 'MappingField' && field.model) return 'mapping';
  if (schemaChildren(field)) return 'object';
  return null;
}

function localLabel(value) {
  const label = typeof value === 'object' ? (value?.label ?? value?.name) : value;
  return globalThis.game?.i18n?.localize?.(String(label ?? '')) ?? String(label ?? '');
}

export function typeChoices(
  field,
  path,
  item,
  value,
) {
  let choices = field?.choices;
  if (typeof choices === 'function') {
    try {
      choices = choices();
    } catch {
      choices = null;
    }
  }
  const config = globalThis.CONFIG?.DND5E ?? {};
  const type = item?.type;
  if (!choices || !Object.keys(choices).length) {
    if (path === 'primaryAbility.value' || path.endsWith('ability') || path === 'ability')
      choices = config.abilities;
    else if (path.endsWith('.types') && path.startsWith('damage.')) choices = config.damageTypes;
    else if (path === 'school') choices = config.spellSchools;
    else if (path === 'method') choices = config.spellcasting;
    else if (path === 'spellcasting.progression') choices = config.spellProgression;
    else if (path.endsWith('.scaling.mode') && path.startsWith('damage.')) choices = config.damageScalingModes;
    else if (path === 'movement.ignoredDifficultTerrain') choices = config.difficultTerrainTypes;
    else if (path === 'hd.denomination')
      choices = Object.fromEntries(
        (config.hitDieTypes ?? ['d4', 'd6', 'd8', 'd10', 'd12']).map((die) => [die, die]),
      );
    else if (path === 'type.value') {
      const roots = {
        weapon: 'weaponTypes',
        equipment: 'equipmentTypes',
        consumable: 'consumableTypes',
        tool: 'toolTypes',
        loot: 'lootTypes',
        feat: 'featureTypes',
        container: 'containerTypes',
      };
      choices = type === 'facility' ? config.facilities?.types : config[roots[type]];
    } else if (path === 'type.subtype') {
      const root =
        type === 'facility'
          ? config.facilities?.types
          : type === 'consumable'
            ? config.consumableTypes
            : type === 'equipment'
              ? config.equipmentTypes
              : config.featureTypes;
      choices = root?.[item?.system?.type?.value]?.subtypes;
    } else if (type === 'facility' && ['size', 'building.size'].includes(path))
      choices = config.facilities?.sizes;
    else if (type === 'facility' && ['order', 'progress.order'].includes(path))
      choices = config.facilities?.orders;
    else if (path === 'trade.pending.operation') choices = { buy: '구입', sell: '판매' };
    else if (path.endsWith('.units')) {
      if (path.startsWith('duration')) choices = config.timePeriods;
      else if (path.startsWith('range'))
        choices = { ...config.distanceUnits, ...config.rangeTypes };
      else if (path.startsWith('target.template')) choices = config.distanceUnits;
      else if (path.startsWith('movement')) choices = config.movementUnits;
      else if (path.startsWith('senses')) choices = config.distanceUnits;
      else if (path.startsWith('capacity.volume')) choices = config.volumeUnits;
      else if (path.startsWith('capacity.weight')) choices = config.weightUnits;
    } else if (path === 'activation.type') choices = config.activityActivationTypes;
    else if (path === 'enchant.period') choices = config.enchantmentPeriods;
    else if (path === 'target.affects.type') choices = config.individualTargetTypes;
    else if (path === 'target.template.type') choices = config.areaTargetTypes;
  }
  if (fieldName(field) === 'DocumentUUIDField' && field.options?.type === 'Actor') {
    choices = Object.fromEntries(
      Array.from(globalThis.game?.actors ?? []).map((actor) => [actor.uuid, actor.name]),
    );
  }
  if (fieldName(field) === 'IdentifierField' && path === 'prerequisites.items') {
    choices = Object.fromEntries(
      Array.from(globalThis.game?.items ?? [])
        .filter((entry) => entry.system?.identifier)
        .map((entry) => [`${entry.type}:${entry.system.identifier}`, entry.name]),
    );
  }
  if (Array.isArray(choices) || choices instanceof Set) choices = Object.fromEntries(Array.from(choices).map((entry) => [entry, entry]));
  const options = Object.entries(choices ?? {}).map(([key, label]) => ({
    value: key,
    label: localLabel(label) || key,
  }));
  if (!options.length) return [];
  const values = Array.isArray(value) ? value : [value ?? ''];
  for (const existing of values) {
    if (!options.some((option) => option.value === String(existing)))
      options.push({ value: String(existing), label: existing ? `${existing} (기존 값)` : '없음' });
  }
  if (field.options?.blank !== false && !options.some((option) => option.value === ''))
    options.unshift({ value: '', label: '없음' });
  return options.map((option) => ({
    ...option,
    selected: values.map(String).includes(option.value),
  }));
}

function childOptions(
  field,
  path,
  item,
  value,
  rootValue,
  address,
) {
  if (field.workbenchChoices) return typeChoices(
    { ...field, choices: field.workbenchChoices(rootValue, address) },
    path,
    item,
    value,
  );
  if (path === 'startingEquipment.type')
    return typeChoices(
      {
        choices: {
          OR: '하나 선택',
          AND: '모두 지급',
          armor: '방어구',
          tool: '도구',
          weapon: '무기',
          focus: '주문 시전 매개체',
          currency: '화폐',
          linked: '특정 아이템',
        },
        options: { blank: false },
      },
      path,
      item,
      value,
    );
  if (path === 'startingEquipment.group') {
    const currentId = rootValue?.[address[0]]?._id;
    const options = [
      { value: '', label: '최상위' },
      ...rootValue
        .filter((entry) => ['OR', 'AND'].includes(entry.type) && entry._id !== currentId)
        .map((entry, index) => ({
          value: entry._id,
          label: `장비 묶음 ${index + 1} · ${entry.type} · ${entry._id}`,
        })),
    ];
    if (value && !options.some((option) => option.value === value)) options.push({ value, label: `${value} (기존 참조)` });
    return options.map((option) => ({ ...option, selected: option.value === (value ?? '') }));
  }
  if (path === 'startingEquipment.key') {
    const row = rootValue?.[address[0]];
    const configKeys = {
      armor: 'armorTypes',
      currency: 'currencies',
      focus: 'focusTypes',
      tool: 'toolTypes',
      weapon: 'weaponProficiencies',
    };
    const choices = globalThis.CONFIG?.DND5E?.[configKeys[row?.type]];
    if (row?.type === 'linked')
      return typeChoices(
        {
          choices: Object.fromEntries(
            Array.from(globalThis.game?.items ?? []).map((entry) => [entry.uuid, entry.name]),
          ),
        },
        path,
        item,
        value,
      );
    if (choices) return typeChoices(
      { choices },
      path,
      item,
      value,
    );
  }
  return typeChoices(
    field,
    path,
    item,
    value,
  );
}

export function complexEditor(
  field,
  value,
  path,
  item,
  labelFor,
  address = [],
  rootValue = value,
) {
  const kind = complexKind(field);
  const node = {
    address: JSON.stringify(address),
    label: labelFor(path),
    isList: kind === 'list',
    isObject: ['object', 'mapping'].includes(kind),
    showLabel: address.length > 0,
  };
  node.isNullable = field.workbenchNullable === true;
  node.isEnabled = value != null;
  if (node.isNullable && !node.isEnabled) return node;
  if (kind === 'list') {
    node.rows = Array.from(value ?? []).map((entry, index) => ({
      index,
      ordinal: index + 1,
      address: node.address,
      node: complexEditor(
        field.element,
        entry,
        path,
        item,
        labelFor,
        [...address, index],
        rootValue,
      ),
    }));
  } else if (kind === 'mapping') {
    const keys = new Set([
      ...Object.keys(field.options?.initialKeys ?? {}),
      ...Object.keys(value ?? {}),
    ]);
    node.children = Array.from(keys).map((key) => ({
      ...complexEditor(
        field.model,
        value?.[key],
        `${path}.${key}`,
        item,
        labelFor,
        [...address, key],
        rootValue,
      ),
      label: localLabel(globalThis.CONFIG?.DND5E?.currencies?.[key]) || labelFor(key),
    }));
    if (field.workbenchDynamic) {
      node.isObject = false;
      node.isMapping = true;
      node.keyOptions = typeChoices(
        { choices: field.workbenchKeys, options: { blank: false } },
        path,
        item,
        '',
      ).filter((option) => option.value && !keys.has(option.value));
      node.hasKeyOptions = Boolean(field.workbenchKeys);
      node.keyPlaceholder = field.workbenchLevel != null ? `레벨 (${field.workbenchLevel}~${globalThis.CONFIG?.DND5E?.maxLevel ?? 20})` : '문서 식별자 또는 배정 키';
      node.children.forEach((child, index) => {
        child.mapKey = Array.from(keys)[index];
        child.mapAddress = node.address;
      });
    }
  } else if (kind === 'object') {
    node.children = Object.entries(schemaChildren(field)).map(([key, child]) =>
      complexEditor(
        child,
        value?.[key],
        `${path}.${key}`,
        item,
        labelFor,
        [...address, key],
        rootValue,
      ),
    );
  } else {
    const name = fieldName(field);
    node.isLeaf = true;
    node.isBoolean = name === 'BooleanField';
    node.isNumber = ['NumberField', 'IntegerSortField'].includes(name);
    node.isText = !node.isBoolean && !node.isNumber;
    node.readOnly = address.at(-1) === '_id' && !field.workbenchEditableId;
    node.kind = field.workbenchScalar ?? (node.isBoolean ? 'boolean' : node.isNumber ? 'number' : 'text');
    node.value = node.isBoolean ? Boolean(value) : (value ?? '');
    node.baseline = JSON.stringify(node.isBoolean ? node.value : String(node.value));
    node.options = childOptions(
      field,
      path,
      item,
      value,
      rootValue,
      address,
    );
    node.isReference =
      name === 'DocumentUUIDField' ||
      name === 'IdentifierField' || field.workbenchReference ||
      (path === 'startingEquipment.key' && rootValue?.[address[0]]?.type === 'linked');
    node.referenceList = `ncm-type-${path.replaceAll('.', '-')}-${address.join('-')}`;
    node.hasChoices = node.options.length > 0 && !node.readOnly && !node.isReference;
    node.min = field.options?.min;
    node.max = field.options?.max;
    node.hasMin = node.min != null;
    node.hasMax = node.max != null;
    node.step = field.options?.integer ? '1' : 'any';
    node.help = field.workbenchHelp;
    node.refresh = field.workbenchRefresh;
  }
  return node;
}

function atAddress(
  value,
  address,
) {
  return address.reduce(
    (
      current,
      key,
    ) => {
      return current?.[key];
    },
    value,
  );
}

function setAddress(
  value,
  address,
  next,
) {
  if (!address.length) return next;
  const parent = atAddress(
    value,
    address.slice(
      0,
      -1,
    ),
  );
  if (address.some((key) => BLOCKED_KEYS.has(key)) || !parent)
    throw new Error('편집할 목록 경로를 확인하십시오.');
  parent[address.at(-1)] = next;
  return value;
}

// A hidden root carries the complete source; only changed visible controls are merged into it.
export function syncComplexInputs(form) {
  for (const root of form?.querySelectorAll?.('[data-type-complex-root], [data-advancement-complex-root], [data-activity-complex-root]') ?? []) {
    const hidden = root.querySelector('[data-type-field], [data-advancement-field], [data-activity-common-field], [data-activity-specific-field]');
    let value = JSON.parse(hidden.value);
    let changed = false;
    const baselines = [];
    for (const control of root.querySelectorAll('[data-complex-control]')) {
      const input = control.type === 'checkbox' ? control.checked : control.value;
      if (JSON.stringify(input) === control.dataset.complexBaseline) continue;
      changed = true;
      let next = input;
      if (control.dataset.complexKind === 'number') {
        if (input !== '' && !Number.isFinite(Number(input)))
          throw new Error('목록의 수치는 유한한 숫자여야 합니다.');
        next = input === '' ? null : Number(input);
      } else if (control.dataset.complexKind === 'hitPoints') {
        next = input !== '' && Number.isFinite(Number(input)) ? Number(input) : input;
      } else if (
        control.dataset.complexKind === 'text' &&
        control.dataset.complexAddress.endsWith('"group"]')
      )
        next = input || null;
      value = setAddress(
        value,
        JSON.parse(control.dataset.complexAddress),
        next,
      );
      baselines.push({ control, input });
    }
    if (changed) hidden.value = JSON.stringify(value);
    for (const { control, input } of baselines) control.dataset.complexBaseline = JSON.stringify(input);
  }
}

export function defaultValue(field) {
  const kind = complexKind(field);
  if (kind === 'list') return [];
  if (kind === 'object')
    return Object.fromEntries(
      Object.entries(schemaChildren(field))
        .map(([key, child]) => [key, defaultValue(child)])
        .filter(([, value]) => value !== undefined),
    );
  if (kind === 'mapping') return {};
  const initial = field?.options?.initial;
  if (typeof initial === 'function') return initial();
  if (initial !== undefined) return structuredClone(initial);
  if (fieldName(field) === 'DocumentIdField')
    return (
      globalThis.foundry?.utils?.randomID?.() ??
      crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    );
  if (fieldName(field) === 'BooleanField') return false;
  if (['NumberField', 'IntegerSortField'].includes(fieldName(field)))
    return field.options?.nullable === false ? (field.options?.min ?? 0) : null;
  return field.options?.nullable ? null : '';
}

export function schemaAtAddress(
  field,
  address,
) {
  return address.reduce(
    (schema, key) => complexKind(schema) === 'list'
      ? schema.element
      : complexKind(schema) === 'mapping'
        ? schema.model
        : schemaChildren(schema)?.[key],
    field,
  );
}

export function changeComplexMapping(
  field,
  value,
  address,
  key,
  remove = false,
) {
  const schema = schemaAtAddress(
    field,
    address,
  );
  if (complexKind(schema) !== 'mapping') throw new Error('배정 필드가 아닙니다.');
  if (!key || BLOCKED_KEYS.has(key) || /[.\s]/.test(key) || key.startsWith('-='))
    throw new Error('키는 비어 있거나 공백, 점, 예약어를 포함할 수 없습니다.');
  if (schema.workbenchKeys && !Object.hasOwn(schema.workbenchKeys, key))
    throw new Error('허용된 능력치 키를 선택하십시오.');
  if (schema.workbenchLevel != null && (!/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) > (globalThis.CONFIG?.DND5E?.maxLevel ?? 20) || Number(key) < schema.workbenchLevel))
    throw new Error('레벨 범위를 확인하십시오.');
  const next = structuredClone(value ?? {});
  const mapping = atAddress(
    next,
    address,
  ) ?? {};
  if (remove) delete mapping[key];
  else {
    if (Object.hasOwn(mapping, key)) throw new Error('이미 등록된 키입니다.');
    mapping[key] = defaultValue(schema.model);
  }
  return setAddress(
    next,
    address,
    mapping,
  );
}

export function toggleComplexObject(
  field,
  value,
  address,
) {
  const schema = schemaAtAddress(
    field,
    address,
  );
  if (!schema?.workbenchNullable) throw new Error('선택 설정이 아닙니다.');
  const next = structuredClone(value);
  return setAddress(
    next,
    address,
    atAddress(next, address) == null ? defaultValue(schema) : null,
  );
}

export function changeComplexList(
  field,
  value,
  address,
  removeIndex = null,
) {
  let schema = field;
  for (const key of address)
    schema =
      complexKind(schema) === 'list'
        ? schema.element
        : complexKind(schema) === 'mapping'
          ? schema.model
          : schemaChildren(schema)?.[key];
  if (complexKind(schema) !== 'list') throw new Error('목록 필드가 아닙니다.');
  const next = structuredClone(value);
  const list = atAddress(
    next,
    address,
  ) ?? [];
  if (removeIndex == null) list.push(defaultValue(schema.element));
  else {
    const id = list[removeIndex]?._id;
    if (id && list.some((entry) => entry.group === id))
      throw new Error('하위 장비를 다른 묶음으로 옮긴 뒤 이 묶음을 삭제하십시오.');
    list.splice(
      removeIndex,
      1,
    );
  }
  return setAddress(
    next,
    address,
    list,
  );
}

export function validateComplexValue(
  field,
  value,
  path,
  original,
) {
  if (JSON.stringify(value) === JSON.stringify(original)) return;
  const kind = complexKind(field);
  if (value == null && field.workbenchNullable) return;
  if (field.workbenchScalar === 'hitPoints') {
    if (!['avg', 'max'].includes(value) && (!Number.isInteger(value) || value < 1))
      throw new Error(`${path}: 체력은 max, avg 또는 양의 정수여야 합니다.`);
    return;
  }
  if (kind === 'list') {
    if (!Array.isArray(value)) throw new Error(`${path}: 목록이 필요합니다.`);
    if (value.some((entry) => entry === '' || entry == null)) throw new Error(`${path}: 빈 항목을 선택하거나 삭제하십시오.`);
    if (
      fieldName(field) === 'SetField' &&
      new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length
    )
      throw new Error(`${path}: 중복된 항목을 제거하십시오.`);
    value.forEach(
      (
        entry,
        index,
      ) => {
        validateComplexValue(
          field.element,
          entry,
          path,
          original?.[index],
        );
      },
    );
    if (path === 'startingEquipment') {
      const ids = new Set(value.map((entry) => entry._id));
      if (ids.size !== value.length || ids.has('') || ids.has(undefined))
        throw new Error('시작 장비의 식별자는 비어 있거나 중복될 수 없습니다.');
      for (const entry of value) {
        const seen = new Set([entry._id]);
        let group = entry.group;
        while (group) {
          const parent = value.find((candidate) => candidate._id === group);
          if (!parent || !['OR', 'AND'].includes(parent.type) || seen.has(group))
            throw new Error('시작 장비의 상위 묶음이 없거나 순환합니다.');
          seen.add(group);
          group = parent.group;
        }
      }
    }
  } else if (['object', 'mapping'].includes(kind)) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${path}: 필드 묶음이 필요합니다.`);
    for (const [key, entry] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(key)) throw new Error(`${path}: 허용되지 않는 키입니다.`);
      const child = kind === 'mapping' ? field.model : schemaChildren(field)?.[key];
      if (child) validateComplexValue(
        child,
        entry,
        `${path}.${key}`,
        original?.[key],
      );
    }
  } else if (['NumberField', 'IntegerSortField'].includes(fieldName(field))) {
    const options = field.options ?? {};
    if (value == null && options.nullable !== false) return;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (options.integer && !Number.isInteger(value)) ||
      (options.positive && value <= 0) ||
      (options.min != null && value < options.min) ||
      (options.max != null && value > options.max)
    )
      throw new Error(`${path}: 수치 범위 또는 정수 조건을 확인하십시오.`);
  }
}
