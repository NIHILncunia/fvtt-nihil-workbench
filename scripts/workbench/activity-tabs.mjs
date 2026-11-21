const TYPE_LABELS = {
  attack: '공격·피해', damage: '피해', save: '내성·피해', heal: '회복',
  summon: '소환', transform: '변신', cast: '주문', enchant: '마법 부여',
  check: '능력 판정', forward: '연결', order: '명령', utility: '기타 설정',
};

export function activityFieldTab(path) {
  const root = path.split('.')[0];
  if (['img', 'description', 'visibility'].includes(root)) return 'identity';
  if (['activation', 'consumption', 'uses', 'duration'].includes(root)) return 'activation';
  if (['range', 'target'].includes(root)) return 'targets';
  if (root === 'effects') return 'effects';
  return 'automation';
}

export function buildActivityTabs(
  type,
  commonFields = [],
  specificFields = [],
  selected = 'identity',
) {
  const tabs = [
    { id: 'identity', label: '기본 정보', isIdentity: true },
    { id: 'activation', label: '발동·소모', isActivation: true },
    { id: 'targets', label: '대상·범위', isTargets: true },
    { id: 'type', label: TYPE_LABELS[type] ?? '유형별 설정', isType: true },
    { id: 'effects', label: '효과', isEffects: true },
    { id: 'automation', label: '자동화', isAutomation: true },
  ].map((tab) => ({ ...tab, fields: [] }));
  for (const field of commonFields) {
    const tab = tabs.find((candidate) => candidate.id === activityFieldTab(field.path));
    tab.fields.push({ ...field, common: true });
  }
  tabs.find((tab) => tab.id === 'type').fields.push(...specificFields.map((field) => ({ ...field, common: false })));
  const available = tabs.filter((tab) => {
    return tab.fields.length || (type === 'order' ? ['identity'] : ['identity', 'activation', 'targets']).includes(tab.id)
      || (tab.id === 'type' && ['attack', 'damage', 'save', 'heal'].includes(type));
  });
  const active = available.some((tab) => tab.id === selected) ? selected : 'identity';
  return available.map((tab) => ({ ...tab, active: tab.id === active }));
}
