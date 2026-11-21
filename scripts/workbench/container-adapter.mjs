function sourceSystem(item) {
  return item?.toObject?.()?.system ?? item?.system ?? {};
}

function ownerActor(item) {
  return item?.actor ?? (item?.parent?.items ? item.parent : null);
}

function sameScope(
  left,
  right,
) {
  return (left?.pack ?? null) === (right?.pack ?? null) && ownerActor(left) === ownerActor(right);
}

export function containerParentId(item) {
  const value = sourceSystem(item).container;
  return value?.id ?? value ?? null;
}

export function containerItems(item) {
  const collection = ownerActor(item)?.items
    ?? (item?.pack ? globalThis.game?.packs?.get?.(item.pack) : globalThis.game?.items);
  return Array.from(collection?.values?.() ?? []);
}

function canContain(item) {
  return item?.type === 'container';
}

function isPhysical(item) {
  return Object.hasOwn(
    sourceSystem(item),
    'container'
  );
}

function graph(
  item,
  items,
) {
  return new Map(items.filter(
    (candidate) => sameScope(
      item,
      candidate,
    ),
  ).map((candidate) => [candidate.id, candidate]));
}

function maxDepth() {
  return globalThis.dnd5e?.dataModels?.item?.PhysicalItemTemplate?.MAX_DEPTH ?? 5;
}

export function validateContainerMove(
  item,
  destinationId,
  items = containerItems(item),
) {
  const destination = destinationId || null;
  if (destination === containerParentId(item)) return;
  const documents = graph(
    item,
    items,
  );
  if (!item || documents.get(item.id) !== item || !isPhysical(item)) {
    throw new Error('같은 월드 또는 같은 액터의 보관 가능한 아이템을 선택하십시오.');
  }
  if (destination && !canContain(documents.get(destination))) {
    throw new Error('이 문서 범위에서 보관용품을 찾을 수 없습니다.');
  }
  requireOwner(item);
  requireOwner(documents.get(containerParentId(item)));
  if (destination) requireOwner(documents.get(destination));
  // Validate the moved branch, including nested children, with its proposed parent.
  const parents = new Map(Array.from(
    documents,
    ([id, document]) => [id, containerParentId(document)],
  ));
  parents.set(
    item.id,
    destination,
  );
  const branch = new Set([item.id]);
  for (const id of branch) {
    for (const [child, parent] of parents) if (parent === id) branch.add(child);
  }
  for (const id of branch) {
    const visited = new Set([id]);
    let parent = parents.get(id);
    let depth = 0;
    while (parent) {
      if (visited.has(parent)) throw new Error('자기 자신이나 하위 보관용품 안으로 넣을 수 없습니다.');
      visited.add(parent);
      if (!canContain(documents.get(parent))) throw new Error('상위 보관용품 연결이 올바르지 않습니다. 먼저 연결을 수정하십시오.');
      if (++depth > maxDepth()) throw new Error(`보관용품 중첩은 최대 ${maxDepth()}단계까지 가능합니다.`);
      parent = parents.get(parent);
    }
  }
}

export function containerDestinationOptions(
  item,
  items = containerItems(item),
) {
  const current = containerParentId(item);
  const options = [{ value: '', label: '보관용품 없음', selected: !current }];
  for (const candidate of items.filter((entry) => canContain(entry) && sameScope(
    item,
    entry,
  ))) {
    if (candidate.id === item.id) continue;
    try {
      validateContainerMove(
        item,
        candidate.id,
        items,
      );
      options.push({ value: candidate.id, label: candidate.name, selected: current === candidate.id });
    } catch { /* Invalid destinations remain unavailable. */ }
  }
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: `기존 연결 확인 필요: ${current}`, selected: true, legacy: true });
  }
  return options;
}

function requireOwner(item) {
  if (item?.isOwner === false || ownerActor(item)?.isOwner === false) throw new Error('아이템을 변경할 권한이 없습니다.');
}

export async function moveContainerItem(
  item,
  destinationId,
  { items = containerItems(item), expectedParent } = {},
) {
  if (!item || !items.includes(item)) throw new Error('보관 항목을 찾을 수 없습니다. 목록을 다시 확인하십시오.');
  requireOwner(item);
  if (expectedParent !== undefined && (expectedParent || null) !== containerParentId(item)) {
    throw new Error('보관 위치가 다른 곳에서 변경되었습니다. 목록을 확인하고 다시 시도하십시오.');
  }
  validateContainerMove(
    item,
    destinationId,
    items,
  );
  const current = containerParentId(item);
  if (current) requireOwner(items.find((entry) => entry.id === current && sameScope(
    item,
    entry,
  )));
  const destination = destinationId || null;
  if (destination) requireOwner(items.find((entry) => entry.id === destination && sameScope(
    item,
    entry,
  )));
  if (current === destination) return item;
  if (!await item.update({ 'system.container': destination })) {
    throw new Error('보관 위치 저장이 취소되었습니다. 기존 연결을 유지했습니다.');
  }
  return item;
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value) * 100) / 100) : '—';
}

export async function readContainerManagement(
  container,
  items = containerItems(container),
) {
  if (!canContain(container)) return null;
  const documents = graph(
    container,
    items,
  );
  const byParent = new Map();
  for (const entry of documents.values()) {
    const parent = containerParentId(entry);
    if (!byParent.has(parent)) byParent.set(
      parent,
      [],
    );
    byParent.get(parent).push(entry);
  }
  const entries = [];
  const warnings = [];
  const visited = new Set([container.id]);
  function visit(
    parent,
    depth,
    path,
  ) {
    const children = (byParent.get(parent) ?? []).sort(
      (
        a,
        b
      ) => String(a.name).localeCompare(
        String(b.name),
        'ko',
      ),
    );
    for (const entry of children) {
      if (visited.has(entry.id)) {
        warnings.push('보관 항목에 순환 연결이 있습니다. 연결을 수정하십시오.');
        continue;
      }
      visited.add(entry.id);
      entries.push({
        id: entry.id, name: entry.name, img: entry.img, type: entry.type,
        depth, nested: depth > 0, path, parentId: parent,
        quantity: Number(sourceSystem(entry).quantity ?? 1),
        isContainer: canContain(entry),
        canEdit: entry.isOwner !== false && container.isOwner !== false && ownerActor(entry)?.isOwner !== false,
        destinations: containerDestinationOptions(
          entry,
          items,
        ).filter((option) => !option.selected && !option.legacy),
      });
      if (depth >= maxDepth()) {
        warnings.push('보관용품 중첩 깊이가 시스템의 최대 범위를 넘었습니다. 연결을 수정하십시오.');
        continue;
      }
      if (canContain(entry)) visit(
        entry.id,
        depth + 1,
        [...path, entry.name],
      );
    }
  }
  visit(
    container.id,
    0,
    [],
  );
  const ancestors = [];
  const ancestorIds = new Set([container.id]);
  let parentId = containerParentId(container);
  while (parentId) {
    const parent = documents.get(parentId);
    if (ancestorIds.has(parentId) || !canContain(parent)) {
      warnings.push('상위 보관용품 연결을 확인하십시오. 현재 연결을 해제하거나 다른 보관용품을 선택할 수 있습니다.');
      break;
    }
    ancestorIds.add(parentId);
    ancestors.unshift({ id: parent.id, name: parent.name });
    parentId = containerParentId(parent);
  }
  const candidates = Array.from(documents.values()).filter((entry) => {
    if (entry.id === container.id || containerParentId(entry) === container.id || !isPhysical(entry) || entry.isOwner === false) return false;
    try {
      validateContainerMove(
        entry,
        container.id,
        items,
      );
      return true;
    } catch { return false; }
  }).map((entry) => ({ id: entry.id, name: entry.name, parentId: containerParentId(entry) ?? '', parentName: documents.get(containerParentId(entry))?.name ?? '보관용품 없음' }));
  const system = sourceSystem(container);
  const capacity = system.capacity ?? {};
  let contentsWeight;
  let totalWeight;
  // Native rollups recurse through contents. Never call them on a corrupt graph.
  if (!warnings.length) {
    try {
      contentsWeight = await container.system.contentsWeight;
      totalWeight = await container.system.totalWeight;
    } catch { warnings.push('시스템의 무게 계산 결과를 읽을 수 없습니다.'); }
  }
  const weightUnits = system.weight?.units ?? 'lb';
  const count = entries.reduce(
    (
      sum,
      entry
    ) => sum + entry.quantity,
    0,
  );
  const limitUnits = capacity.weight?.units ?? weightUnits;
  const config = globalThis.CONFIG?.DND5E?.weightUnits ?? {};
  const factor = weightUnits === limitUnits ? 1 : (config[weightUnits]?.conversion / config[limitUnits]?.conversion);
  const capacityWeight = contentsWeight * factor;
  const overCount = capacity.count > 0 && count > capacity.count;
  const overWeight = capacity.weight?.value > 0 && Number.isFinite(capacityWeight) && capacityWeight > capacity.weight.value;
  return {
    entries, ancestors, candidates, warnings,
    canEdit: container.isOwner !== false && ownerActor(container)?.isOwner !== false,
    directCount: (byParent.get(container.id) ?? []).length,
    count: warnings.length ? '—' : formatNumber(count), countLimit: capacity.count > 0 ? formatNumber(capacity.count) : '제한 없음',
    contentsWeight: formatNumber(contentsWeight), totalWeight: formatNumber(totalWeight), weightUnits,
    weightLimit: capacity.weight?.value > 0 ? `${formatNumber(capacity.weight.value)} ${limitUnits}` : '제한 없음',
    volumeLimit: capacity.volume?.value > 0 ? `${formatNumber(capacity.volume.value)} ${capacity.volume.units}` : '미설정',
    weightless: Array.from(container.system.properties ?? []).includes('weightlessContents'),
    overCapacity: capacity.count > 0 ? overCount : overWeight,
  };
}
