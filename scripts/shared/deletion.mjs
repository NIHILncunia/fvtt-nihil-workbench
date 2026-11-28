import { deletionEntry } from './compat.mjs';

export { deletionEntry };

export function addDeletion(
  update,
  path,
) {
  const [key, value] = deletionEntry(path);
  update[key] = value;
  return update;
}

export function isDeletionValue(value) {
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  return Boolean(ForcedDeletion && value instanceof ForcedDeletion);
}
