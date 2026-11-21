// Foundry v14는 갱신 데이터의 "-=" 삭제 키를 폐기 예고했다(V16 제거). 대신 ForcedDeletion 연산자를 값으로 쓴다.
// v14 클라이언트에는 재사용용 전역 `_del`이 있다. 연산자가 없는 환경(단위 시험 등)에서는 예전 키로 돌아간다.

function deletionOperator() {
  if (globalThis._del) return globalThis._del;
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  return ForcedDeletion ? new ForcedDeletion() : null;
}

// 점 경로 하나를 지우는 갱신 항목 [키, 값]을 만든다.
export function deletionEntry(path) {
  const operator = deletionOperator();
  if (operator) return [path, operator];
  const keys = String(path).split('.');
  const key = keys.pop();
  return [[...keys, `-=${key}`].join('.'), null];
}

export function addDeletion(update, path) {
  const [key, value] = deletionEntry(path);
  update[key] = value;
  return update;
}

export function isDeletionValue(value) {
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  return Boolean(ForcedDeletion && value instanceof ForcedDeletion);
}
