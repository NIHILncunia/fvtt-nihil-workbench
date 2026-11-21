// 워크벤치 사용 허용: 예전부터 허용한 사용자 ID(Gamemaster, AI 1)와 정식 GM 역할(USER_ROLES.GAMEMASTER = 4).
// 보조 GM(ASSISTANT = 3)과 일반 사용자는 열 수 없다. 2026-11-21 VPS 정식 GM은 Gamemaster와 AI 1~4다.
export const LEGACY_WORKBENCH_USER_IDS = Object.freeze(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);

export function isWorkbenchUser(user = globalThis.game?.user) {
  if (!user) return false;
  if (LEGACY_WORKBENCH_USER_IDS.includes(user.id)) return true;
  const gamemaster = globalThis.CONST?.USER_ROLES?.GAMEMASTER ?? 4;
  return Number(user.role) >= gamemaster;
}
