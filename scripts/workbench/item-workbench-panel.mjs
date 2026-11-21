import { buildBasicItemUpdate } from './item-adapter.mjs';
import { validateContainerMove } from './container-adapter.mjs';
import { requireWriteResult } from './write-result.mjs';

function requireContext(context) {
  if (!context?.item || typeof context.update !== 'function') {
    throw new Error('Item Workbench 문서 컨텍스트가 필요합니다.');
  }
}

function normalizeBasicForm(form = {}) {
  const normalized = { ...form };
  if (Object.hasOwn(form, 'itemName')) normalized.name = form.itemName;
  if (Object.hasOwn(form, 'itemImg')) normalized.img = form.itemImg;
  return normalized;
}

function itemUpdateOptions(item) {
  return {
    hasBaseDamage: Boolean(item.system?.damage?.base),
    hasIdentification: Boolean(item?.system && Object.hasOwn(item.system, 'identified')),
    hasInventory: Boolean(item?.system && Object.hasOwn(item.system, 'quantity')),
    hasEquipAttunement: Boolean(item?.system && Object.hasOwn(item.system, 'equipped')),
    hasProperties: Boolean(item?.system && Object.hasOwn(item.system, 'properties')),
  };
}

export function createItemWorkbenchPanel({ context, onReturn = () => {} } = {}) {
  requireContext(context);
  return {
    context,
    get item() {
      return context.item;
    },
    buildBasicUpdate(form = {}) {
      if (Object.hasOwn(form.inventory ?? {}, 'containerId')) validateContainerMove(
        context.item,
        form.inventory.containerId,
      );
      const update = buildBasicItemUpdate(
        normalizeBasicForm(form),
        itemUpdateOptions(context.item),
      );
      for (const [path, value] of Object.entries(update)) {
        if (path.includes('.')) continue;
        if (Object.is(context.item[path], value)) delete update[path];
      }
      return update;
    },
    async saveBasic(
      form = {},
      additionalUpdate = {},
    ) {
      const update = { ...this.buildBasicUpdate(form), ...additionalUpdate };
      if (Object.keys(update).length) requireWriteResult(await context.update(update), '아이템 저장');
      return context.item;
    },
    returnToOwner() {
      return onReturn();
    },
  };
}
