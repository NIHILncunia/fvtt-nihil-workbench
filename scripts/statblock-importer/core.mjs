export const STRUCTURAL_ITEM_TRANSLATIONS = Object.freeze({
  'Legendary Actions': { name: '전설적 행동', description: null },
  'Lair Actions': { name: '소굴 행동', description: null },
  'Mythic Actions': { name: '신화적 행동', description: null },
  'Villain Actions': { name: '악당 행동', description: null },
});

export function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toDescriptionHtml(description) {
  if (description == null) return null;

  const text = String(description).trim();
  if (!text) return '';

  if (/<\/?[a-z][\s\S]*>/i.test(text)) return text;

  return '<p>'
    + text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\n/g, '<br>'))
      .join('</p><p>')
    + '</p>';
}

export function normalizeTranslations(localizationItems = {}) {
  const translations = new Map();

  for (const [englishName, value] of Object.entries(localizationItems ?? {})) {
    if (typeof value === 'string') {
      translations.set(englishName, {
        name: value,
        description: null,
      });
      continue;
    }

    translations.set(englishName, {
      name: value?.name ?? null,
      description: value?.description ?? null,
    });
  }

  return translations;
}

export function relinkItemReferences(text, translations) {
  if (!text) return text;

  let result = text;

  for (const [englishName, data] of translations) {
    if (!data.name) continue;

    const pattern = new RegExp(
      `\\[\\[/item\\s+${escapeRegExp(englishName)}\\]\\]`,
      'gi',
    );

    result = result.replace(pattern, `[[/item ${data.name}]]`);
  }

  return result;
}

export function parseImportPackage(raw) {
  const STATBLOCK_MARKER = '===STATBLOCK===';
  const LOCALIZATION_MARKER = '===LOCALIZATION===';
  const source = String(raw ?? '');

  const statblockIndex = source.indexOf(STATBLOCK_MARKER);
  const localizationIndex = source.indexOf(LOCALIZATION_MARKER);

  if (statblockIndex === -1) {
    throw new Error(`${STATBLOCK_MARKER} 마커가 없습니다.`);
  }
  if (localizationIndex === -1) {
    throw new Error(`${LOCALIZATION_MARKER} 마커가 없습니다.`);
  }
  if (localizationIndex <= statblockIndex) {
    throw new Error('LOCALIZATION은 STATBLOCK 뒤에 있어야 합니다.');
  }

  const statblock = source
    .slice(statblockIndex + STATBLOCK_MARKER.length, localizationIndex)
    .trim();

  let localizationText = source
    .slice(localizationIndex + LOCALIZATION_MARKER.length)
    .trim();

  localizationText = localizationText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!statblock) throw new Error('스탯블록이 비어 있습니다.');
  if (!localizationText) throw new Error('LOCALIZATION이 비어 있습니다.');

  const localization = JSON.parse(localizationText);

  if (!localization || typeof localization !== 'object' || Array.isArray(localization)) {
    throw new Error('LOCALIZATION은 JSON 객체여야 합니다.');
  }
  if (
    localization.items != null
    && (typeof localization.items !== 'object' || Array.isArray(localization.items))
  ) {
    throw new Error('LOCALIZATION.items는 객체여야 합니다.');
  }

  return { statblock, localization };
}

export function createLocalizationPlan(items, localization = {}) {
  const translations = normalizeTranslations(localization.items ?? {});
  const structuralTranslations = normalizeTranslations(STRUCTURAL_ITEM_TRANSLATIONS);
  const normalizedTranslations = new Map();
  const translatedNameCandidates = new Map();
  const normalizedStructuralTranslations = new Map();
  const referenceTranslations = new Map(structuralTranslations);

  for (const [englishName, data] of translations) {
    normalizedTranslations.set(normalizeName(englishName), {
      englishName,
      ...data,
    });
    if (data.name) {
      const key = normalizeName(data.name);
      const candidates = translatedNameCandidates.get(key) ?? [];
      candidates.push({ englishName, ...data });
      translatedNameCandidates.set(
        key,
        candidates
      );
    }
    referenceTranslations.set(englishName, data);
  }

  for (const [englishName, data] of structuralTranslations) {
    normalizedStructuralTranslations.set(normalizeName(englishName), {
      englishName,
      ...data,
    });
  }

  const matchedTranslationKeys = new Set();
  const itemUpdates = [];

  for (const item of items ?? []) {
    const normalizedItemName = normalizeName(item.name);
    const translatedCandidates = translatedNameCandidates.get(normalizedItemName) ?? [];
    const userTranslation = normalizedTranslations.get(normalizedItemName)
      ?? (translatedCandidates.length === 1 ? translatedCandidates[0] : null);
    const translation = userTranslation
      ?? normalizedStructuralTranslations.get(normalizedItemName);
    const originalDescription = item.system?.description?.value ?? '';
    let newName = item.name;
    let newDescription = originalDescription;

    if (translation) {
      if (userTranslation) {
        matchedTranslationKeys.add(normalizeName(translation.englishName));
      }
      if (translation.name) newName = translation.name;
      if (translation.description != null) {
        newDescription = toDescriptionHtml(translation.description);
      }
    }

    newDescription = relinkItemReferences(newDescription, referenceTranslations);

    const update = { _id: item.id };
    let changed = false;

    if (newName !== item.name) {
      update.name = newName;
      changed = true;
    }
    if (newDescription !== originalDescription) {
      update['system.description.value'] = newDescription;
      changed = true;
    }
    if (changed) itemUpdates.push(update);
  }

  const unmatched = [];
  for (const englishName of translations.keys()) {
    if (!matchedTranslationKeys.has(normalizeName(englishName))) {
      unmatched.push(englishName);
    }
  }

  return { itemUpdates, unmatched, translations };
}
