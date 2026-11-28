import { usesLegacyAdvancementArray } from './compat.mjs';

// dnd5e 5.3부터 아이템의 성장(Advancement) 원본은 배열이 아니라 ID를 키로 한 객체다.
// 준비된 값(item.system.advancement)은 Collection이다. 세 형태를 모두 목록으로 읽는다.

export function advancementSourceList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Map) return Array.from(raw.values());
  if (typeof raw === 'object') return Object.values(raw);
  return [];
}

export function hasAdvancementSource(raw) {
  return Boolean(raw) && typeof raw === 'object';
}

// 기존 원본 형식을 유지하며 성장 하나를 더한다.
export function appendAdvancementSource(
  raw,
  entry,
) {
  if (usesLegacyAdvancementArray(raw)) return [...(raw ?? []), entry];
  return { ...(raw && typeof raw === 'object' ? raw : {}), [entry._id]: entry };
}
